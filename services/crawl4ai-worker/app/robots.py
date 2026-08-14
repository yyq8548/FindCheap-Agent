from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
import ssl
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Awaitable, Callable, Mapping, Protocol
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser

from fastapi import HTTPException


FIXED_USER_AGENT = "ShoppingAgentEvidenceBot/1.0 (+merchant-audit-required)"
MAX_ROBOTS_BYTES = 256 * 1024
ROBOTS_TIMEOUT_SECONDS = 5
REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
Resolver = Callable[[str], Awaitable[list[ipaddress.IPv4Address | ipaddress.IPv6Address]]]


@dataclass(frozen=True)
class RobotsResponse:
    status: int
    headers: Mapping[str, str]
    body: bytes


class RobotsTransport(Protocol):
    async def get(self, url: str, proxy_url: str) -> RobotsResponse: ...


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        return None


class ProxyRobotsTransport:
    def _get(self, url: str, proxy_url: str) -> RobotsResponse:
        context = ssl.create_default_context()
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({"http": proxy_url, "https": proxy_url}),
            urllib.request.HTTPSHandler(context=context),
            _NoRedirect(),
        )
        request = urllib.request.Request(
            url,
            method="GET",
            headers={
                "User-Agent": FIXED_USER_AGENT,
                "Accept": "text/plain",
                "Connection": "close",
            },
        )
        try:
            response = opener.open(request, timeout=ROBOTS_TIMEOUT_SECONDS)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            body = response.read(MAX_ROBOTS_BYTES + 1)
            return RobotsResponse(
                status=response.status,
                headers={key.lower(): value for key, value in response.headers.items()},
                body=body,
            )

    async def get(self, url: str, proxy_url: str) -> RobotsResponse:
        return await asyncio.to_thread(self._get, url, proxy_url)


async def resolve_dns(host: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    loop = asyncio.get_running_loop()
    answers = await loop.run_in_executor(
        None, lambda: socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    )
    return list({ipaddress.ip_address(answer[4][0]) for answer in answers})


class SecureRobotsPolicy:
    def __init__(
        self,
        transport: RobotsTransport | None = None,
        resolver: Resolver = resolve_dns,
    ):
        self._transport = transport or ProxyRobotsTransport()
        self._resolver = resolver

    async def _assert_public_host(self, host: str) -> None:
        try:
            addresses = await self._resolver(host)
        except (OSError, socket.gaierror) as error:
            raise HTTPException(status_code=502, detail="robots DNS resolution failed") from error
        if not addresses or any(not address.is_global for address in addresses):
            raise HTTPException(status_code=403, detail="robots DNS answer is forbidden")

    @staticmethod
    def _validate_robots_url(url: str, allowed_hosts: frozenset[str]) -> str:
        parsed = urlsplit(url)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.hostname not in allowed_hosts
            or parsed.port not in {None, 443}
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path != "/robots.txt"
            or parsed.query
            or parsed.fragment
        ):
            raise HTTPException(status_code=403, detail="robots redirect left the audited boundary")
        return parsed.hostname

    async def authorize(
        self,
        *,
        target_url: str,
        allowed_hosts: frozenset[str],
        proxy_url: str,
    ) -> None:
        target = urlsplit(target_url)
        if not target.hostname or target.hostname not in allowed_hosts:
            raise HTTPException(status_code=403, detail="target host is not audited")
        robots_url = f"https://{target.hostname}/robots.txt"

        try:
            async with asyncio.timeout(ROBOTS_TIMEOUT_SECONDS):
                for redirect_count in range(4):
                    host = self._validate_robots_url(robots_url, allowed_hosts)
                    await self._assert_public_host(host)
                    response = await self._transport.get(robots_url, proxy_url)
                    if response.status not in REDIRECT_STATUSES:
                        break
                    if redirect_count == 3:
                        raise HTTPException(status_code=502, detail="robots redirect limit exceeded")
                    location = response.headers.get("location")
                    if not location:
                        raise HTTPException(status_code=502, detail="robots redirect has no location")
                    robots_url = urljoin(robots_url, location)
                else:
                    raise HTTPException(status_code=502, detail="robots fetch did not complete")
        except HTTPException:
            raise
        except (OSError, ssl.SSLError, urllib.error.URLError, TimeoutError) as error:
            raise HTTPException(status_code=502, detail="robots fetch failed") from error

        if response.status != 200:
            raise HTTPException(status_code=502, detail="robots policy is unavailable")
        if len(response.body) > MAX_ROBOTS_BYTES:
            raise HTTPException(status_code=502, detail="robots policy exceeds the size limit")
        try:
            text = response.body.decode("utf-8", errors="strict")
        except UnicodeDecodeError as error:
            raise HTTPException(status_code=502, detail="robots policy is not UTF-8") from error
        if not re.search(r"(?im)^\s*user-agent\s*:\s*\S+", text):
            raise HTTPException(status_code=502, detail="robots policy cannot be parsed")

        parser = RobotFileParser(robots_url)
        parser.parse(text.splitlines())
        if not parser.can_fetch(FIXED_USER_AGENT, target_url):
            raise HTTPException(status_code=403, detail="robots policy disallows this path")
