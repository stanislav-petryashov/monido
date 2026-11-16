# User-case verification plan

Date: 2026-11-14. Scope: the six agreed public use cases, each on a clean installation.

## Approach

Use existing Node/SQLite, playwright-core and Google Chrome. Build the current client once; start six separate application servers with independent newly created DATA_DIR directories and fresh browser contexts. These are clean source installations, not six Docker installations. Existing uncommitted user changes remain intact; evidence identifies HEAD plus the working-tree diff hash.

Expected values come from fixture arithmetic, not the production calculation functions. SQL history preparation is distinguished from browser/API actions under test. No personal data, real bot token or external AI account is used. All outgoing server requests except loopback and the mocked Telegram transport are rejected.

For UC-07, reuse standFetch and standCookie from the existing development stand. Test the advisor tools and family voting; do not claim to test Claude conversation quality, OAuth, actual Telegram login or delivery. Proposal consent is scripted for fictional users only.

## Tasks

- [x] Build the current client/server and record source identity.
- [x] UC-01: seed accounts, property and a debt; verify assets minus liabilities, detail pages, reload and narrow viewport.
- [x] UC-02: three closed months with RUB 200,000 income and RUB 150,000 expenses; verify RUB 50,000 surplus, 25% savings rate, disabling/re-enabling flows without fabricating zeros or losing history.
- [x] UC-03: RUB 900,000 cash reserve and three months of RUB 150,000 expenses; confirm the reserve through the UI, verify six months, persistence and rejection of earmarks exceeding the balance.
- [x] UC-04: thirteen months, property RUB 10m to 11m, exchange rate 80 to 100 RUB/USD, RUB 600,000 contributions; verify opposite RUB/USD trends, inflation and growth beyond contributions. Verify short-history withholding in UC-01.
- [x] UC-05: RUB 600,000 goal funded at RUB 50,000/month; increase target to RUB 900,000 in the UI; verify twelve to eighteen months and persistence after reload.
- [x] UC-07: compare buying outright and credit; independently check the annuity; reject incomplete input; preview without creating a proposal; submit with scripted consent; vote through the UI; reject reuse of the draft.
- [x] UC-08 (added 2026-11-16): preview a statement without writing; file it after scripted consent; refuse reuse of the preview; refuse a look-alike account and loan with the existing names; add a new account and a loan, independently check the annuity; carry quiet accounts and close the month once.
- [x] Preserve responses, screenshots, page text and traces; publish the factual outcome and limits of each case.
- [x] Run related regression tests and documentation checks; link the cases from README and CONTRIBUTING.

## Review focus

- Currency valuation, nominal wealth and purchasing power are different concepts.
- Historical surplus is not a guaranteed future saving capacity.
- Confirmed reserve and all bank balances need not be the same amount.
- Goal dates depend on today's date and competition between goals.
- An approved proposal does not execute a purchase or issue a loan.

Product gaps are documented. Adding missing product features is outside this verification run.

## Reproduce

With the repository's dependencies installed, Google Chrome and Node 24:

```sh
npm run build
node --import tsx docs/use-cases/verify.mjs
```

An optional case ID limits a run, for example `node --import tsx docs/use-cases/verify.mjs UC-03`. Fixture months are relative to the run date. The recorded numerical example is the November 2026 run; the wealth fixture is intended for that reference period.

Outputs are written to ignored `output/use-cases-2026-11-14/`. Each run leaves its fictional database in the OS temporary directory for diagnosis and stops its own HTTP servers and browser. Do not publish database files, cookies or raw traces without checking them: even fictional runs contain test authentication state. Public articles retain selected screenshots and a sanitized result summary.
