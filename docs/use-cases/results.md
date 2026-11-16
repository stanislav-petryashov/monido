# Verification results: 2026-11-14

**Six isolated installations completed the automated scenarios: 44/44 named assertions passed.** Three broader user promises remain partial. This is a technical verification, not a study of customer satisfaction, financial outcomes or retention.

| Case | Automated assertions | User-outcome scope | Observed result |
| --- | --- | --- | --- |
| UC-01: net worth | PASS | Verified fixture | RUB 5.9m assets - RUB 1.2m debt = RUB 4.7m net worth; visible on Overview. |
| UC-02: saving capacity | PASS | PARTIAL | RUB 50,000 historical monthly surplus and 25% savings rate. Future sustainable saving capacity is not established. |
| UC-03: reserve | PASS | Verified fixture | Browser confirmation persisted: RUB 900,000 cushion / RUB 150,000 monthly spending = 6 months; free funds are zero. |
| UC-04: wealth change | PASS | PARTIAL | RUB 11m to 12.6m, USD 137,500 to 126,000. Contributions RUB 600,000; growth beyond them RUB 1m. That explanation is not directly available in this household's wealth UI. |
| UC-05: goal | PASS | Verified fixture | Increasing target in the browser from RUB 600,000 to RUB 900,000 moves projection from November 2027 to May 2028, keeping the original deadline. |
| UC-07: family decision | PASS | PARTIAL | USD 794.99 installment; cash option deducts USD 25,000 liquidity without changing monthly savings. Preview, submission, second member's browser vote and accepted history work locally. A subsequent supervised live run verified Claude readback, Telegram delivery, rejection, revision and acceptance; advice explanation remains partial (see below). |

## Environment and provenance

- Run started: `2026-11-14T15:13:51.102Z`.
- Node: **24.22.3**; Chrome: **157.0.0.0**; desktop viewport 1440 × 1000; narrow viewport 390 × 844 (desktop browser emulation, not a physical phone).
- Source HEAD: `2b732a8eb56f13f28b2faf12a93674a22f35002a`.
- Working-tree diff SHA-256 at run start: `96f701ff53146d236136187d9350b3544096673e8b85917e1d9b0da7f31a848d`. The fingerprint includes staged and unstaged tracked changes against HEAD. Existing uncommitted changes were present; this is not a claim about the untouched HEAD release.
- Runner SHA-256: `e1fb96e360d4504439d11483fc3ab9002c719d7728390825a4a50afea55f8749`.
- Separate freshly initialized SQLite database, application server and browser context for each case. One freshly built client shared by the six source installations; no Docker deployment test.
- Fixture history is loaded through SQLite; login is through the password HTTP endpoint or local Telegram stand sessions. This does not test first-run onboarding or manually entering every historical row.
- No uncaught browser page errors; no horizontal document overflow at 390 px in the sampled landing page per case. This is not a full accessibility audit or proof of usability on every page.
- The UI scenario checks include reserve confirmation, changing a goal, choosing Year/USD and the second member's vote. Settings toggles and advisor tool calls are exercised over HTTP.

The [sanitized machine-readable assertion log](verification-results.json) contains each named check. The [runner](verify.mjs) reproduces the fixtures, HTTP calls and browser actions. Detailed response JSON, page text, layout measurements and traces remain in ignored `output/use-cases-2026-11-14/`. Temporary fictional databases are retained locally for diagnosis. Do not publish raw databases or traces containing authentication state.

## Additional checks

- Node 24 typecheck and client/server production builds passed.
- **213/213 related regression tests passed** across capital, returns, goals, availability, financial analysis, advisor evaluation/proposals, goal editing and the availability panel.
- Documentation/link/language checks: **40/40 passed**; an additional direct check validated all 25 relative links in the nested use-case articles.
- Independent read-only review identified three harness weaknesses: missing cash-option assertions, insufficient visible-result assertions, and UI failures classified as blocked. All three were corrected before this final run. Unknown case IDs are rejected too.

## Findings for contributors

1. **UC-04: make growth beyond contributions easy to find.** Growth beyond contributions is calculated, but its explanation is rendered only inside a financial-independence goal's Forecasts. This case has no such goal. Expose the evidence where people inspect their wealth, with period and completeness limits. Preserve the distinction between currency revaluation, nominal growth and purchasing power.
2. **UC-02: distinguish historical surplus from future affordability.** The passing fixture has stable income, no loan payments and no annual bills. Add independently calculated irregular-income and obligation scenarios before promising a sustainable saving recommendation.
3. **UC-07: explain the alternatives.** The supervised live run now verifies delivery and voting. Explain why saving an extra amount preserves a reserve, distinguish an unaffordable cash purchase from zero remaining cash, and distinguish pooled income records from known earners.

The zero-interest loan in UC-01 is deliberately simple; the fixture does not model how its proceeds were spent. The advisor demo's latest closed month is September, explicitly shown as two months old. Neither should be presented as a complete real-family financial history.

## Harness corrections, not product fixes

Early exploratory runs exposed wrong test field names/selectors and a Chrome full-page capture artifact. Full-page screenshots distorted the sticky sidebar even though pre-capture geometry was correct (248 px sidebar, 1192 px content). Viewport captures reproduce the visible layout correctly and are used in the articles. No product CSS or calculation code was changed to make the tests pass.

The complete project suite, Docker deployment, real mobile hardware and user interviews were not run. Missing evidence is not a passed test.

Release preparation repeated all six isolated cases successfully after the runner was corrected to fingerprint staged changes and check browser errors after mobile navigation. The full project check also passed: 4,890 tests passed, three privacy checks skipped locally without the CI-only denylist; lint, unused-code checks, build and bundle budgets passed. CodeRabbit reported two minor runner findings, both addressed. CI runs the private denylist scan before publishing the image.

## Addendum: UC-08, 2026-11-16

| Case | Automated assertions | User-outcome scope | Observed result |
| --- | --- | --- | --- |
| UC-08: statements through Claude | PASS (15/15) | PARTIAL | Previews write nothing; a filed preview cannot be reused; a look-alike account and loan are refused with the existing names; the USD 12,000 loan's USD 564.32 payment matches the annuity; the month closes once. A supervised live run on claude.ai matched every pre-written figure; see [the article](statements-through-claude.md). |

- Run started `2026-11-16T05:10:54.408Z`; source HEAD `347a3b9d35ab23a825a7cb10a0962b61a704091a`; working-tree diff SHA-256 `124841e0c2da038db0a9ae1dd3becb91b64b4309ce97d11a74d2813831a3154e` (the runner's own UC-08 additions); runner SHA-256 `1d7fea1cdff8c8cca906ed62f105b0f32e44de40f29d5bdd119af7b407c9f7a3`; Node 24.22.3. Only UC-08 was run; the six earlier cases keep the results above.
- **Scope is partial**: one live run, one model, clean fictional PDFs. The server's look-alike refusal was exercised by the automated run only, because Claude matched the differently spelled account itself in the live run.
