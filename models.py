"""Validated provider payloads and the public exchange API contract."""

from datetime import date as CalendarDate
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Code = Annotated[str, Field(pattern=r"^[A-Z]{3}$")]
PositiveRate = Annotated[float, Field(gt=0, allow_inf_nan=False)]


class Currency(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    code: Code
    name: Annotated[str, Field(min_length=1)]


class ProviderCurrency(BaseModel):
    model_config = ConfigDict(strict=True, extra="ignore")

    iso_code: Code
    name: Annotated[str, Field(min_length=1)]


class ProviderRate(BaseModel):
    model_config = ConfigDict(strict=True, extra="ignore")

    base: Code
    quote: Code
    rate: PositiveRate
    date: str

    @field_validator("date")
    @classmethod
    def valid_date(cls, value: str) -> str:
        if len(value) != 10 or CalendarDate.fromisoformat(value).isoformat() != value:
            raise ValueError("Invalid reference date")
        return value


class Rate(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    base: Code
    quote: Code
    rate: PositiveRate
    date: str | None
    source: Literal["Frankfurter", "BCB", "identity"]
    stale: bool
    max_age: Annotated[int, Field(ge=0)]

    @model_validator(mode="after")
    def consistent_source(self) -> "Rate":
        if self.source == "identity":
            if self.base != self.quote or self.rate != 1 or self.date is not None or self.stale:
                raise ValueError("Invalid identity rate")
        elif self.date is None:
            raise ValueError("Missing reference date")
        else:
            ProviderRate(base=self.base, quote=self.quote, rate=self.rate, date=self.date)
        return self


class CurrenciesResponse(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    currencies: Annotated[list[Currency], Field(min_length=1)]


class ErrorResponse(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    error: Literal[
        "not_found",
        "method_not_allowed",
        "invalid_currency",
        "provider_unavailable",
        "rate_unavailable",
        "rules_unavailable",
    ]


class TaxRules(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    year: Literal[2026]
    valid_from: str
    checked_at: str
    source: Literal["official_snapshot", "official_snapshot_with_api"]
    inss_employee: list[tuple[float, float]]
    inss_ceiling: float
    minimum_wage: float
    ir_monthly: list[tuple[float, float, float]]
    ir_annual: list[tuple[float, float, float]]
    plr: list[tuple[float, float, float]]
    dependent_monthly: float
    dependent_annual: float
    simplified_monthly: float
    simplified_annual: float
    education_annual: float
    sources: dict[str, str]


ApiResponse = CurrenciesResponse | Rate | TaxRules | ErrorResponse
