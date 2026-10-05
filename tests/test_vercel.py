import json
import time
import unittest
from unittest.mock import AsyncMock

import exchange
from api.index import app


class VercelTests(unittest.IsolatedAsyncioTestCase):
    async def test_routing_validation_and_method(self):
        exchange.catalogue = (time.monotonic(), [{"code": "USD", "name": "US Dollar"}])
        for method, query, status, expected in [
            ("GET", b"resource=currencies", 200, {"currencies": exchange.catalogue[1]}),
            ("GET", b"resource=rate&base=USD&quote=USD", 200, {"rate": 1.0}),
            ("GET", b"resource=rate&base=../&quote=USD", 400, {"error": "invalid_currency"}),
            ("GET", b"resource=missing", 404, {"error": "not_found"}),
            ("POST", b"resource=rate", 405, {"error": "method_not_allowed"}),
        ]:
            with self.subTest(method=method, query=query):
                send = AsyncMock()
                await app(
                    {"type": "http", "method": method, "query_string": query}, AsyncMock(), send
                )
                start, body = [call.args[0] for call in send.await_args_list]
                self.assertEqual(start["status"], status)
                self.assertIn((b"cache-control", b"no-store"), start["headers"])
                self.assertTrue(expected.items() <= json.loads(body["body"]).items())
