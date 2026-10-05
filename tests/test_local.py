"""Local Robyn adapter checks."""

import json
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, patch

from robyn import Request

import app as local
import exchange
from models import Currency, ErrorResponse


def test_json_response_serializes_model() -> None:
    result = local.json_response(ErrorResponse(error="not_found"), 404)
    assert result.status_code == 404
    assert json.loads(result.description) == {"error": "not_found"}
    assert result.headers["Cache-Control"] == "no-store"


async def test_local_currencies_endpoint() -> None:
    exchange.catalogue = (exchange.time.monotonic(), [Currency(code="USD", name="US Dollar")])
    result = await local.currencies_endpoint()
    assert result.status_code == 200
    assert json.loads(result.description) == {"currencies": [{"code": "USD", "name": "US Dollar"}]}


async def test_local_rate_endpoint_rejects_invalid_code() -> None:
    request = cast(Request, SimpleNamespace(query_params={"base": "../", "quote": "USD"}))
    result = await local.rate_endpoint(request)
    assert result.status_code == 400
    assert json.loads(result.description) == {"error": "invalid_currency"}


async def test_local_rate_endpoint_uses_query_params() -> None:
    request = cast(Request, SimpleNamespace(query_params={"base": "USD", "quote": "BRL"}))
    with patch.object(exchange, "get_rate", AsyncMock(side_effect=exchange.ProviderError)):
        result = await local.rate_endpoint(request)
    assert result.status_code == 503
    assert json.loads(result.description) == {"error": "rate_unavailable"}


async def test_local_index_serves_html() -> None:
    result = await local.index()
    assert result.status_code == 200
