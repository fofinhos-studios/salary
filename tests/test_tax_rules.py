"""Brazilian public tax and exchange adapter checks."""

import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest

import br_rate
import tax_rules
from br_rate import Bulletin, get_brl_rate
from exchange import ProviderError
from models import Rate
from tax_rules import OFFICIAL_2026, get_tax_rules


@pytest.mark.asyncio
async def test_official_rules_survive_provider_failure() -> None:
    with patch("tax_rules._read_api_table", side_effect=OSError("offline")):
        result = await get_tax_rules(2026)
    assert result == OFFICIAL_2026
    with pytest.raises(ValueError):
        await get_tax_rules(2025)


@pytest.mark.asyncio
async def test_ptax_closing_buy_rate() -> None:
    rows = [
        Bulletin(cotacaoCompra=4, dataHoraCotacao="2026-10-02 10:00:00", tipoBoletim="Abertura"),
        Bulletin(cotacaoCompra=5, dataHoraCotacao="2026-10-02 13:00:00", tipoBoletim="Fechamento"),
    ]
    with patch("br_rate._read_ptax", return_value=rows):
        rate = await get_brl_rate("USD")
    assert rate.rate == 5 and rate.source == "BCB" and rate.date == "2026-10-02"


@pytest.mark.asyncio
async def test_ptax_rejects_invalid_code() -> None:
    with pytest.raises(ValueError):
        await get_brl_rate("../")


@pytest.mark.asyncio
async def test_ptax_identity_and_provider_fallback() -> None:
    assert (await get_brl_rate("BRL")).source == "identity"
    backup = Rate(
        base="USD",
        quote="BRL",
        rate=5,
        date="2026-10-02",
        source="Frankfurter",
        stale=False,
        max_age=3600,
    )
    with (
        patch("br_rate._read_ptax", return_value=[]),
        patch("br_rate.get_rate", return_value=backup),
    ):
        assert await get_brl_rate("USD") == backup
    with (
        patch("br_rate._read_ptax", side_effect=OSError("offline")),
        patch("br_rate.get_rate", return_value=backup),
    ):
        assert await get_brl_rate("USD") == backup


@pytest.mark.asyncio
async def test_provider_rule_metadata_and_cache() -> None:
    tax_rules._cached = None
    verified = {
        "evidence": {"status": "verified"},
        "effectiveFrom": "2026-01-01",
        "values": {
            "ceiling": 8475.55,
            "brackets": [
                {"limit": limit, "rate": rate} for limit, rate in OFFICIAL_2026.inss_employee
            ],
        },
    }
    with patch("tax_rules._read_api_table", return_value=verified) as read:
        result = await get_tax_rules(2026)
        assert (await get_tax_rules(2026)) is result
    assert result.source == "official_snapshot_inss_verified"
    assert read.call_count == 1
    tax_rules._cached = None


def test_provider_response_validation() -> None:
    class Response:
        def __init__(self, payload: bytes):
            self.payload = payload

        def __enter__(self):
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def read(self, _: int) -> bytes:
            return self.payload

    with patch(
        "br_rate.urlopen",
        return_value=Response(
            json.dumps(
                {
                    "value": [
                        {
                            "cotacaoCompra": 5,
                            "dataHoraCotacao": "2026-10-02 13:00:00",
                            "tipoBoletim": "Fechamento",
                        }
                    ]
                }
            ).encode()
        ),
    ):
        assert br_rate._read_ptax("USD")[0].cotacaoCompra == 5
    with patch("br_rate.urlopen", return_value=Response(b"{}")):
        with pytest.raises(ProviderError):
            br_rate._read_ptax("USD")
    with patch("tax_rules.urlopen", return_value=Response(b"{}")):
        assert tax_rules._read_api_table("inss") == {}
    with patch("tax_rules.urlopen", return_value=Response(b"x" * 100_001)):
        with pytest.raises(ValueError, match="Oversized"):
            tax_rules._read_api_table("inss")


@pytest.mark.asyncio
async def test_unverified_or_changed_inss_never_claims_provider_verification() -> None:
    for payload in (
        {},
        {
            "evidence": {"status": "verified"},
            "effectiveFrom": "2026-01-01",
            "values": {"ceiling": 8475.55},
        },
    ):
        tax_rules._cached = None
        with patch("tax_rules._read_api_table", return_value=payload):
            assert (await get_tax_rules(2026)).source == "official_snapshot"
    tax_rules._cached = None


@pytest.mark.asyncio
async def test_http_adapters() -> None:
    import app as local
    from api.index import app as vercel_app

    request = SimpleNamespace(query_params={"base": "USD", "year": "2026"})
    with (
        patch(
            "app.get_brl_rate",
            return_value=Rate(
                base="USD",
                quote="BRL",
                rate=5,
                date="2026-10-02",
                source="BCB",
                stale=False,
                max_age=3600,
            ),
        ),
        patch("app.get_tax_rules", return_value=OFFICIAL_2026),
    ):
        assert local.json.loads((await local.br_rate_endpoint(request)).description)["rate"] == 5
        assert (
            local.json.loads((await local.tax_rules_endpoint(request)).description)["year"] == 2026
        )
    assert (
        await local.tax_rules_endpoint(SimpleNamespace(query_params={"year": "bad"}))
    ).status_code == 400
    assert (
        await local.br_rate_endpoint(SimpleNamespace(query_params={"base": "../"}))
    ).status_code == 400
    with patch("app.get_brl_rate", side_effect=ProviderError("offline")):
        assert (await local.br_rate_endpoint(request)).status_code == 503
    sent: list[dict[str, object]] = []

    async def receive() -> object:
        return {}

    async def send(message: dict[str, object]) -> None:
        sent.append(message)

    with (
        patch(
            "api.index.get_brl_rate",
            return_value=Rate(
                base="USD",
                quote="BRL",
                rate=5,
                date="2026-10-02",
                source="BCB",
                stale=False,
                max_age=3600,
            ),
        ),
        patch("api.index.get_tax_rules", return_value=OFFICIAL_2026),
    ):
        await vercel_app(
            {"type": "http", "method": "GET", "query_string": b"resource=br_rate&base=USD"},
            receive,
            send,
        )
        assert sent[0]["status"] == 200
        sent.clear()
        await vercel_app(
            {"type": "http", "method": "GET", "query_string": b"resource=tax_rules&year=2026"},
            receive,
            send,
        )
        assert sent[0]["status"] == 200
    sent.clear()
    await vercel_app(
        {"type": "http", "method": "GET", "query_string": b"resource=tax_rules&year=bad"},
        receive,
        send,
    )
    assert sent[0]["status"] == 400
    sent.clear()
    with patch("api.index.get_brl_rate", side_effect=ValueError("bad")):
        await vercel_app(
            {"type": "http", "method": "GET", "query_string": b"resource=br_rate&base=BAD"},
            receive,
            send,
        )
    assert sent[0]["status"] == 400
    sent.clear()
    with patch("api.index.get_brl_rate", side_effect=ProviderError("offline")):
        await vercel_app(
            {"type": "http", "method": "GET", "query_string": b"resource=br_rate&base=USD"},
            receive,
            send,
        )
    assert sent[0]["status"] == 503
