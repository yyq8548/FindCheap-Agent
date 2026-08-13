from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import re
import socket
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Awaitable, Callable, Protocol
from urllib.parse import parse_qsl, unquote, urlsplit, urlunsplit

from fastapi import FastAPI, HTTPException

from .config import MerchantSettings, ProfileSettings, WorkerSettings, load_settings
from .models import DynamicPageEvidence, ExtractRequest


MAX_EVIDENCE_BYTES = 2_000_000
REQUEST_TIMEOUT_SECONDS = 15
SOURCE_VERSION = "crawl4ai-0.9.2"
FIXED_USER_AGENT = "ShoppingAgentEvidenceBot/1.0 (+merchant-audit-required)"
INVALID_PERCENT = re.compile(r"%(?![0-9A-Fa-f]{2})")
CONTROL = re.compile(r"[\x00-\x1f\x7f]")
SCRIPT_BLOCK = re.compile(
    r"<\s*(script|style|noscript|template)\b[^>]*>.*?<\s*/\s*\1\s*>",
    flags=re.IGNORECASE | re.DOTALL,
)
SECRET_TEXT = re.compile(
    r"(?im)\b(cookie|set-cookie|authorization|proxy-authorization)\s*[:=]\s*[^\s<]+"
)
LOCAL_RESOURCE = re.compile(r"(?i)\b(?:file|data):/{0,3}[^\s<>\"']+")


@dataclass(frozen=True)
class CrawlOutput:
    raw_evidence: str
    final_url: str | None
    redirect_chain: tuple[str, ...]
    success: bool = True


class CrawlerClient(Protocol):
    async def crawl(self, url: str, profile: str) -> CrawlOutput: ...

    async def aclose(self) -> None: ...


Resolver = Callable[[str], Awaitable[list[ipaddress.IPv4Address | ipaddress.IPv6Address]]]
CrawlerFactory = Callable[[str], CrawlerClient]


async def resolve_dns(host: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    loop = asyncio.get_running_loop()
    answers = await loop.run_in_executor(
        None,
        lambda: socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM),
    )
    return list({ipaddress.ip_address(answer[4][0]) for answer in answers})


def _iterative_unquote(value: str) -> str:
    decoded = value
    try:
        for _ in range(4):
            next_value = unquote(decoded, errors="strict")
            if next_value == decoded:
                return decoded
            decoded = next_value
        if unquote(decoded, errors="strict") != decoded:
            raise HTTPException(status_code=400, detail="resource path encoding is too deep")
    except UnicodeDecodeError as error:
        raise HTTPException(status_code=400, detail="invalid UTF-8 in resource path") from error
    return decoded


def _validate_query(query: str, profile: ProfileSettings) -> None:
    if not query:
        return
    if len(query) > 256 or not profile.allowed_query_keys:
        raise HTTPException(status_code=400, detail="query is not allowed for this profile")
    try:
        pairs = parse_qsl(query, keep_blank_values=True, strict_parsing=True, max_num_fields=10)
    except (ValueError, UnicodeDecodeError) as error:
        raise HTTPException(status_code=400, detail="invalid query") from error
    seen: set[str] = set()
    for key, value in pairs:
        if (
            key not in profile.allowed_query_keys
            or key in seen
            or len(key) > 40
            or len(value) > 128
            or CONTROL.search(key)
            or CONTROL.search(value)
        ):
            raise HTTPException(status_code=400, detail="query key or value is not allowed")
        seen.add(key)


def _validate_path_and_query(resource_path: str, profile: ProfileSettings) -> tuple[str, str]:
    if INVALID_PERCENT.search(resource_path) or CONTROL.search(resource_path):
        raise HTTPException(status_code=400, detail="invalid resource path encoding")
    parsed = urlsplit(resource_path)
    if (
        parsed.scheme
        or parsed.netloc
        or parsed.fragment
        or not parsed.path.startswith("/")
        or resource_path.startswith("//")
    ):
        raise HTTPException(status_code=400, detail="resource path must be relative")

    decoded_path = _iterative_unquote(parsed.path)
    if (
        "//" in parsed.path
        or "//" in decoded_path
        or "\\" in parsed.path
        or "\\" in decoded_path
        or "#" in decoded_path
        or "?" in decoded_path
        or CONTROL.search(decoded_path)
        or any(segment in {".", ".."} for segment in decoded_path.split("/"))
    ):
        raise HTTPException(status_code=400, detail="resource path is not normalized")
    if sum(character == "/" for character in decoded_path) != sum(
        character == "/" for character in parsed.path
    ):
        raise HTTPException(status_code=400, detail="encoded path delimiters are forbidden")
    if not any(decoded_path.startswith(prefix) for prefix in profile.allowed_path_prefixes):
        raise HTTPException(status_code=403, detail="resource path is outside the audited profile")
    _validate_query(parsed.query, profile)
    return parsed.path, parsed.query


def _validate_absolute_url(
    url: str, merchant: MerchantSettings, profile: ProfileSettings
) -> tuple[str, str]:
    if INVALID_PERCENT.search(url) or CONTROL.search(url):
        raise HTTPException(status_code=403, detail="crawler returned an invalid URL")
    parsed = urlsplit(url)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.hostname not in merchant.allowed_hosts
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port not in {None, 443}
        or parsed.fragment
    ):
        raise HTTPException(status_code=403, detail="crawler left the audited host")
    path, query = _validate_path_and_query(
        urlunsplit(("", "", parsed.path, parsed.query, "")), profile
    )
    return path, query


async def _assert_public_dns(url: str, resolver: Resolver) -> None:
    host = urlsplit(url).hostname
    if not host:
        raise HTTPException(status_code=403, detail="URL has no host")
    try:
        addresses = await resolver(host)
    except (OSError, socket.gaierror) as error:
        raise HTTPException(status_code=502, detail="merchant DNS resolution failed") from error
    if not addresses or any(not address.is_global for address in addresses):
        raise HTTPException(status_code=403, detail="merchant DNS answer is forbidden")


def _sanitize_evidence(raw: str) -> str:
    sanitized = SCRIPT_BLOCK.sub("", raw)
    sanitized = SECRET_TEXT.sub(lambda match: f"{match.group(1)}: [redacted]", sanitized)
    sanitized = LOCAL_RESOURCE.sub("[local-resource-removed]", sanitized)
    return sanitized.strip()


class Crawl4AIClient:
    """Lazy Crawl4AI wrapper; no browser or library is loaded at module import."""

    def __init__(self, proxy_url: str):
        self._proxy_url = proxy_url

    async def crawl(self, url: str, profile: str) -> CrawlOutput:
        from crawl4ai import (  # type: ignore[import-not-found]
            AsyncWebCrawler,
            BrowserConfig,
            CacheMode,
            CrawlerRunConfig,
            ProxyConfig,
        )

        selectors = {
            "product": "main",
            "offer": "main",
            "coupon": "main",
        }
        browser = BrowserConfig(
            browser_type="chromium",
            headless=True,
            verbose=False,
            user_agent=FIXED_USER_AGENT,
            proxy_config=ProxyConfig(server=self._proxy_url),
            use_persistent_context=False,
            cookies=[],
            headers={},
            init_scripts=[],
            storage_state=None,
            accept_downloads=False,
            downloads_path=None,
            ignore_https_errors=False,
            java_script_enabled=True,
        )
        run = CrawlerRunConfig(
            cache_mode=CacheMode.BYPASS,
            css_selector=selectors[profile],
            excluded_tags=["script", "style", "noscript", "template", "iframe"],
            page_timeout=REQUEST_TIMEOUT_SECONDS * 1_000,
            wait_until="domcontentloaded",
            scan_full_page=False,
            screenshot=False,
            pdf=False,
            js_code=None,
            js_code_before_wait=None,
            c4a_script=None,
            check_robots_txt=True,
            capture_network_requests=False,
            capture_console_messages=False,
            process_in_browser=False,
            max_retries=0,
        )
        async with AsyncWebCrawler(config=browser) as crawler:
            result = await crawler.arun(url=url, config=run)

        markdown = getattr(result, "markdown", "")
        raw = getattr(markdown, "raw_markdown", markdown)
        if not isinstance(raw, str):
            raw = str(raw)
        final_url = getattr(result, "redirected_url", None) or getattr(result, "url", None)
        chain = getattr(result, "redirect_chain", ()) or ()
        return CrawlOutput(
            raw_evidence=raw,
            final_url=final_url if isinstance(final_url, str) else None,
            redirect_chain=tuple(item for item in chain if isinstance(item, str)),
            success=bool(getattr(result, "success", False)),
        )

    async def aclose(self) -> None:
        return None


class ExtractionService:
    def __init__(
        self,
        settings: WorkerSettings,
        crawler_factory: CrawlerFactory | None = None,
        resolver: Resolver = resolve_dns,
    ):
        self._settings = settings
        self._crawler_factory = crawler_factory or (lambda proxy: Crawl4AIClient(proxy))
        self._resolver = resolver

    async def extract(self, request: ExtractRequest) -> DynamicPageEvidence:
        merchant = self._settings.merchants.get(request.merchantId)
        if (
            merchant is None
            or not merchant.enabled
            or merchant.audit_state != "approved"
            or merchant.legal_review != "approved"
            or merchant.proven_source != "crawl4ai"
        ):
            raise HTTPException(status_code=403, detail="merchant not allowed")
        profile = merchant.profiles.get(request.extractionProfile)
        if profile is None:
            raise HTTPException(status_code=403, detail="extraction profile not allowed")
        if not self._settings.egress_enforced or not self._settings.proxy_url:
            raise HTTPException(status_code=503, detail="enforced egress is unavailable")

        base = urlsplit(merchant.base_url)
        path, query = _validate_path_and_query(request.resourcePath, profile)
        url = urlunsplit(("https", base.netloc, path, query, ""))
        _validate_absolute_url(url, merchant, profile)

        try:
            async with asyncio.timeout(REQUEST_TIMEOUT_SECONDS):
                await _assert_public_dns(url, self._resolver)
                crawler = self._crawler_factory(self._settings.proxy_url)
                try:
                    result = await crawler.crawl(url, request.extractionProfile)
                finally:
                    await crawler.aclose()

                if not result.success:
                    raise HTTPException(status_code=502, detail="dynamic extraction failed")

                observed_urls = [*result.redirect_chain]
                if result.final_url:
                    observed_urls.append(result.final_url)
                for observed_url in observed_urls:
                    _validate_absolute_url(observed_url, merchant, profile)
                    await _assert_public_dns(observed_url, self._resolver)
        except TimeoutError as error:
            raise HTTPException(status_code=504, detail="dynamic extraction timed out") from error

        raw_evidence = _sanitize_evidence(result.raw_evidence)
        encoded = raw_evidence.encode("utf-8")
        if len(encoded) > MAX_EVIDENCE_BYTES:
            raise HTTPException(status_code=502, detail="crawler evidence exceeds the size limit")
        source_url = result.final_url or url
        checked_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
            "+00:00", "Z"
        )
        return DynamicPageEvidence(
            merchantId=request.merchantId,
            sourceUrl=source_url,
            rawEvidence=raw_evidence,
            sha256=hashlib.sha256(encoded).hexdigest(),
            sourceVersion=SOURCE_VERSION,
            checkedAt=checked_at,
            metadata={"extractionProfile": request.extractionProfile},
        )


def create_app(
    settings: WorkerSettings | None = None,
    crawler_factory: CrawlerFactory | None = None,
    resolver: Resolver = resolve_dns,
) -> FastAPI:
    service = ExtractionService(settings or load_settings(), crawler_factory, resolver)
    application = FastAPI(title="Crawl4AI evidence worker", docs_url=None, redoc_url=None)

    @application.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @application.post("/extract", response_model=DynamicPageEvidence)
    async def extract(request: ExtractRequest) -> DynamicPageEvidence:
        return await service.extract(request)

    return application


app = create_app()
