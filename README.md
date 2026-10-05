# tiny salary

A small, instant salary and currency calculator. English and Brazilian Portuguese,
daily exchange rates, manual rates, and independent 12/13-payment schedules.

## Run locally

Install [uv](https://docs.astral.sh/uv/getting-started/installation/), then:

```sh
uv sync --locked
uv run app.py
```

Open **http://127.0.0.1:8765**. No API key, frontend build, database or Node runtime
is needed to use the app. uv installs Python 3.12 if needed.

Optional environment variables: `HOST` (default `127.0.0.1`) and `PORT` (default `8765`).
For example, in PowerShell:

```powershell
$env:PORT = '9000'
uv run app.py
```

On macOS/Linux: `PORT=9000 uv run app.py`. Keep the default loopback host for local use.

## Deploy to Vercel

```sh
vercel link
vercel --prod
```

`vercel.json` serves `static/` through the CDN and routes the two API endpoints to
`api/index.py`, a small ASGI entry point. Both it and the local Robyn server reuse
`exchange.py`. No secrets or environment variables are required.

Production domain: **https://salary.fofinhos.studio**. Add the domain to the Vercel
project, then use the CNAME target returned by `vercel domains inspect` in Cloudflare
with **DNS only** (proxy disabled). Vercel provisions the HTTPS certificate.

The in-memory cache belongs to each warm function instance. Cold starts lose cached
rates; without a successful cached response, provider outages offer manual entry.

## Calculation

For each side, payments per year are 12 or 13:

```text
Source annual = annual input, or monthly input × source payments
Target annual = source annual × exchange rate
Target monthly = target annual ÷ target payments
```

Switching the input period preserves annual compensation. Changing a 13th-payment
checkbox preserves the entered amount and period. With 13 payments, the monthly
number is each regular payment; the extra payment has the same value. It is not
the annual total divided by 12, and does not calculate prorated legal entitlements.

Examples: 120,000 annually at a rate of 5 gives 600,000 annually; 50,000 per payment
with 12 payments, or 46,153.85 with 13. Taxes, benefits and transfer fees are excluded.

Input separators follow the selected language. Calculations retain unrounded
JavaScript numbers; only presentation is rounded to the currency's minor units.
Amounts above `Number.MAX_SAFE_INTEGER`, non-finite results and negative salaries
are rejected. This is a comparison tool, not an accounting ledger.

## Exchange API

[Frankfurter v2](https://frankfurter.dev/) supplies active currencies and reference
rates. The displayed date comes from the provider and can precede today, including
on weekends and holidays. These are reference rates, not a bank's executable quote.

| Local endpoint | Response |
| --- | --- |
| `GET /api/currencies` | `{ "currencies": [{ "code": "USD", "name": "US Dollar" }, …] }` |
| `GET /api/rate?base=USD&quote=BRL` | `{ "base": "USD", "quote": "BRL", "rate": 5.0, "date": "2026-10-02", "source": "Frankfurter", "stale": false, "max_age": 3600 }` |

The response above is illustrative. `max_age` is remaining freshness in seconds.
Identical currencies return rate 1, `date: null`, and `source: "identity"`.
Unknown/invalid codes return HTTP 400 with `invalid_currency`; unavailable rates
return HTTP 503 with `rate_unavailable`; catalogue failures use `provider_unavailable`.

The server caches the catalogue for 24 hours and up to 256 currency pairs for one
hour. On provider failure, a successful cached entry remains usable for up to seven
days **since retrieval**. Stale rates retain their original reference date and are
explicitly marked. Cache contents are per process and disappear on restart.
External calls time out after five seconds and run outside the event loop.

The browser fetches rates only when needed for a pair or when returning to an
expired page. It discards obsolete requests. Salary, period and manual-rate changes
calculate locally. Changing either currency resets manual mode. A failed first
catalogue load leaves USD and BRL available for manual comparison, with a retry action.

Salary and manual rate values never leave the browser and are not saved. Only the
language preference is stored locally. Fonts and flags are served locally too.

## Checks

Python checks use the locked environment. Node.js 20+ is needed only for JavaScript tests.

```sh
uv run python -m unittest discover -s tests -v
node --test tests/core.test.mjs
uv run ruff check .
uv run ruff format --check .
uv run ty check
```

Tests cover all 12/13 combinations, locale parsing, precision across period changes,
currency rounding, invalid values, provider failures, stale-cache expiry and cache
limits. A size check caps total HTML/CSS/JS at 40 KiB gzipped, excluding fonts/flags.

Browser acceptance: 360/768/1440 px without horizontal overflow; searchable selectors
with arrow keys, Enter and Escape; PT/EN switching; rapid currency changes; manual and
automatic rates; visible focus; and no rate request while editing salary or period.
Live result announcements are delayed 650 ms so screen readers aren't interrupted on
every keystroke. Visual calculation is immediate.

## Assets and licenses

- [Clash Grotesk / Fontshare](https://www.fontshare.com/fonts/clash-grotesk): original
  variable WOFF2; ITF Free Font License in `static/fonts/ClashGrotesk-LICENSE.txt`.
- [IBM Plex Mono](https://github.com/IBM/plex): Latin WOFF2 via Fontsource; SIL OFL in
  `static/fonts/IBM-Plex-Mono-LICENSE.txt`.
- [flag-icons 7.5.0](https://github.com/lipis/flag-icons): local SVGs for currency
  issuer regions, MIT license in `static/flags/LICENSE.txt`. EUR uses the EU flag;
  currencies with no supported issuer flag use a neutral globe. Names and codes
  always accompany flags. The flags module lists bundled regions; a newly added
  currency can work immediately even without a new flag.
- Application code: GPL-3.0, as provided in `LICENSE`.

Made with love by 🧡💜 [fofinhos.studio](https://fofinhos.studio/).
