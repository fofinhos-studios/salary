"""Local Robyn server; production uses api/index.py on Vercel."""

import json
import os
from pathlib import Path

from robyn import Request, Response, Robyn, serve_html
from robyn.responses import FileResponse

from exchange import dispatch
from models import ApiResponse

ROOT = Path(__file__).parent


def json_response(payload: ApiResponse, status: int = 200) -> Response:
    return Response(
        status_code=status,
        headers={"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"},
        description=json.dumps(payload.model_dump(mode="json"), allow_nan=False),
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
    return json_response(*await dispatch("currencies"))


@app.get("/api/rate")
async def rate_endpoint(request: Request) -> Response:
    base = request.query_params.get("base", "") or ""
    quote = request.query_params.get("quote", "") or ""
    return json_response(*await dispatch("rate", base, quote))


if __name__ == "__main__":
    app.start(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8765")))
