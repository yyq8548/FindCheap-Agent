from __future__ import annotations

import asyncio
import ipaddress
import ssl
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException


SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

from app.robots import RobotsResponse, SecureRobotsPolicy  # noqa: E402


def run(coroutine):
    return asyncio.run(coroutine)


async def public_resolver(_: str):
    return [ipaddress.ip_address("93.184.216.34")]


class FakeTransport:
    def __init__(self, responses: list[RobotsResponse | Exception]):
        self.responses = responses
        self.calls: list[tuple[str, str]] = []

    async def get(self, url: str, proxy_url: str) -> RobotsResponse:
        self.calls.append((url, proxy_url))
        result = self.responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def policy(responses: list[RobotsResponse | Exception]) -> tuple[SecureRobotsPolicy, FakeTransport]:
    transport = FakeTransport(responses)
    return SecureRobotsPolicy(transport=transport, resolver=public_resolver), transport


def authorize(policy: SecureRobotsPolicy, path: str = "/catalog/p/1"):
    return run(
        policy.authorize(
            target_url=f"https://shop.example{path}",
            allowed_hosts=frozenset({"shop.example"}),
            proxy_url="http://crawl4ai-egress:3128",
        )
    )


def test_robots_allows_fixed_bot_when_specific_group_allows():
    checker, transport = policy(
        [
            RobotsResponse(
                200,
                {},
                b"User-agent: *\nDisallow: /catalog/\n"
                b"User-agent: ShoppingAgentEvidenceBot\nAllow: /catalog/p/\n",
            )
        ]
    )
    authorize(checker)
    assert transport.calls == [
        ("https://shop.example/robots.txt", "http://crawl4ai-egress:3128")
    ]


def test_robots_disallow_blocks_before_crawl():
    checker, _ = policy(
        [RobotsResponse(200, {}, b"User-agent: *\nDisallow: /catalog/p/\n")]
    )
    with pytest.raises(HTTPException) as error:
        authorize(checker)
    assert error.value.status_code == 403


@pytest.mark.parametrize(
    "failure",
    [
        OSError("unreachable"),
        ssl.SSLCertVerificationError("self-signed"),
        RobotsResponse(500, {}, b"error"),
        RobotsResponse(200, {}, b"not a robots policy"),
        RobotsResponse(200, {}, b"x" * (256 * 1024 + 1)),
    ],
)
def test_robots_network_tls_status_parse_and_size_fail_closed(failure):
    checker, _ = policy([failure])
    with pytest.raises(HTTPException) as error:
        authorize(checker)
    assert error.value.status_code in {403, 502}


def test_robots_redirect_is_manual_and_same_exact_host_and_path_only():
    checker, transport = policy(
        [
            RobotsResponse(302, {"location": "https://shop.example/robots.txt"}, b""),
            RobotsResponse(200, {}, b"User-agent: *\nAllow: /\n"),
        ]
    )
    authorize(checker)
    assert len(transport.calls) == 2

    escaping, _ = policy(
        [RobotsResponse(302, {"location": "https://evil.example/robots.txt"}, b"")]
    )
    with pytest.raises(HTTPException) as error:
        authorize(escaping)
    assert error.value.status_code == 403


def test_robots_redirect_limit_is_three():
    redirects = [
        RobotsResponse(302, {"location": "https://shop.example/robots.txt"}, b"")
        for _ in range(4)
    ]
    checker, _ = policy(redirects)
    with pytest.raises(HTTPException) as error:
        authorize(checker)
    assert error.value.status_code == 502
