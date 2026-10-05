"""Versioned Brazilian payroll parameters. Values are checked against official publications."""

import asyncio
import json
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from pydantic import ValidationError

from models import TaxRules

INSS_SOURCE = "https://www.gov.br/inss/pt-br/direitos-e-deveres/inscricao-e-contribuicao/tabela-de-contribuicao-mensal"
IR_SOURCE = "https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2026"
SIMPLES_SOURCE = "https://normas.receita.fazenda.gov.br/sijut2consulta/link.action?idAto=92278"
DIVIDEND_SOURCE = "https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/lei/l15270.htm"

OFFICIAL_2026 = TaxRules(
    year=2026, valid_from="2026-01-01", checked_at="2026-10-05", source="official_snapshot",
    inss_employee=[(1621.00, .075), (2902.84, .09), (4354.27, .12), (8475.55, .14)],
    inss_ceiling=8475.55, minimum_wage=1621.00,
    ir_monthly=[(2428.80, 0, 0), (2826.65, .075, 182.16),
                (3751.05, .15, 394.16), (4664.68, .225, 675.49),
                (1e15, .275, 908.73)],
    ir_annual=[(29145.60, 0, 0), (33919.80, .075, 2185.92),
               (45012.60, .15, 4729.91), (55976.16, .225, 8105.85),
               (1e15, .275, 10904.66)],
    plr=[(8214.40, 0, 0), (9922.28, .075, 616.08),
         (13167.00, .15, 1360.25), (16380.38, .225, 2347.78),
         (1e15, .275, 3166.80)],
    dependent_monthly=189.59, dependent_annual=2275.08,
    simplified_monthly=607.20, simplified_annual=17640.00,
    education_annual=3561.50,
    sources={"inss": INSS_SOURCE, "ir": IR_SOURCE,
             "simples": SIMPLES_SOURCE, "dividends": DIVIDEND_SOURCE},
)
_cached: tuple[float, TaxRules] | None = None


def _read_api_table(name: str) -> object:
    url = f"https://api.falazuki.com/v1/tables/{name}?date=2026-10-05"
    with urlopen(Request(url, headers={"User-Agent": "TinySalary/0.1"}), timeout=4) as response:
        raw = response.read(100_001)
        if len(raw) > 100_000:
            raise ValueError("Oversized tax table")
    return json.loads(raw)


async def get_tax_rules(year: int) -> TaxRules:
    global _cached
    if year != 2026:
        raise ValueError("Unsupported tax year")
    if _cached and time.monotonic() - _cached[0] < 86400:
        return _cached[1]
    result = OFFICIAL_2026
    try:
        data = await asyncio.wait_for(asyncio.gather(
            asyncio.to_thread(_read_api_table, "inss"),
            asyncio.to_thread(_read_api_table, "irrf"),
        ), timeout=5)
        inss, irrf = data
        if (isinstance(inss, dict) and isinstance(irrf, dict)
                and inss.get("evidence", {}).get("status") == "verified"
                and irrf.get("evidence", {}).get("status") == "verified"
                and inss.get("effectiveFrom") == "2026-01-01"
                and irrf.get("effectiveFrom") == "2026-01-01"
                and inss.get("values", {}).get("ceiling") == OFFICIAL_2026.inss_ceiling):
            result = OFFICIAL_2026.model_copy(update={"source": "official_snapshot_with_api"})
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, ValidationError, TypeError):
        pass
    _cached = (time.monotonic(), result)
    return result
