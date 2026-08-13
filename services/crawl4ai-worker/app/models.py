from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


ExtractionProfile = Literal["product", "offer", "coupon"]


class ExtractRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    merchantId: str = Field(pattern=r"^[a-z0-9-]{1,80}$")
    resourcePath: str = Field(min_length=2, max_length=500)
    extractionProfile: ExtractionProfile


class DynamicPageEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    merchantId: str = Field(pattern=r"^[a-z0-9-]{1,80}$")
    sourceUrl: str = Field(min_length=1, max_length=2_048)
    rawEvidence: str
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    sourceVersion: Literal["crawl4ai-0.9.2"]
    checkedAt: str
    metadata: dict[str, str] = Field(max_length=8)

    @field_validator("checkedAt")
    @classmethod
    def checked_at_is_strict_utc(cls, value: str) -> str:
        if not value.endswith("Z"):
            raise ValueError("checkedAt must use the UTC Z suffix")
        parsed = datetime.fromisoformat(value.removesuffix("Z") + "+00:00")
        if parsed.tzinfo != timezone.utc:
            raise ValueError("checkedAt must be UTC")
        return value

    @field_validator("metadata")
    @classmethod
    def metadata_is_bounded(cls, value: dict[str, str]) -> dict[str, str]:
        if any(len(key) > 40 or len(item) > 200 for key, item in value.items()):
            raise ValueError("metadata keys and values must be bounded")
        return value
