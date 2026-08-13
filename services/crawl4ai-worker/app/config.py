from __future__ import annotations

import ipaddress
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Literal, Mapping
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator


HOST_PATTERN = re.compile(
    r"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+"
    r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$"
)
QUERY_KEY_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
AUDITED_PATH_PATTERN = re.compile(r"^/[A-Za-z0-9/_.+\-]+$")


class ConfigurationError(ValueError):
    """Raised when immutable worker configuration is not safe to load."""


class _ProfileModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    allowedPathPrefixes: list[str] = Field(min_length=1, max_length=20)
    allowedQueryKeys: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("allowedPathPrefixes")
    @classmethod
    def validate_prefixes(cls, prefixes: list[str]) -> list[str]:
        for prefix in prefixes:
            if (
                not prefix.startswith("/")
                or "//" in prefix
                or "\\" in prefix
                or "?" in prefix
                or "#" in prefix
                or not AUDITED_PATH_PATTERN.fullmatch(prefix)
                or any(segment in {".", ".."} for segment in prefix.split("/"))
            ):
                raise ValueError("path prefixes must be normalized absolute paths")
        return prefixes

    @field_validator("allowedQueryKeys")
    @classmethod
    def validate_query_keys(cls, keys: list[str]) -> list[str]:
        if len(keys) != len(set(keys)) or any(not QUERY_KEY_PATTERN.fullmatch(key) for key in keys):
            raise ValueError("query keys must be unique simple identifiers")
        return keys


class _MerchantModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool
    auditState: Literal["approved"]
    legalReview: Literal["approved"]
    provenSource: Literal["crawl4ai"]
    baseUrl: str = Field(max_length=2_048)
    allowedHosts: list[str] = Field(min_length=1, max_length=20)
    profiles: dict[Literal["product", "offer", "coupon"], _ProfileModel] = Field(
        min_length=1, max_length=3
    )

    @model_validator(mode="after")
    def validate_origin_and_hosts(self) -> "_MerchantModel":
        normalized_hosts: list[str] = []
        for raw_host in self.allowedHosts:
            host = raw_host.lower()
            try:
                ipaddress.ip_address(host)
            except ValueError:
                pass
            else:
                raise ValueError("IP literals are not allowed merchant hosts")
            if raw_host != host or not HOST_PATTERN.fullmatch(host):
                raise ValueError("allowed hosts must be exact lowercase DNS names")
            normalized_hosts.append(host)
        if len(normalized_hosts) != len(set(normalized_hosts)):
            raise ValueError("allowed hosts must be unique")

        parsed = urlsplit(self.baseUrl)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.hostname not in normalized_hosts
            or parsed.username is not None
            or parsed.password is not None
            or parsed.port not in {None, 443}
            or parsed.query
            or parsed.fragment
            or not parsed.path.startswith("/")
            or not AUDITED_PATH_PATTERN.fullmatch(parsed.path)
            or "//" in parsed.path
            or "\\" in parsed.path
            or any(segment in {".", ".."} for segment in parsed.path.split("/"))
        ):
            raise ValueError("base URL must be a credential-free audited HTTPS origin/path")
        base_path = parsed.path if parsed.path.endswith("/") else parsed.path + "/"
        for profile in self.profiles.values():
            if any(not prefix.startswith(base_path) for prefix in profile.allowedPathPrefixes):
                raise ValueError("profile paths must remain inside the base URL path")
        return self


class _SettingsModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    egressEnforced: bool = False
    proxyUrl: str | None = None
    merchants: dict[str, _MerchantModel] = Field(default_factory=dict, max_length=20)

    @model_validator(mode="after")
    def validate_proxy_and_ids(self) -> "_SettingsModel":
        if self.egressEnforced:
            if not self.proxyUrl:
                raise ValueError("egress enforcement requires a proxy")
            parsed = urlsplit(self.proxyUrl)
            if (
                parsed.scheme != "http"
                or not parsed.hostname
                or parsed.username is not None
                or parsed.password is not None
                or parsed.path not in {"", "/"}
                or parsed.query
                or parsed.fragment
                or parsed.port is None
            ):
                raise ValueError("proxy URL must be a credential-free internal HTTP endpoint")
        if any(not re.fullmatch(r"[a-z0-9-]{1,80}", merchant_id) for merchant_id in self.merchants):
            raise ValueError("invalid merchant ID")
        return self


@dataclass(frozen=True)
class ProfileSettings:
    allowed_path_prefixes: tuple[str, ...]
    allowed_query_keys: frozenset[str]


@dataclass(frozen=True)
class MerchantSettings:
    enabled: bool
    audit_state: str
    legal_review: str
    proven_source: str
    base_url: str
    allowed_hosts: frozenset[str]
    profiles: Mapping[str, ProfileSettings]


@dataclass(frozen=True)
class WorkerSettings:
    egress_enforced: bool
    proxy_url: str | None
    merchants: Mapping[str, MerchantSettings]

    @classmethod
    def from_mapping(cls, raw: Mapping[str, Any]) -> "WorkerSettings":
        try:
            model = _SettingsModel.model_validate(raw)
        except (ValidationError, ValueError) as error:
            raise ConfigurationError(str(error)) from error

        merchants: dict[str, MerchantSettings] = {}
        for merchant_id, merchant in model.merchants.items():
            profiles = {
                name: ProfileSettings(
                    allowed_path_prefixes=tuple(profile.allowedPathPrefixes),
                    allowed_query_keys=frozenset(profile.allowedQueryKeys),
                )
                for name, profile in merchant.profiles.items()
            }
            merchants[merchant_id] = MerchantSettings(
                enabled=merchant.enabled,
                audit_state=merchant.auditState,
                legal_review=merchant.legalReview,
                proven_source=merchant.provenSource,
                base_url=merchant.baseUrl,
                allowed_hosts=frozenset(merchant.allowedHosts),
                profiles=MappingProxyType(profiles),
            )
        return cls(
            egress_enforced=model.egressEnforced,
            proxy_url=model.proxyUrl,
            merchants=MappingProxyType(merchants),
        )

    def to_mapping(self) -> dict[str, Any]:
        return {
            "egressEnforced": self.egress_enforced,
            "proxyUrl": self.proxy_url,
            "merchants": {
                merchant_id: {
                    "enabled": merchant.enabled,
                    "auditState": merchant.audit_state,
                    "legalReview": merchant.legal_review,
                    "provenSource": merchant.proven_source,
                    "baseUrl": merchant.base_url,
                    "allowedHosts": sorted(merchant.allowed_hosts),
                    "profiles": {
                        name: {
                            "allowedPathPrefixes": list(profile.allowed_path_prefixes),
                            "allowedQueryKeys": sorted(profile.allowed_query_keys),
                        }
                        for name, profile in merchant.profiles.items()
                    },
                }
                for merchant_id, merchant in self.merchants.items()
            },
        }


def load_settings() -> WorkerSettings:
    config_path = Path(os.environ.get("CRAWLER_MERCHANTS_CONFIG", "/app/config/merchants.json"))
    if config_path.is_file():
        try:
            raw = json.loads(config_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ConfigurationError(f"cannot read worker configuration: {error}") from error
    else:
        raw = {"merchants": {}}

    if "CRAWLER_EGRESS_ENFORCED" in os.environ:
        raw["egressEnforced"] = os.environ["CRAWLER_EGRESS_ENFORCED"].lower() == "true"
    if "CRAWLER_PROXY_URL" in os.environ:
        raw["proxyUrl"] = os.environ["CRAWLER_PROXY_URL"]
    return WorkerSettings.from_mapping(raw)
