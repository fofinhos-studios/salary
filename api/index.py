"""Vercel ASGI entry point, sharing the local server's exchange service."""

import json
from collections.abc import Awaitable, Callable, Mapping
from urllib.parse import parse_qs

from exchange import dispatch
from models import ErrorResponse


async def app(
    scope: Mapping[str, object],
    receive: Callable[[], Awaitable[object]],
    send: Callable[[dict[str, object]], Awaitable[None]],
) -> None:
    if scope["type"] != "http":
        return
    headers = [
        (b"content-type", b"application/json; charset=utf-8"),
        (b"cache-control", b"no-store"),
    ]
    if scope["method"] != "GET":
        payload, status = ErrorResponse(error="method_not_allowed"), 405
        headers.append((b"allow", b"GET"))
    else:
        query = scope.get("query_string", b"")
        params = parse_qs(
            query.decode("utf-8", errors="replace") if isinstance(query, bytes) else ""
        )
        payload, status = await dispatch(
            params.get("resource", [""])[0],
            params.get("base", [""])[0],
            params.get("quote", [""])[0],
        )
    await send({"type": "http.response.start", "status": status, "headers": headers})
    await send(
        {
            "type": "http.response.body",
            "body": json.dumps(payload.model_dump(mode="json"), allow_nan=False).encode(),
        }
    )
