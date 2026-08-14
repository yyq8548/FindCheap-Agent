from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import sys
from types import SimpleNamespace
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError


SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

from app.config import ConfigurationError, WorkerSettings  # noqa: E402
from app.main import Crawl4AIClient, CrawlOutput, ExtractionService, create_app  # noqa: E402
from app.main import RequestBodyLimitMiddleware  # noqa: E402
from app.models import ExtractRequest  # noqa: E402


def run(coroutine):
    return asyncio.run(coroutine)


class FakeCrawler:
    def __init__(self, output: CrawlOutput):
        self.output = output
        self.calls: list[tuple[str, str]] = []

    async def crawl(self, url: str, profile: str) -> CrawlOutput:
        self.calls.append((url, profile))
        return self.output

    async def aclose(self) -> None:
        return None


class AllowRobots:
    async def authorize(self, **_):
        return None


def test_persistent_crawl4ai_client_serializes_and_recycles_context(monkeypatch):
    state = SimpleNamespace(
        starts=0, closes=0, active=0, max_active=0, browsers=[], hooks=[]
    )

    class FakeConfig:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class FakeAsyncWebCrawler:
        def __init__(self, config):
            self.config = config
            self.crawler_strategy = SimpleNamespace(
                set_hook=lambda name, hook: state.hooks.append((name, hook))
            )
            state.browsers.append(config)

        async def start(self):
            state.starts += 1

        async def arun(self, *, url, config):
            state.active += 1
            state.max_active = max(state.max_active, state.active)
            await asyncio.sleep(0.01)
            state.active -= 1
            return SimpleNamespace(
                markdown="<main>ok</main>",
                redirected_url=url,
                redirect_chain=(),
                success=True,
                error_message="",
            )

        async def close(self):
            state.closes += 1

    fake_crawl4ai = SimpleNamespace(
        AsyncWebCrawler=FakeAsyncWebCrawler,
        BrowserConfig=FakeConfig,
        CrawlerRunConfig=FakeConfig,
        ProxyConfig=FakeConfig,
        CacheMode=SimpleNamespace(BYPASS="bypass"),
    )
    monkeypatch.setitem(sys.modules, "crawl4ai", fake_crawl4ai)

    async def exercise():
        client = Crawl4AIClient("http://crawl4ai-egress:3128")
        first, second = await asyncio.gather(
            client.crawl("https://shop.example/catalog/p/1", "product"),
            client.crawl("https://shop.example/catalog/p/2", "product"),
        )
        await client.aclose()
        return first, second

    first, second = run(exercise())

    assert first.success and second.success
    assert state.starts == 1
    assert state.max_active == 1
    assert state.closes == 1
    browser_args = state.browsers[0].kwargs
    assert browser_args["create_isolated_context"] is True
    assert browser_args["max_pages_before_recycle"] == 1
    assert browser_args["cookies"] == []
    assert browser_args["storage_state"] is None
    assert browser_args["ignore_https_errors"] is False
    assert browser_args["extra_args"] == []
    assert "text_mode" not in browser_args
    assert browser_args["light_mode"] is True
    assert [name for name, _ in state.hooks] == ["on_page_context_created"]


def test_page_budget_stops_chunked_main_document_during_streaming():
    handlers = {}

    class Session:
        def __init__(self, page):
            self.page = page

        def on(self, name, handler):
            handlers[name] = handler

        async def send(self, name):
            if name == "Page.stopLoading":
                self.page.stopped = True

    class Context:
        async def new_cdp_session(self, page):
            return Session(page)

    class Page:
        stopped = False
        closed = False

        async def close(self):
            self.closed = True

    async def exercise():
        page = Page()
        state = await Crawl4AIClient._install_page_budget(page, Context())
        handlers["Network.requestWillBeSent"](
            {"type": "Document", "requestId": "main"}
        )
        for _ in range(33):
            handlers["Network.dataReceived"](
                {"requestId": "main", "dataLength": 65_536, "encodedDataLength": 0}
            )
        await state["abort_task"]
        return page, state

    page, state = run(exercise())

    assert state["detail"] == "merchant document exceeds the upstream size limit"
    assert page.stopped is True
    assert page.closed is True


def approved_settings(*, egress_enforced: bool = True) -> WorkerSettings:
    return WorkerSettings.from_mapping(
        {
            "egressEnforced": egress_enforced,
            "proxyUrl": "http://crawl4ai-egress:3128",
            "merchants": {
                "shop": {
                    "enabled": True,
                    "auditState": "approved",
                    "legalReview": "approved",
                    "provenSource": "crawl4ai",
                    "baseUrl": "https://shop.example/catalog/",
                    "allowedHosts": ["shop.example"],
                    "profiles": {
                        "product": {
                            "allowedPathPrefixes": ["/catalog/p/"],
                            "allowedQueryKeys": ["variant"],
                        },
                        "offer": {"allowedPathPrefixes": ["/catalog/offers/"]},
                    },
                }
            },
        }
    )


async def public_resolver(host: str) -> list[ipaddress._BaseAddress]:
    assert host == "shop.example"
    return [ipaddress.ip_address("93.184.216.34")]


def make_service(
    *,
    settings: WorkerSettings | None = None,
    output: CrawlOutput | None = None,
    resolver=public_resolver,
):
    crawler = FakeCrawler(
        output
        or CrawlOutput(
            raw_evidence="<script>steal()</script><main>Member price: $19</main>",
            final_url="https://shop.example/catalog/p/1",
            redirect_chain=(),
        )
    )
    service = ExtractionService(
        settings=settings or approved_settings(),
        crawler_factory=lambda _: crawler,
        resolver=resolver,
        robots_policy=AllowRobots(),
    )
    return service, crawler


def test_schema_is_closed_and_accepts_only_worker_keys():
    with pytest.raises(ValidationError):
        ExtractRequest.model_validate(
            {
                "merchantId": "shop",
                "resourcePath": "/catalog/p/1",
                "extractionProfile": "product",
                "url": "http://127.0.0.1",
                "javascript": "fetch('/secret')",
            }
        )


def test_http_api_returns_403_for_unknown_and_422_for_extra_network_fields():
    service, crawler = make_service()
    app = create_app(
        approved_settings(),
        crawler_factory=lambda _: crawler,
        resolver=public_resolver,
        robots_policy=AllowRobots(),
    )
    with TestClient(app) as client:
        unknown = client.post(
            "/extract",
            json={
                "merchantId": "unknown",
                "resourcePath": "/catalog/p/1",
                "extractionProfile": "product",
            },
        )
        extra = client.post(
            "/extract",
            json={
                "merchantId": "shop",
                "resourcePath": "/catalog/p/1",
                "extractionProfile": "product",
                "url": "http://127.0.0.1",
                "proxy": "http://169.254.169.254",
                "javascript": "fetch('/secret')",
            },
        )

    assert unknown.status_code == 403
    assert extra.status_code == 422
    assert crawler.calls == []


def test_openapi_and_interactive_docs_are_disabled():
    app = create_app(approved_settings(), robots_policy=AllowRobots())
    with TestClient(app) as client:
        assert client.get("/openapi.json").status_code == 404
        assert client.get("/docs").status_code == 404
        assert client.get("/redoc").status_code == 404


def invoke_body_limit(
    *,
    headers=(),
    chunks=(b"",),
    path="/extract",
    method="POST",
    receive_delays=(),
    complete=True,
    read_timeout_seconds=2,
):
    sent = []
    received_body = bytearray()
    queue = [
        {
            "type": "http.request",
            "body": chunk,
            "more_body": index < len(chunks) - 1 or not complete,
        }
        for index, chunk in enumerate(chunks)
    ]

    async def downstream(scope, receive, send):
        while True:
            message = await receive()
            received_body.extend(message.get("body", b""))
            if not message.get("more_body", False):
                break
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    async def receive():
        index = len(chunks) - len(queue)
        if index < len(receive_delays):
            await asyncio.sleep(receive_delays[index])
        if not queue:
            await asyncio.Future()
        return queue.pop(0)

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "headers": list(headers),
        "client": ("127.0.0.1", 1),
        "server": ("test", 80),
    }
    run(
        RequestBodyLimitMiddleware(
            downstream, read_timeout_seconds=read_timeout_seconds
        )(scope, receive, send)
    )
    status = next(message["status"] for message in sent if message["type"] == "http.response.start")
    return status, bytes(received_body)


def test_body_cap_counts_actual_missing_forged_and_chunked_bodies():
    assert invoke_body_limit(chunks=(b"{}",)) == (204, b"{}")
    assert invoke_body_limit(headers=((b"content-length", b"2"),), chunks=(b"{}",)) == (
        204,
        b"{}",
    )
    assert invoke_body_limit(headers=((b"content-length", b"1"),), chunks=(b"x" * 2049,))[0] == 413
    assert invoke_body_limit(headers=((b"transfer-encoding", b"chunked"),), chunks=(b"x" * 1024, b"y" * 1025))[0] == 413
    assert invoke_body_limit(chunks=(b"x" * 2048, b"y"))[0] == 413


@pytest.mark.parametrize("value", [b"-1", b"02048", b"+1", b"2, 2", b""])
def test_body_cap_rejects_noncanonical_content_length(value):
    assert invoke_body_limit(headers=((b"content-length", value),), chunks=(b"{}",))[0] == 400


def test_body_cap_rejects_duplicate_content_length_and_preserves_health_get():
    assert invoke_body_limit(
        headers=((b"content-length", b"2"), (b"content-length", b"2")), chunks=(b"{}",)
    )[0] == 400
    assert invoke_body_limit(path="/health", method="GET", chunks=(b"",))[0] == 204


def test_body_cap_times_out_slow_or_incomplete_request_without_affecting_health():
    assert invoke_body_limit(
        chunks=(b"{}",), receive_delays=(0.02,), read_timeout_seconds=0.01
    )[0] == 408
    assert invoke_body_limit(
        chunks=(b"{",), complete=False, read_timeout_seconds=0.01
    )[0] == 408
    assert invoke_body_limit(
        path="/health",
        method="GET",
        chunks=(b"",),
        receive_delays=(0.02,),
        read_timeout_seconds=0.01,
    )[0] == 204


@pytest.mark.parametrize(
    "resource_path",
    [
        "https://shop.example/catalog/p/1",
        "//shop.example/p/1",
        "/catalog//p/1",
        "/catalog\\p\\1",
        "/catalog/../secret",
        "/catalog/%2e%2e/secret",
        "/catalog/%252e%252e/secret",
        "/catalog/p/%ff",
        "/catalog/p/1%23fragment",
        "/catalog/p/1%3fquery",
        "/catalog/p/1%0d%0aX-Test:yes",
        "/catalog/p/1#fragment",
        "/catalog/p/1?not-allowed=yes",
        "/catalog/p/1?variant=" + "x" * 129,
        "/catalog/p/a b",
        "/catalog/p/a;b",
        "/catalog/p/café",
        "/catalog/p/a%3Bb",
        "/catalog/p/%31",
        "/catalog/p/1?variant=blue+red",
        "/catalog/p/1?variant=%62lue",
        "/catalog/p/1?variant=%2562lue",
        "/catalog/p/1?variant=blue;debug",
        "/catalog/p/1?variant=blue&variant=red",
        "/catalog/p/1?",
    ],
)
def test_resource_path_rejects_network_and_parser_escape(resource_path: str):
    service, crawler = make_service()
    request = ExtractRequest(
        merchantId="shop", resourcePath=resource_path, extractionProfile="product"
    )

    with pytest.raises(HTTPException) as error:
        run(service.extract(request))

    assert error.value.status_code in {400, 403}
    assert crawler.calls == []


def test_unknown_disabled_or_unapproved_merchant_is_forbidden():
    settings = approved_settings()
    service, _ = make_service(settings=settings)
    request = ExtractRequest(
        merchantId="unknown",
        resourcePath="/catalog/p/1",
        extractionProfile="product",
    )
    with pytest.raises(HTTPException) as unknown:
        run(service.extract(request))
    assert unknown.value.status_code == 403

    raw = settings.to_mapping()
    raw["merchants"]["shop"]["enabled"] = False
    disabled_service, _ = make_service(settings=WorkerSettings.from_mapping(raw))
    request.merchantId = "shop"
    with pytest.raises(HTTPException) as disabled:
        run(disabled_service.extract(request))
    assert disabled.value.status_code == 403


@pytest.mark.parametrize(
    "change",
    [
        {"baseUrl": "http://shop.example/catalog/"},
        {"baseUrl": "https://user:pass@shop.example/catalog/"},
        {"baseUrl": "https://shop.example:8443/catalog/"},
        {"baseUrl": "https://other.example/catalog/"},
        {"allowedHosts": ["127.0.0.1"]},
        {"auditState": "in_review"},
        {"legalReview": "not_started"},
        {"provenSource": "http"},
        {"baseUrl": "https://shop.example/cat alog/"},
        {
            "profiles": {
                "product": {"allowedPathPrefixes": ["/catalog/p;"]}
            }
        },
    ],
)
def test_configuration_rejects_non_audited_or_unsafe_merchants(change: dict[str, object]):
    raw = approved_settings().to_mapping()
    raw["merchants"]["shop"].update(change)
    with pytest.raises(ConfigurationError):
        WorkerSettings.from_mapping(raw)


def test_fails_closed_without_declared_network_enforcement():
    service, crawler = make_service(settings=approved_settings(egress_enforced=False))
    request = ExtractRequest(
        merchantId="shop",
        resourcePath="/catalog/p/1",
        extractionProfile="product",
    )
    with pytest.raises(HTTPException) as error:
        run(service.extract(request))
    assert error.value.status_code == 503
    assert crawler.calls == []


@pytest.mark.parametrize(
    "addresses",
    [
        ["127.0.0.1"],
        ["169.254.169.254"],
        ["10.0.0.1"],
        ["::1"],
        ["fe80::1"],
        ["93.184.216.34", "192.168.1.3"],
    ],
)
def test_rejects_if_any_dns_answer_is_not_global(addresses: list[str]):
    async def resolver(_: str):
        return [ipaddress.ip_address(address) for address in addresses]

    service, crawler = make_service(resolver=resolver)
    request = ExtractRequest(
        merchantId="shop",
        resourcePath="/catalog/p/1",
        extractionProfile="product",
    )
    with pytest.raises(HTTPException) as error:
        run(service.extract(request))
    assert error.value.status_code == 403
    assert crawler.calls == []


def test_revalidates_final_url_and_each_redirect():
    output = CrawlOutput(
        raw_evidence="safe",
        final_url="https://shop.example/catalog/p/1",
        redirect_chain=(
            "https://shop.example/catalog/start",
            "https://169.254.169.254/latest/meta-data",
        ),
    )
    service, _ = make_service(output=output)
    request = ExtractRequest(
        merchantId="shop",
        resourcePath="/catalog/p/1",
        extractionProfile="product",
    )
    with pytest.raises(HTTPException) as error:
        run(service.extract(request))
    assert error.value.status_code == 403


def test_success_returns_bounded_sanitized_hashed_utc_evidence():
    service, crawler = make_service()
    request = ExtractRequest(
        merchantId="shop",
        resourcePath="/catalog/p/1?variant=blue",
        extractionProfile="product",
    )
    evidence = run(service.extract(request))

    assert crawler.calls == [
        ("https://shop.example/catalog/p/1?variant=blue", "product")
    ]
    assert evidence.merchantId == "shop"
    assert evidence.sourceUrl == "https://shop.example/catalog/p/1"
    assert "script" not in evidence.rawEvidence.lower()
    assert evidence.rawEvidence == "<main>Member price: $19</main>"
    assert len(evidence.rawEvidence.encode("utf-8")) <= 2_000_000
    assert evidence.sha256 == hashlib.sha256(
        evidence.rawEvidence.encode("utf-8")
    ).hexdigest()
    assert evidence.sourceVersion == "crawl4ai-0.9.2"
    assert evidence.checkedAt.endswith("Z")
    assert evidence.metadata == {"extractionProfile": "product"}


def test_rejects_oversized_evidence_without_returning_debug_material():
    output = CrawlOutput(
        raw_evidence="x" * 2_000_001,
        final_url="https://shop.example/catalog/p/1",
        redirect_chain=(),
    )
    service, _ = make_service(output=output)
    request = ExtractRequest(
        merchantId="shop",
        resourcePath="/catalog/p/1",
        extractionProfile="product",
    )
    with pytest.raises(HTTPException) as error:
        run(service.extract(request))
    assert error.value.status_code == 502


@pytest.mark.parametrize("raw", ["", "  \n\t", "<script>only()</script>"])
def test_rejects_empty_evidence_after_sanitization(raw):
    output = CrawlOutput(
        raw_evidence=raw,
        final_url="https://shop.example/catalog/p/1",
        redirect_chain=(),
    )
    service, _ = make_service(output=output)
    request = ExtractRequest(
        merchantId="shop", resourcePath="/catalog/p/1", extractionProfile="product"
    )
    with pytest.raises(HTTPException) as error:
        run(service.extract(request))
    assert error.value.status_code == 502


def test_postprocessing_remains_inside_request_deadline():
    async def slow_sanitizer(_raw: str) -> str:
        await asyncio.sleep(0.05)
        return "late"

    crawler = FakeCrawler(
        CrawlOutput("safe", "https://shop.example/catalog/p/1", ())
    )
    service = ExtractionService(
        approved_settings(),
        crawler_factory=lambda _: crawler,
        resolver=public_resolver,
        robots_policy=AllowRobots(),
        sanitizer=slow_sanitizer,
        request_timeout_seconds=0.01,
    )
    request = ExtractRequest(
        merchantId="shop", resourcePath="/catalog/p/1", extractionProfile="product"
    )
    with pytest.raises(HTTPException) as error:
        run(service.extract(request))
    assert error.value.status_code == 504


def test_rejects_unsuccessful_crawl_result():
    output = CrawlOutput(
        raw_evidence="browser error details",
        final_url="https://shop.example/catalog/p/1",
        redirect_chain=(),
        success=False,
    )
    service, _ = make_service(output=output)
    request = ExtractRequest(
        merchantId="shop",
        resourcePath="/catalog/p/1",
        extractionProfile="product",
    )
    with pytest.raises(HTTPException) as error:
        run(service.extract(request))
    assert error.value.status_code == 502
