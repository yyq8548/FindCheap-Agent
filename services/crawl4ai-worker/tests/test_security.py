from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError


SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

from app.config import ConfigurationError, WorkerSettings  # noqa: E402
from app.main import CrawlOutput, ExtractionService, create_app  # noqa: E402
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
