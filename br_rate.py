"""Official PTAX closing quote for BRL projections, with existing FX fallback."""

import asyncio
import json
from datetime import date, timedelta
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from pydantic import BaseModel, ConfigDict, Field

from exchange import ProviderError, get_rate
from models import Rate

API = "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/"


class Bulletin(BaseModel):
    model_config = ConfigDict(extra="ignore")

    cotacaoCompra: float = Field(gt=0, allow_inf_nan=False)
    dataHoraCotacao: str
    tipoBoletim: str


def _read_ptax(code: str) -> list[Bulletin]:
    today = date.today()
    params = {
        "@moeda": f"'{code}'",
        "@dataInicial": f"'{(today - timedelta(days=8)):%m-%d-%Y}'",
        "@dataFinalCotacao": f"'{today:%m-%d-%Y}'",
        "$format": "json",
    }
    path = (
        "CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,"
        "dataFinalCotacao=@dataFinalCotacao)"
    )
    url = API + path + "?" + urlencode(params)
    with urlopen(Request(url, headers={"User-Agent": "TinySalary/0.1"}), timeout=5) as response:
        raw = response.read(100_001)
        if len(raw) > 100_000:
            raise ProviderError("PTAX response too large")
    data = json.loads(raw)
    if not isinstance(data, dict) or not isinstance(data.get("value"), list):
        raise ProviderError("Invalid PTAX response")
    return [Bulletin.model_validate(row) for row in data["value"]]


async def get_brl_rate(base: str) -> Rate:
    if len(base) != 3 or not base.isascii() or not base.isupper() or not base.isalpha():
        raise ValueError("invalid_currency")
    if base == "BRL":
        return Rate(
            base="BRL",
            quote="BRL",
            rate=1,
            date=None,
            source="identity",
            stale=False,
            max_age=86400,
        )
    try:
        rows = await asyncio.wait_for(asyncio.to_thread(_read_ptax, base), timeout=6)
        closing = [row for row in rows if row.tipoBoletim == "Fechamento"]
        if closing:
            latest = max(closing, key=lambda row: row.dataHoraCotacao)
            return Rate(
                base=base,
                quote="BRL",
                rate=latest.cotacaoCompra,
                date=latest.dataHoraCotacao[:10],
                source="BCB",
                stale=False,
                max_age=3600,
            )
    except (TimeoutError, OSError, ValueError, json.JSONDecodeError):
        pass
    return await get_rate(base, "BRL")
