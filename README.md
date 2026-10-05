<h1 align="center">
  <img src="static/favicon.svg" width="32" height="32" alt="" align="absmiddle" />
  <a href="https://salary.fofinhos.studio/">tiny salary</a>
</h1>

Convert a salary across currencies and pay periods, or compare two salaries in the Compare tab. Each salary can have its own currency, working hours, and 12 or 13 payments per year. The comparison shows annual percentage and money differences plus monthly payment and hourly differences.

Use reference exchange rates from [Frankfurter](https://frankfurter.dev/) or enter your own rate. The calculator is available in English and Brazilian Portuguese. Salary amounts stay in your browser. The Convert and Compare tabs exclude taxes, benefits, and transfer fees.

The CLT × PJ tab compares a Brazilian employment offer with a Brazilian services company, including offers invoiced to a foreign client. It models 2026 INSS and IR, 13th pay, vacation bonus, PLR, benefits and FGTS; Simples Nacional Annex III/V with fator R or Lucro Presumido; company costs and exchange fees. Money inputs can use different currencies and hourly, monthly, or annual offer periods. The report shows annual net cash and a comparable package with an adjustable FGTS share. Current PTAX closing quotes from the [Central Bank](https://www.bcb.gov.br/conteudo/dadosabertos/BCBDepin/gnastportal-dados-abertostaxas-de-cambio---todos-os-boletins-diarios.pdf) are reference projections, with Frankfurter fallback and manual override.

The 2026 tax snapshot is sourced from [Receita Federal](https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2026), [INSS](https://www.gov.br/inss/pt-br/direitos-e-deveres/inscricao-e-contribuicao/tabela-de-contribuicao-mensal) and the [Simples regulation](https://normas.receita.fazenda.gov.br/sijut2consulta/link.action?idAto=92278). The [FalaZuki Rules API](https://www.falazuki.com/produtos/regras) is consulted for an independent INSS table check when reachable; its failure never replaces the official snapshot with unverified figures. The qualifying export switch excludes the statutory PIS, Cofins and ISS shares in Simples or the corresponding taxes under Lucro Presumido. High-income minimum tax, a missing municipal ISS rate and amounts outside supported regime limits show no winner until they can be calculated reliably. Actual tax filing uses transaction-date evidence and professional review.

Made by [fofinhos.studio](https://fofinhos.studio/).

## Development

Install [uv](https://docs.astral.sh/uv/) and Node.js 20+, then run `uv sync --locked` and `npm ci`.
The frontend source is in `frontend/`; `npm run build` writes the committed browser bundle to `static/app.mjs` and `static/chunks/`. Run `uv run app.py` to serve the site locally.

Checks:

```sh
uv run python scripts/check_backend.py
uv run ruff check .
uv run ruff format --check .
uv run ty check
npm run check
```

The Python check enforces at least 95% line and branch coverage. The frontend check enforces at least 90% of each and checks the 40 KiB startup and 80 KiB loaded compressed asset limits.
