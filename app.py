"""Tiny Salary: static frontend and a small, cached exchange-rate proxy."""

import asyncio
import json
import logging
import math
import os
import re
import time
from collections import OrderedDict
from datetime import date
from pathlib import Path
from typing import Any, TypedDict
from urllib.error import URLError
from urllib.request import Request as URLRequest
from urllib.request import urlopen

from robyn import Request, Response, Robyn, serve_html
from robyn.responses import FileResponse

ROOT = Path(__file__).parent
API = "https://api.frankfurter.dev/v2"
HOUR = 3600
DAY = 24 * HOUR
MAX_PAIRS = 256
MAX_STALE = 7 * DAY
log = logging.getLogger(__name__)


class Currency(TypedDict):
    code: str
    name: str


class Rate(TypedDict):
    base: str
    quote: str
    rate: float
    date: str | None
    source: str
    stale: bool
    max_age: int


catalogue: tuple[float, list[Currency]] | None = None
# ponytail: per-process caches; use a shared cache only if multiple workers need one.
rates: OrderedDict[str, tuple[float, Rate]] = OrderedDict()


class ProviderError(Exception):
    """No usable response from the currency provider."""


def read_json(path: str) -> Any:
    request = URLRequest(API + path, headers={"User-Agent": "TinySalary/0.1"})
    with urlopen(request, timeout=5) as response:
        data = response.read(1_000_001)
        if len(data) > 1_000_000:
            raise ProviderError("Response too large")
        return json.loads(data)


async def fetch_json(path: str) -> Any:
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
        result: list[Currency] = []
        for item in payload:
            if (
                not isinstance(item, dict)
                or not isinstance(item.get("iso_code"), str)
                or not re.fullmatch(r"[A-Z]{3}", item["iso_code"])
                or not isinstance(item.get("name"), str)
                or not item["name"]
            ):
                raise ProviderError("Invalid currency catalogue")
            result.append({"code": item["iso_code"], "name": item["name"]})
        catalogue = (time.monotonic(), sorted(result, key=lambda row: row["code"]))
        return catalogue[1]
    except ProviderError:
        if catalogue and now - catalogue[0] < MAX_STALE:
            return catalogue[1]
        raise


async def get_rate(base: str, quote: str) -> Rate:
    if not all(re.fullmatch(r"[A-Z]{3}", code) for code in (base, quote)):
        raise ValueError("invalid_currency")
    available = {row["code"] for row in await get_currencies()}
    if base not in available or quote not in available:
        raise ValueError("invalid_currency")
    if base == quote:
        return {
            "base": base,
            "quote": quote,
            "rate": 1.0,
            "date": None,
            "source": "identity",
            "stale": False,
            "max_age": DAY,
        }
    key = f"{base}/{quote}"
    now = time.monotonic()
    cached = rates.get(key)
    if cached:
        rates.move_to_end(key)
        age = now - cached[0]
        if age < HOUR:
            return {**cached[1], "max_age": max(0, int(HOUR - age))}
    try:
        payload = await fetch_json(f"/rate/{key}")
        if not isinstance(payload, dict):
            raise ProviderError("Invalid rate response")
        value, reference = payload.get("rate"), payload.get("date")
        if (
            payload.get("base") != base
            or payload.get("quote") != quote
            or isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
            or value <= 0
            or not isinstance(reference, str)
            or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", reference)
        ):
            raise ProviderError("Invalid rate response")
        try:
            date.fromisoformat(reference)
        except ValueError as exc:
            raise ProviderError("Invalid reference date") from exc
        result: Rate = {
            "base": base,
            "quote": quote,
            "rate": float(value),
            "date": reference,
            "source": "Frankfurter",
            "stale": False,
            "max_age": HOUR,
        }
        rates[key] = (time.monotonic(), result)
        rates.move_to_end(key)
        while len(rates) > MAX_PAIRS:
            rates.popitem(last=False)
        return result
    except ProviderError:
        if cached and now - cached[0] < MAX_STALE:
            return {**cached[1], "stale": True, "max_age": 60}
        raise


def json_response(payload: object, status: int = 200) -> Response:
    return Response(
        status_code=status,
        headers={"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"},
        description=json.dumps(payload, allow_nan=False),
    )


app = Robyn(__file__)
app.add_response_header("X-Content-Type-Options", "nosniff")
app.add_response_header("Referrer-Policy", "no-referrer")
app.add_response_header(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self'; font-src 'self'; "
    "script-src 'self'; style-src 'self'; connect-src 'self'; "
    "object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
)
app.serve_directory(route="/static", directory_path=str(ROOT / "static"), show_files_listing=False)


@app.get("/")
async def index() -> FileResponse:
    return serve_html(str(ROOT / "static" / "index.html"))


@app.get("/api/currencies")
async def currencies_endpoint() -> Response:
    try:
        return json_response({"currencies": await get_currencies()})
    except ProviderError:
        log.warning("Currency catalogue unavailable")
        return json_response({"error": "provider_unavailable"}, 503)


@app.get("/api/rate")
async def rate_endpoint(request: Request) -> Response:
    base = request.query_params.get("base", "") or ""
    quote = request.query_params.get("quote", "") or ""
    try:
        return json_response(await get_rate(base, quote))
    except ValueError:
        return json_response({"error": "invalid_currency"}, 400)
    except ProviderError:
        log.warning("Exchange rate unavailable for %s/%s", base, quote)
        return json_response({"error": "rate_unavailable"}, 503)


if __name__ == "__main__":
    app.start(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8765")))
