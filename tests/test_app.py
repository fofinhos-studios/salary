"""Exchange service and public contract tests."""

import json
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from polyfactory.factories.pydantic_factory import ModelFactory
from pydantic import ValidationError

import exchange
from models import CurrenciesResponse, Currency, ErrorResponse, Rate


class CurrencyFactory(ModelFactory[Currency]):
    __model__ = Currency


class RateFactory(ModelFactory[Rate]):
    __model__ = Rate


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    now = [100_000.0]
    monkeypatch.setattr(exchange, "time", SimpleNamespace(monotonic=lambda: now[0]))
    exchange.rates.clear()
    exchange.catalogue = None
    return now


@pytest.fixture
def currencies(clock: list[float]) -> list[Currency]:
    result = [CurrencyFactory.build(code=code) for code in ("USD", "BRL", "EUR", "JPY")]
    exchange.catalogue = (clock[0], result)
    return result


@pytest.fixture
def sample_rate() -> Rate:
    return RateFactory.build(
        base="USD",
        quote="BRL",
        rate=5.0,
        date="2026-10-02",
        source="Frankfurter",
        stale=False,
    )


@pytest.fixture
def provider_rate() -> dict[str, object]:
    return {"base": "USD", "quote": "BRL", "rate": 5.0, "date": "2026-10-02"}


@pytest.mark.parametrize("case", json.loads((Path(__file__).parent / "contracts.json").read_text()))
def test_public_contract(case: dict[str, object]) -> None:
    models = {"rate": Rate, "currencies": CurrenciesResponse, "error": ErrorResponse}
    model = models[str(case["kind"])]
    if case["valid"]:
        assert model.model_validate(case["payload"]).model_dump(mode="json") == case["payload"]
    else:
        with pytest.raises(ValidationError):
            model.model_validate(case["payload"])


@pytest.mark.parametrize(
    "base,quote", [("usd", "BRL"), ("../", "USD"), ("ZZZ", "USD"), ("", "BRL")]
)
async def test_invalid_currency_skips_fetch(
    currencies: list[Currency], base: str, quote: str
) -> None:
    with patch.object(exchange, "fetch_json", new_callable=AsyncMock) as fetch:
        with pytest.raises(ValueError, match="invalid_currency"):
            await exchange.get_rate(base, quote)
        fetch.assert_not_awaited()


async def test_identity_skips_fetch(currencies: list[Currency]) -> None:
    with patch.object(exchange, "fetch_json", new_callable=AsyncMock) as fetch:
        result = await exchange.get_rate("USD", "USD")
        assert result.rate == 1 and result.date is None and result.source == "identity"
        fetch.assert_not_awaited()


async def test_rate_is_cached(currencies: list[Currency], provider_rate: dict[str, object]) -> None:
    with patch.object(exchange, "fetch_json", AsyncMock(return_value=provider_rate)) as fetch:
        assert (await exchange.get_rate("USD", "BRL")).date == "2026-10-02"
        assert (await exchange.get_rate("USD", "BRL")).rate == 5
        fetch.assert_awaited_once()


async def test_expired_rate_refreshes(
    currencies: list[Currency],
    clock: list[float],
    sample_rate: Rate,
    provider_rate: dict[str, object],
) -> None:
    exchange.rates["USD/BRL"] = (clock[0] - exchange.HOUR, sample_rate)
    with patch.object(exchange, "fetch_json", AsyncMock(return_value={**provider_rate, "rate": 6})):
        assert (await exchange.get_rate("USD", "BRL")).rate == 6


async def test_recent_stale_rate_survives_failure(
    currencies: list[Currency], clock: list[float], sample_rate: Rate
) -> None:
    exchange.rates["USD/BRL"] = (clock[0] - exchange.DAY, sample_rate)
    with patch.object(exchange, "fetch_json", AsyncMock(side_effect=exchange.ProviderError)):
        stale = await exchange.get_rate("USD", "BRL")
    assert stale.stale and stale.max_age == 60 and stale.date == sample_rate.date
    assert not sample_rate.stale


@pytest.mark.parametrize("age", [exchange.MAX_STALE, exchange.MAX_STALE + 1])
async def test_stale_rate_expires(
    currencies: list[Currency], clock: list[float], sample_rate: Rate, age: int
) -> None:
    exchange.rates["USD/BRL"] = (clock[0] - age, sample_rate)
    with patch.object(exchange, "fetch_json", AsyncMock(side_effect=exchange.ProviderError)):
        with pytest.raises(exchange.ProviderError):
            await exchange.get_rate("USD", "BRL")


async def test_pair_cache_evicts_oldest(
    currencies: list[Currency], provider_rate: dict[str, object], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(exchange, "MAX_PAIRS", 2)
    for quote in ("BRL", "EUR", "JPY"):
        with patch.object(
            exchange, "fetch_json", AsyncMock(return_value={**provider_rate, "quote": quote})
        ):
            await exchange.get_rate("USD", quote)
    assert list(exchange.rates) == ["USD/EUR", "USD/JPY"]


@pytest.mark.parametrize(
    "invalid",
    [
        None,
        [],
        {},
        {"rate": 0},
        {"rate": float("nan")},
        {"rate": True},
        {"rate": -1},
        {"date": "2026-02-30"},
        {"base": "EUR"},
    ],
)
async def test_invalid_provider_rate(
    currencies: list[Currency], provider_rate: dict[str, object], invalid: object
) -> None:
    payload = {**provider_rate, **invalid} if isinstance(invalid, dict) and invalid else invalid
    with patch.object(exchange, "fetch_json", AsyncMock(return_value=payload)):
        with pytest.raises(exchange.ProviderError):
            await exchange.get_rate("USD", "BRL")


async def test_catalogue_sorts_and_caches(clock: list[float]) -> None:
    payload = [{"iso_code": "USD", "name": "US Dollar"}, {"iso_code": "BRL", "name": "Real"}]
    with patch.object(exchange, "fetch_json", AsyncMock(return_value=payload)) as fetch:
        assert [row.code for row in await exchange.get_currencies()] == ["BRL", "USD"]
        await exchange.get_currencies()
        fetch.assert_awaited_once()


async def test_catalogue_uses_recent_cache_on_failure(
    clock: list[float], currencies: list[Currency]
) -> None:
    exchange.catalogue = (clock[0] - exchange.DAY, currencies)
    with patch.object(exchange, "fetch_json", AsyncMock(side_effect=exchange.ProviderError)):
        assert await exchange.get_currencies() == currencies


async def test_catalogue_failure_without_cache(clock: list[float]) -> None:
    with patch.object(exchange, "fetch_json", AsyncMock(side_effect=exchange.ProviderError)):
        with pytest.raises(exchange.ProviderError):
            await exchange.get_currencies()


@pytest.mark.parametrize(
    "payload", [[], {}, [{"iso_code": "../", "name": "Invalid"}], [{"iso_code": "USD", "name": ""}]]
)
async def test_invalid_catalogue(clock: list[float], payload: object) -> None:
    with patch.object(exchange, "fetch_json", AsyncMock(return_value=payload)):
        with pytest.raises(exchange.ProviderError):
            await exchange.get_currencies()


async def test_network_timeout_is_provider_error(clock: list[float]) -> None:
    with patch.object(exchange, "read_json", side_effect=TimeoutError):
        with pytest.raises(exchange.ProviderError):
            await exchange.fetch_json("/rate/USD/BRL")


def test_read_json_limits_response_size() -> None:
    with patch.object(exchange, "urlopen", return_value=BytesIO(b"x" * 1_000_001)):
        with pytest.raises(exchange.ProviderError, match="too large"):
            exchange.read_json("/currencies")


def test_read_json_decodes_provider_payload() -> None:
    with patch.object(exchange, "urlopen", return_value=BytesIO(b'{"rate":5}')) as open_url:
        assert exchange.read_json("/rate/USD/BRL") == {"rate": 5}
        assert open_url.call_args.kwargs["timeout"] == 5


@pytest.mark.parametrize(
    "resource,error,status",
    [
        ("missing", "not_found", 404),
        ("rate", "invalid_currency", 400),
        ("rate", "rate_unavailable", 503),
        ("currencies", "provider_unavailable", 503),
    ],
)
async def test_dispatch_errors(resource: str, error: str, status: int, clock: list[float]) -> None:
    if error == "invalid_currency":
        result, actual = await exchange.dispatch(resource, "../", "USD")
    elif error == "not_found":
        result, actual = await exchange.dispatch(resource)
    else:
        with patch.object(exchange, "fetch_json", AsyncMock(side_effect=exchange.ProviderError)):
            result, actual = await exchange.dispatch(resource, "USD", "BRL")
    assert actual == status and isinstance(result, ErrorResponse) and result.error == error
