from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import re
import socket
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Awaitable, Callable, Protocol
from urllib.parse import quote, unquote, urlsplit, urlunsplit

from fastapi import FastAPI, HTTPException
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .config import MerchantSettings, ProfileSettings, WorkerSettings, load_settings
from .models import DynamicPageEvidence, ExtractRequest
from .robots import FIXED_USER_AGENT, SecureRobotsPolicy


MAX_EVIDENCE_BYTES = 2_000_000
MAX_UPSTREAM_DOCUMENT_BYTES = 2 * 1024 * 1024
MAX_REQUEST_BODY_BYTES = 2_048
REQUEST_TIMEOUT_SECONDS = 15
CRAWL_TIMEOUT_SECONDS = 10
SOURCE_VERSION = "crawl4ai-0.9.2"
INVALID_PERCENT = re.compile(r"%(?![0-9A-Fa-f]{2})")
CONTROL = re.compile(r"[\x00-\x1f\x7f]")
RAW_RESOURCE_PATH = re.compile(r"^/[A-Za-z0-9/_?&=.%+\-]+$")
DECODED_PATH = re.compile(r"^/[A-Za-z0-9/_.+\-]+$")
DECODED_QUERY_COMPONENT = re.compile(r"^[A-Za-z0-9._~\-]*$")
CANONICAL_CONTENT_LENGTH = re.compile(rb"(?:0|[1-9][0-9]*)")
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
    error_message: str = ""


class CrawlerClient(Protocol):
    async def crawl(self, url: str, profile: str) -> CrawlOutput: ...

    async def aclose(self) -> None: ...


Resolver = Callable[[str], Awaitable[list[ipaddress.IPv4Address | ipaddress.IPv6Address]]]
CrawlerFactory = Callable[[str], CrawlerClient]
Sanitizer = Callable[[str], Awaitable[str]]


class RequestBodyLimitMiddleware:
    """Reject oversized extract bodies before Starlette allocates/parses JSON."""

    def __init__(self, app: ASGIApp, limit: int = MAX_REQUEST_BODY_BYTES):
        self.app = app
        self.limit = limit

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "POST" or scope["path"] != "/extract":
            await self.app(scope, receive, send)
            return

        lengths = [value for key, value in scope.get("headers", []) if key.lower() == b"content-length"]
        if len(lengths) > 1 or (
            lengths and not CANONICAL_CONTENT_LENGTH.fullmatch(lengths[0])
        ):
            await JSONResponse(
                {"detail": "invalid content-length"},
                status_code=400,
                headers={"Connection": "close"},
            )(
                scope, receive, send
            )
            return
        if lengths and int(lengths[0]) > self.limit:
            await JSONResponse(
                {"detail": "request body exceeds the size limit"},
                status_code=413,
                headers={"Connection": "close"},
            )(scope, receive, send)
            return

        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            if len(body) + len(chunk) > self.limit:
                await JSONResponse(
                    {"detail": "request body exceeds the size limit"},
                    status_code=413,
                    headers={"Connection": "close"},
                )(scope, receive, send)
                return
            body.extend(chunk)
            if not message.get("more_body", False):
                break

        delivered = False

        async def replay() -> Message:
            nonlocal delivered
            if delivered:
                return {"type": "http.request", "body": b"", "more_body": False}
            delivered = True
            return {"type": "http.request", "body": bytes(body), "more_body": False}

        await self.app(scope, replay, send)


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
    raw_pairs = query.split("&")
    if len(raw_pairs) > 10:
        raise HTTPException(status_code=400, detail="invalid query")
    seen: set[str] = set()
    for pair in raw_pairs:
        if pair.count("=") != 1:
            raise HTTPException(status_code=400, detail="invalid query")
        raw_key, raw_value = pair.split("=", 1)
        key = _iterative_unquote(raw_key)
        value = _iterative_unquote(raw_value)
        if (
            key not in profile.allowed_query_keys
            or key in seen
            or len(key) > 40
            or len(value) > 128
            or not DECODED_QUERY_COMPONENT.fullmatch(key)
            or not DECODED_QUERY_COMPONENT.fullmatch(value)
            or quote(key, safe="-._~") != raw_key
            or quote(value, safe="-._~") != raw_value
        ):
            raise HTTPException(status_code=400, detail="query key or value is not allowed")
        seen.add(key)


def _validate_path_and_query(resource_path: str, profile: ProfileSettings) -> tuple[str, str]:
    if (
        INVALID_PERCENT.search(resource_path)
        or CONTROL.search(resource_path)
        or not RAW_RESOURCE_PATH.fullmatch(resource_path)
        or ("?" in resource_path and not urlsplit(resource_path).query)
    ):
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
        or not DECODED_PATH.fullmatch(decoded_path)
        or quote(decoded_path, safe="/-._~+") != parsed.path
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


async def _default_sanitizer(raw: str) -> str:
    return await asyncio.to_thread(_sanitize_evidence, raw)


def _utf8_size(raw: str) -> int:
    total = 0
    for start in range(0, len(raw), 64 * 1024):
        total += len(raw[start : start + 64 * 1024].encode("utf-8"))
        if total > MAX_EVIDENCE_BYTES:
            raise HTTPException(status_code=502, detail="crawler evidence exceeds the size limit")
    return total


def _bounded_sha256(raw: str) -> str:
    digest = hashlib.sha256()
    total = 0
    for start in range(0, len(raw), 64 * 1024):
        part = raw[start : start + 64 * 1024].encode("utf-8")
        total += len(part)
        if total > MAX_EVIDENCE_BYTES:
            raise HTTPException(status_code=502, detail="crawler evidence exceeds the size limit")
        digest.update(part)
    return digest.hexdigest()


class Crawl4AIClient:
    """Lazy Crawl4AI wrapper; no browser or library is loaded at module import."""

    def __init__(self, proxy_url: str):
        self._proxy_url = proxy_url
        self._crawler = None
        self._lock = asyncio.Lock()

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
            text_mode=True,
            light_mode=True,
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
            create_isolated_context=True,
            max_pages_before_recycle=1,
            extra_args=[],
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
            check_robots_txt=False,
            capture_network_requests=False,
            capture_console_messages=False,
            process_in_browser=False,
            max_retries=0,
        )
        # Crawl4AI 0.9.2 shares mutable BrowserManager state. Keep one warm
        # Chromium process, but serialize arun and recycle its browser context
        # after every page so concurrent requests cannot race or share storage.
        async with self._lock:
            if self._crawler is None:
                self._crawler = AsyncWebCrawler(config=browser)
                await self._crawler.start()
                async def block_non_document_resources(page, **_):
                    async def close_oversized_document(response):
                        try:
                            if response.request.resource_type != "document":
                                return
                            raw_length = response.headers.get("content-length")
                            if (
                                raw_length
                                and raw_length.isascii()
                                and raw_length.isdecimal()
                                and int(raw_length) > MAX_UPSTREAM_DOCUMENT_BYTES
                            ):
                                await page.close()
                        except Exception:
                            return

                    def inspect_response(response):
                        asyncio.create_task(close_oversized_document(response))

                    async def route_request(route):
                        if route.request.resource_type in {
                            "image", "media", "font", "stylesheet"
                        }:
                            await route.abort()
                        else:
                            await route.continue_()

                    await page.route("**/*", route_request)
                    page.on("response", inspect_response)
                    return page

                self._crawler.crawler_strategy.set_hook(
                    "on_page_context_created", block_non_document_resources
                )
            result = await self._crawler.arun(url=url, config=run)

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
            error_message=str(getattr(result, "error_message", "") or "")[:2_000],
        )

    async def aclose(self) -> None:
        async with self._lock:
            if self._crawler is not None:
                crawler, self._crawler = self._crawler, None
                await crawler.close()


class ExtractionService:
    def __init__(
        self,
        settings: WorkerSettings,
        crawler_factory: CrawlerFactory | None = None,
        resolver: Resolver = resolve_dns,
        robots_policy: SecureRobotsPolicy | None = None,
        sanitizer: Sanitizer = _default_sanitizer,
        request_timeout_seconds: float = REQUEST_TIMEOUT_SECONDS,
    ):
        self._settings = settings
        self._owned_crawler = (
            Crawl4AIClient(settings.proxy_url)
            if crawler_factory is None and settings.proxy_url
            else None
        )
        self._crawler_factory = crawler_factory or (lambda _: self._owned_crawler)
        self._resolver = resolver
        self._robots_policy = robots_policy or SecureRobotsPolicy(resolver=resolver)
        self._sanitizer = sanitizer
        self._request_timeout_seconds = request_timeout_seconds

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
            async with asyncio.timeout(self._request_timeout_seconds):
                await _assert_public_dns(url, self._resolver)
                await self._robots_policy.authorize(
                    target_url=url,
                    allowed_hosts=merchant.allowed_hosts,
                    proxy_url=self._settings.proxy_url,
                )
                crawler = self._crawler_factory(self._settings.proxy_url)
                if crawler is None:
                    raise HTTPException(status_code=503, detail="crawler client is unavailable")
                try:
                    async with asyncio.timeout(CRAWL_TIMEOUT_SECONDS):
                        result = await crawler.crawl(url, request.extractionProfile)
                finally:
                    if self._owned_crawler is None:
                        await crawler.aclose()

                if not result.success:
                    raise HTTPException(status_code=502, detail="dynamic extraction failed")

                observed_urls = [*result.redirect_chain]
                if result.final_url:
                    observed_urls.append(result.final_url)
                for observed_url in observed_urls:
                    _validate_absolute_url(observed_url, merchant, profile)
                    await _assert_public_dns(observed_url, self._resolver)

                _utf8_size(result.raw_evidence)
                raw_evidence = await self._sanitizer(result.raw_evidence)
                if not raw_evidence:
                    raise HTTPException(status_code=502, detail="crawler evidence is empty")
                evidence_sha256 = _bounded_sha256(raw_evidence)
                source_url = result.final_url or url
                checked_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
                    "+00:00", "Z"
                )
                evidence = DynamicPageEvidence(
                    merchantId=request.merchantId,
                    sourceUrl=source_url,
                    rawEvidence=raw_evidence,
                    sha256=evidence_sha256,
                    sourceVersion=SOURCE_VERSION,
                    checkedAt=checked_at,
                    metadata={"extractionProfile": request.extractionProfile},
                )
        except TimeoutError as error:
            raise HTTPException(status_code=504, detail="dynamic extraction timed out") from error
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(status_code=502, detail="dynamic extraction failed") from error

        return evidence

    async def aclose(self) -> None:
        if self._owned_crawler is not None:
            try:
                async with asyncio.timeout(2):
                    await self._owned_crawler.aclose()
            except TimeoutError:
                pass


def create_app(
    settings: WorkerSettings | None = None,
    crawler_factory: CrawlerFactory | None = None,
    resolver: Resolver = resolve_dns,
    robots_policy: SecureRobotsPolicy | None = None,
) -> FastAPI:
    service = ExtractionService(
        settings or load_settings(), crawler_factory, resolver, robots_policy
    )
    application = FastAPI(
        title="Crawl4AI evidence worker",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    application.add_middleware(RequestBodyLimitMiddleware)

    @application.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @application.post("/extract", response_model=DynamicPageEvidence)
    async def extract(request: ExtractRequest) -> DynamicPageEvidence:
        return await service.extract(request)

    @application.on_event("shutdown")
    async def shutdown() -> None:
        await service.aclose()

    return application


app = create_app()
