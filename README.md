<h1 align="center">
  <img src="static/favicon.svg" width="32" height="32" alt="" align="absmiddle" />
  <a href="https://salary.fofinhos.studio/">tiny salary</a>
</h1>

Convert a salary across currencies and pay periods, or compare two salaries in the Compare tab. Each salary can have its own currency, working hours, and 12 or 13 payments per year. The comparison shows annual percentage and money differences plus monthly payment and hourly differences.

Use reference exchange rates from [Frankfurter](https://frankfurter.dev/) or enter your own rate. The calculator is available in English and Brazilian Portuguese. Salary amounts stay in your browser; taxes, benefits, and transfer fees are excluded.

Made by [fofinhos.studio](https://fofinhos.studio/).

## Development

Install [uv](https://docs.astral.sh/uv/) and Node.js 20+, then run `uv sync --locked` and `npm ci`.
The frontend source is in `frontend/`; `npm run build` writes the committed browser bundle to `static/app.mjs`. Run `uv run app.py` to serve the site locally.

Checks:

```sh
uv run python scripts/check_backend.py
uv run ruff check .
uv run ruff format --check .
uv run ty check
npm run check
```

The Python check enforces at least 95% line and branch coverage. The frontend check enforces at least 90% of each and checks the 40 KiB compressed asset limit.
