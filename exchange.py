"""Tiny Salary: static frontend and a small, cached exchange-rate proxy."""

import asyncio
import json
import logging
import re
import time
from collections import OrderedDict
from urllib.error import URLError
from urllib.request import Request as URLRequest
from urllib.request import urlopen

from pydantic import ValidationError

from models import (
    ApiResponse,
    CurrenciesResponse,
    Currency,
    ErrorResponse,
    ProviderCurrency,
    ProviderRate,
    Rate,
)

API = "https://api.frankfurter.dev/v2"
HOUR = 3600
DAY = 24 * HOUR
MAX_PAIRS = 256
MAX_STALE = 7 * DAY
log = logging.getLogger(__name__)


catalogue: tuple[float, list[Currency]] | None = None
# ponytail: per-process caches; use a shared cache only if multiple workers need one.
rates: OrderedDict[str, tuple[float, Rate]] = OrderedDict()


class ProviderError(Exception):
    """No usable response from the currency provider."""


def read_json(path: str) -> object:
    request = URLRequest(API + path, headers={"User-Agent": "TinySalary/0.1"})
    with urlopen(request, timeout=5) as response:
        data = response.read(1_000_001)
        if len(data) > 1_000_000:
            raise ProviderError("Response too large")
        return json.loads(data)


async def fetch_json(path: str) -> object:
    try:
        return await asyncio.wait_for(asyncio.to_thread(read_json, path), timeout=5)
    except (URLError, TimeoutError, OSError, ValueError) as exc:
        raise ProviderError("Currency provider unavailable") from exc


async def get_currencies() -> list[Currency]:
    global catalogue
    now = time.monotonic()
    if catalogue and now - catalogue[0] < DAY:
        return catalogue[1]
    try:
        payload = await fetch_json("/currencies")
        if not isinstance(payload, list) or not payload:
            raise ProviderError("Invalid currency catalogue")
        try:
            result: list[Currency] = []
            for item in payload:
                currency = ProviderCurrency.model_validate(item)
                result.append(Currency(code=currency.iso_code, name=currency.name))
        except ValidationError as exc:
            raise ProviderError("Invalid currency catalogue") from exc
        catalogue = (time.monotonic(), sorted(result, key=lambda row: row.code))
        return catalogue[1]
    except ProviderError:
        if catalogue and now - catalogue[0] < MAX_STALE:
            return catalogue[1]
        raise


async def get_rate(base: str, quote: str) -> Rate:
    if not all(re.fullmatch(r"[A-Z]{3}", code) for code in (base, quote)):
        raise ValueError("invalid_currency")
    available = {row.code for row in await get_currencies()}
    if base not in available or quote not in available:
        raise ValueError("invalid_currency")
    if base == quote:
        return Rate(
            base=base, quote=quote, rate=1.0, date=None, source="identity", stale=False, max_age=DAY
        )
    key = f"{base}/{quote}"
    now = time.monotonic()
    cached = rates.get(key)
    if cached:
        rates.move_to_end(key)
        age = now - cached[0]
        if age < HOUR:
            return cached[1].model_copy(update={"max_age": max(0, int(HOUR - age))})
    try:
        payload = await fetch_json(f"/rate/{key}")
        try:
            provider = ProviderRate.model_validate(payload)
            if provider.base != base or provider.quote != quote:
                raise ProviderError("Invalid rate response")
            result = Rate(
                base=base,
                quote=quote,
                rate=provider.rate,
                date=provider.date,
                source="Frankfurter",
                stale=False,
                max_age=HOUR,
            )
        except ValidationError as exc:
            raise ProviderError("Invalid rate response") from exc
        rates[key] = (time.monotonic(), result)
        rates.move_to_end(key)
        while len(rates) > MAX_PAIRS:
            rates.popitem(last=False)
        return result
    except ProviderError:
        if cached and now - cached[0] < MAX_STALE:
            return cached[1].model_copy(update={"stale": True, "max_age": 60})
        raise


async def dispatch(resource: str, base: str = "", quote: str = "") -> tuple[ApiResponse, int]:
    try:
        if resource == "currencies":
            return CurrenciesResponse(currencies=await get_currencies()), 200
        if resource == "rate":
            return await get_rate(base, quote), 200
        return ErrorResponse(error="not_found"), 404
    except ValueError:
        return ErrorResponse(error="invalid_currency"), 400
    except ProviderError:
        log.warning("Currency provider unavailable for %s", resource)
        if resource == "currencies":
            return ErrorResponse(error="provider_unavailable"), 503
        return ErrorResponse(error="rate_unavailable"), 503
