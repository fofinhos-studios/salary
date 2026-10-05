"""HTTP adapter checks for the Vercel entry point."""

import json

import pytest

import exchange
from api.index import app
from models import CurrenciesResponse, Currency, Rate


@pytest.mark.parametrize(
    "method,query,status,expected",
    [
        ("GET", b"resource=currencies", 200, "currencies"),
        ("GET", b"resource=rate&base=USD&quote=USD", 200, "identity"),
        ("GET", b"resource=rate&base=../&quote=USD", 400, "invalid_currency"),
        ("GET", b"resource=missing", 404, "not_found"),
        ("POST", b"resource=rate", 405, "method_not_allowed"),
    ],
)
async def test_vercel_response(method: str, query: bytes, status: int, expected: str) -> None:
    exchange.catalogue = (exchange.time.monotonic(), [Currency(code="USD", name="US Dollar")])
    sent: list[dict[str, object]] = []

    async def receive() -> object:
        return {}

    async def send(message: dict[str, object]) -> None:
        sent.append(message)

    await app({"type": "http", "method": method, "query_string": query}, receive, send)
    start, body = sent
    assert start["status"] == status
    assert isinstance(start["headers"], list)
    assert (b"cache-control", b"no-store") in start["headers"]
    assert isinstance(body["body"], bytes)
    payload = json.loads(body["body"])
    if expected == "currencies":
        CurrenciesResponse.model_validate(payload)
    elif expected == "identity":
        assert Rate.model_validate(payload).source == "identity"
    else:
        assert payload == {"error": expected}


async def test_non_http_scope_sends_nothing() -> None:
    sent: list[dict[str, object]] = []

    async def receive() -> object:
        return {}

    async def send(message: dict[str, object]) -> None:
        sent.append(message)

    await app({"type": "websocket"}, receive, send)
    assert sent == []
