"""Vercel ASGI entry point, sharing the local server's exchange service."""

import json
from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import parse_qs

from exchange import dispatch


async def app(
    scope: dict[str, Any],
    receive: Callable[[], Awaitable[dict[str, Any]]],
    send: Callable[[dict[str, Any]], Awaitable[None]],
) -> None:
    if scope["type"] != "http":
        return
    headers = [
        (b"content-type", b"application/json; charset=utf-8"),
        (b"cache-control", b"no-store"),
    ]
    if scope["method"] != "GET":
        payload, status = {"error": "method_not_allowed"}, 405
        headers.append((b"allow", b"GET"))
    else:
        params = parse_qs(scope.get("query_string", b"").decode("utf-8", errors="replace"))
        payload, status = await dispatch(
            params.get("resource", [""])[0],
            params.get("base", [""])[0],
            params.get("quote", [""])[0],
        )
    await send({"type": "http.response.start", "status": status, "headers": headers})
    await send(
        {"type": "http.response.body", "body": json.dumps(payload, allow_nan=False).encode()}
    )
