import json
import time
import unittest
from unittest.mock import AsyncMock, Mock, patch

import app

SAMPLE = {"base": "USD", "quote": "BRL", "rate": 5.0, "date": "2026-10-02"}
CURRENCIES: list[app.Currency] = [
    {"code": code, "name": code} for code in ("USD", "BRL", "EUR", "JPY")
]


class ExchangeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        app.rates.clear()
        app.catalogue = (time.monotonic(), CURRENCIES)

    async def test_rate_cache_keeps_reference_date_and_identity_needs_no_rate_fetch(self):
        with patch.object(app, "fetch_json", AsyncMock(return_value=SAMPLE)) as fetch:
            first = await app.get_rate("USD", "BRL")
            second = await app.get_rate("USD", "BRL")
            self.assertEqual(first["date"], "2026-10-02")
            self.assertEqual(second["rate"], 5)
            self.assertFalse(second["stale"])
            self.assertLessEqual(second["max_age"], app.HOUR)
            self.assertEqual((await app.get_rate("USD", "USD"))["rate"], 1)
            fetch.assert_awaited_once()

    async def test_invalid_codes_are_rejected_without_rate_lookup(self):
        with patch.object(app, "fetch_json", AsyncMock()) as fetch:
            for base, quote in [("usd", "BRL"), ("../", "USD"), ("ZZZ", "USD"), ("", "BRL")]:
                with self.subTest(base=base), self.assertRaises(ValueError):
                    await app.get_rate(base, quote)
            fetch.assert_not_awaited()

    async def test_malformed_provider_responses_are_rejected(self):
        payloads = [None, [], {}, {**SAMPLE, "base": "EUR"}, {**SAMPLE, "date": "2026-02-30"}]
        payloads += [{**SAMPLE, "rate": value} for value in (0, -1, True, "5", float("nan"))]
        for payload in payloads:
            with self.subTest(payload=payload):
                with patch.object(app, "fetch_json", AsyncMock(return_value=payload)):
                    with self.assertRaises(app.ProviderError):
                        await app.get_rate("USD", "BRL")

    async def test_expired_cache_refreshes_or_falls_back_for_at_most_seven_days(self):
        with patch.object(app, "fetch_json", AsyncMock(return_value=SAMPLE)):
            first = await app.get_rate("USD", "BRL")
        app.rates["USD/BRL"] = (time.monotonic() - app.HOUR - 1, first)
        with patch.object(app, "fetch_json", AsyncMock(return_value={**SAMPLE, "rate": 6})):
            self.assertEqual((await app.get_rate("USD", "BRL"))["rate"], 6)
        app.rates["USD/BRL"] = (time.monotonic() - app.DAY, first)
        with patch.object(app, "fetch_json", AsyncMock(side_effect=app.ProviderError)):
            stale = await app.get_rate("USD", "BRL")
            self.assertTrue(stale["stale"])
            self.assertEqual(stale["date"], SAMPLE["date"])
            self.assertFalse(first["stale"])
            app.rates["USD/BRL"] = (time.monotonic() - app.MAX_STALE - 1, first)
            with self.assertRaises(app.ProviderError):
                await app.get_rate("USD", "BRL")
            app.rates.clear()
            with self.assertRaises(app.ProviderError):
                await app.get_rate("USD", "BRL")

    async def test_cache_has_a_hard_pair_limit(self):
        with patch.object(app, "MAX_PAIRS", 2):
            for quote in ("BRL", "EUR", "JPY"):
                with patch.object(
                    app, "fetch_json", AsyncMock(return_value={**SAMPLE, "quote": quote})
                ):
                    await app.get_rate("USD", quote)
            self.assertEqual(list(app.rates), ["USD/EUR", "USD/JPY"])

    async def test_catalogue_validation_caching_and_failure(self):
        app.catalogue = None
        payload = [{"iso_code": "USD", "name": "US Dollar"}, {"iso_code": "BRL", "name": "Real"}]
        with patch.object(app, "fetch_json", AsyncMock(return_value=payload)) as fetch:
            result = await app.get_currencies()
            self.assertEqual([row["code"] for row in result], ["BRL", "USD"])
            await app.get_currencies()
            fetch.assert_awaited_once()
        app.catalogue = (time.monotonic() - app.DAY - 1, result)
        with patch.object(app, "fetch_json", AsyncMock(side_effect=app.ProviderError)):
            self.assertEqual(await app.get_currencies(), result)
        app.catalogue = None
        for payload in ([], {}, [{"iso_code": "../", "name": "Invalid"}]):
            with patch.object(app, "fetch_json", AsyncMock(return_value=payload)):
                with self.assertRaises(app.ProviderError):
                    await app.get_currencies()

    async def test_network_timeout_is_a_provider_error(self):
        with patch.object(app, "read_json", side_effect=TimeoutError):
            with self.assertRaises(app.ProviderError):
                await app.fetch_json("/rate/USD/BRL")

    async def test_endpoints_return_explicit_errors(self):
        request = Mock(spec=app.Request)
        request.query_params = {"base": "USD", "quote": "BRL"}
        with patch.object(app, "get_rate", AsyncMock(side_effect=ValueError)):
            response = await app.rate_endpoint(request)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(json.loads(response.description)["error"], "invalid_currency")
        with patch.object(app, "get_rate", AsyncMock(side_effect=app.ProviderError)):
            self.assertEqual((await app.rate_endpoint(request)).status_code, 503)
        with patch.object(app, "get_currencies", AsyncMock(side_effect=app.ProviderError)):
            self.assertEqual((await app.currencies_endpoint()).status_code, 503)


if __name__ == "__main__":
    unittest.main()
