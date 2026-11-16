# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `monido-mcp`: connect Claude Desktop or Claude Code on your own computer to the Advisor over stdio, as a family member, with no Telegram, HTTPS or OAuth (see the Docker guide).
- The Claude connector is listed in the official MCP Registry as `io.github.stanislav-petryashov/monido`; each release publishes its version there.
- Worked example UC-08: closing a month from bank statements and a loan agreement through Claude, with an automated check and a supervised live run.

### Changed

- Claude asks before adding an account or a loan whose name looks like an existing one (a typo, a longer variant, another case or accent), instead of creating a duplicate that would be counted twice.

## [1.0.0] - 2026-11-15

Initial public release.

### Added

- Question-led financial panels across Overview, Net worth, Cash flow, Goals and Financial health, with data completeness and explicit calculation limits.
- Journaled monthly account availability and reserve/goal/commitment earmarks, closed-month category trends and observed recurrence, a reconciled capital bridge, and editable 3/6/12-month cash stress scenarios.
- Claude loads bank statements and loan agreements into the open month: it reads the document, shows a draft in the chat and writes it only after your "yes"; accounts accumulate as the month's draft, and the month closes in chat or in the wizard.
- Income and expenses as one flow: the totals you enter once are allocated by category. Income categories (active or passive, a bonus can be one-off), a "Break down" panel under each account in Close month, "Records → Breakdown by category" with a month-by-account screen, "Where income comes from" on the Cash flow page, and statements that fill an account's totals and its lines by category together. The lines never exceed a total; what they leave is "Unallocated". The test data has income categories and account lines for the last twelve months.
- Claude compares a loan's remaining debt shown by the bank (on a statement or when adding a loan) with the app's schedule on the same day and warns when they differ by more than about a month's interest on the original amount, asking about a missing early payment or a bank recalculation; nothing is blocked or stored.
- Growth beyond savings on the Goals page: net worth growth per year with the family's own savings taken out (monthly Modified Dietz, chained; needs 6 usable months), loan payments are transfers, not saving, so only loan interest counts against it; with a "How it is calculated" panel that shows the family's own numbers, the growth in money and the months left out. Capital growth per year has the same panel.
- Set up Telegram sign-in on one page: connect the bot, choose an administrator profile, confirm in Telegram and enable sign-in with the current family password. Reuse existing profile links and wizard controls, with automatic confirmation updates and recovery after connection failures.
- Bind sign-in confirmation to the selected profile and configured bot; reject mismatched accounts and stale attempts, and cancel pending confirmation when leaving the flow.
- Six documented household use cases with reproducible isolated checks and explicit limits; a supervised Claude and Telegram test covers rejection, revision and acceptance.
- Contribution guidance for usability, calculations, documentation and self-hosting.
- Net worth history compares capital, assets and liabilities with thin lines, shared mouse/touch details, calendar gaps, independent 3/6/12-month and All filters, and amount/percentage views.
- The user menu has a compact identity capsule while retaining permissions, themes and sign-out behavior.
- Net worth, monthly cash flow, savings rate and emergency fund, computed on the server into one snapshot in the project currency you pick.
- Any currency: accounts in any currency, rates of every project currency from Frankfurter (`FX_API_URL` points to a self-hosted instance), manual rates in Settings → Parameters ("1 USD = X" from a date until the next one), each amount converted at the rate of its own date (a balance at its month end, a flow at its month start, goals at today's rate).
- The month-close wizard: balances and flows entered once a month, months closed in order, the dashboard showing closed months only. The period switch (YTD, 1Y, 5Y, All) on the cards that show time.
- Switchable modules: income and expenses (with spending by category and the mandatory monthly spending), loans with schedules and early payments, real estate, goals with FIRE scenarios, financial health, ready questions for Claude, the Advisor and Telegram reminders.
- The Advisor: each member connects Claude (claude.ai, Claude Desktop, Claude Code) to the family's numbers through an OAuth connector at `/mcp`; Claude weighs purchases, loans and goals and files bank statements by category, acting with that member's rights. Proposals go to the family council for a vote in Telegram and on the Advisor page.
- Users and rights (enter data, vote, manage users and settings), invitations through Telegram, and sign-in through Telegram (`AUTH_MODE=telegram`) next to the shared family password.
- Sign-in managed in the app (Settings → Users → Sign-in): the family password (a scrypt hash), the Telegram bot token and a guided switch to Telegram sign-in. A new installation sets its password in the browser within 15 minutes of the first start; `docker compose exec app reset-password` clears it and reopens the window.
- The setup wizard on first run, re-runnable from Settings → Backup; "Load test data" (a fictional family in the family language) and a wipe in its Danger zone.
- A journal of every edit with its author and a revert; privacy mode that hides the amounts.
- English and Russian interface, light and dark themes.
- A public demo mode (`AUTH_MODE=demo`): a private copy of a fictional family for each visitor, with `deploy/demo/` files for a demo host.
- A Docker image for amd64 and arm64 on GHCR, a hardened `docker-compose.yml`, new databases created from `schema.sql` and existing ones validated at startup; a Content-Security-Policy on every page and per-address login throttling.

### Changed

- The product is now called Monido, with a new mark: an M whose middle is a nest (money + nido) and whose right leg rises. The tab title, the sign-in screen, the Claude connector hints, the MCP server name (`monido`) and the CSV export file (`monido-YYYY-MM-DD-csv.zip`) use the new name. The repository and Docker image names change at the public release; existing installations, backups and Claude connectors keep working.
- In `AUTH_MODE=none`, or before the first password is set, opening the app by a name (`nas.local`, a Tailscale name, a domain) now needs `APP_URL` set to that address; `localhost` and IP addresses work as before.
- Replace historical SQL migrations with one `schema.sql` for new databases. Already updated installations and current backups remain compatible; older schemas must be updated with the previous release first. `SCHEMA_FILE` replaces `MIGRATIONS_DIR`.
- Mobile waterfalls keep income, expenses and net visible without horizontal scrolling; Overview accounts use a compact list. Detailed planning texts load only with their pages.
- Release promotion now checks out the tagged repository before accessing its local Docker build context.
- "Net worth growth per year" on Goals is now called "Capital growth per year" and says it includes your savings, so it is not confused with the new figure.
- Money rounding goes through one helper, `roundTo`: the balance difference in the month-close wizard rounds a half cent away from zero like every other amount.
- Manage password and Telegram sign-in in the web interface. Reserve `AUTH_MODE=none` and `AUTH_MODE=demo` for environment configuration; show passwordless access as locked in Settings and skip password setup when it is explicitly enabled.
- Remove legacy `AUTH_MODE=password/telegram` and `APP_PASSWORD` configuration, simplify the environment example, and remove obsolete comments, helpers and interface styles.
- Keep language font subsets while omitting specialized math and symbol subsets from the client bundle.
- Share form feedback, goal inputs, record KPIs, progress tracks, chart labels, menus, loading states and common UI styles across screens.
- Remove the generic goals table wrapper, unused cashflow aggregates and retired test-only financial adapters; retain tests of the live calculations.
- Pass collateral options directly through loan forms and compose property-linked loan updates directly within the existing guarded, journaled transaction.
- Add regression coverage for missing capital, delayed and failed collateral queries, and rollback of multiple linked loans.
- First-run setup now has four steps: welcome, data, account owners and currencies. Accounts are added after setup; Telegram sign-in remains in Settings.
- Setup fields keep their labels inside the controls, phones show overall progress, and currency search and tags use a compact layout in English and Russian, in both themes.
- The currency for totals saves immediately; completion waits for pending writes. Owner removal also finishes before the next step can open.
- Password creation reminds users to save the app URL and password in a password manager.
- The Goals page uses the pearl design and one financial independence date.
- Category breakdown puts the compact income and expense catalog first, with direct month selection and a single account table instead of nested year/month disclosures and dropdown filters.
- Month tiles show data completeness using theme-aware semantic colors while keeping visible status labels and a distinct selected state.
- Account allocations show amounts, totals and remaining balances with accessible progress indicators and responsive layouts, preserving privacy masking and existing save behavior.
- Explanatory text stays visible; the manual fallback for mandatory living expenses moves to Parameters as Base monthly expenses.
- Removed repeated month values and the secondary navigator below the history chart; selected-month values appear in the chart tooltip and remain available to assistive technology.
- Growth calculations use the actual endpoints in the selected window and explain that contributions are included.

### Removed

- The optional Cloudflare Tunnel service (`cloudflared`, `COMPOSE_PROFILES=tunnel`, the `tunnel-token` secret). Publish the app through your own reverse proxy with HTTPS or Tailscale Funnel; if you used the tunnel, remove `COMPOSE_PROFILES=tunnel` from `.env`, run `docker compose up -d --remove-orphans` and delete `tunnel-token`.

### Fixed

- A pasted amount with more decimals than the field keeps (`0,125`) is rounded half away from zero (`0.13`) instead of being cut.
- Council votes, their comments and Withdraw in Telegram work when a member has "Bot commands" off; that switch covers only /help and /summary.
- A proposal is sent only to members who can vote on it (council proposals or Telegram sign-in on), so it no longer waits until expiry for someone who could never vote.
- "Ask Claude" checks the connection every few seconds only while waiting for it; otherwise on opening the page and on returning to it.
- Without sign-in (`AUTH_MODE=none`, or a new installation before its first password) the server answers only `localhost`, IP addresses and the host of `APP_URL`, so a foreign website can no longer reach it through DNS rebinding.
- Strangers starting many Telegram sign-ins can no longer push out a family member's sign-in in progress: one address holds at most 5 live attempts, and a full store makes room only at the expense of an address holding several.
- A member who still owns accounts, loans, real estate or other records can no longer be deleted (the records would pass to the next member given that name), and a member is renamed only with "Change name", which moves their records too; undoing a member change in the journal follows the same rules.
- A backup from an older release this one can no longer read is no longer reported as damaged: restore says it is older and must be restored through release 0.41.0 first.
- Blocking the family from connecting Claude for an hour now takes a flood from many IPv4 addresses or IPv6 /48 prefixes: the server-wide limit on connector registrations is gone, and only the per-address limit (IPv6 by its /48) remains.
- A month with an income or expense in a currency without a rate no longer counts that amount as zero: the Overview's twelve-month total and the month before, the Income and expenses chart and members, and the Goals months show it as unknown ("—", a gap on the charts).
- One such row in the last closed month no longer blanks the whole Income and expenses page and the forecast's budget: only the periods that include that month have no totals.
- Financial health no longer grades a loan or an account without a rate as zero debt or money: the debt indicators and the emergency fund show no data instead of a confident zone.
- Car loans count as consumer debt in Financial health.
- The advisor's earners, stress test and income sources no longer inflate when a month of the three has a currency without a rate.
- Overview shows "—" with a note for a month whose net worth misses a balance or a rate, and no month or year change against such a month.
- The loan payments line on "Breakdown by category" shows "—" when a payment has no rate, instead of a partial sum.
- The advisor no longer grades a purchase or credit on a zero: when the last closed month has an amount without a rate, or a bank account has no rate or balance, the payment share, emergency fund and stress test are unknown and Claude says why (a 30 000 credit showed a 60.66-month fund instead of 5.12).
- The advisor's payment share is unknown, as in Financial health, while a loan with a payment has no rate; its income sources are unknown when no month of the three can be averaged.
- Financial health checks only what each indicator reads: a rateless mortgage no longer hides the consumer debt, a rateless property no longer hides the emergency fund, and a paid-off loan in a currency without a rate counts as 0.
- Real growth, capital growth per year, the net worth "How it is calculated" panel, the month and year changes and the Telegram /summary treat a month whose net worth misses a balance or a rate as unknown, as Overview does; the Overview's twelve-month savings rate is "—" with its total.
- Financial health, the forecast, the "Split" action and the Claude prompts name the last closed month even when its totals are unknown.
- Advisor results explain cash shortfalls and the additional savings needed to buy while retaining a reserve. Claude guidance distinguishes liquid balances from free money, pooled income from independent earners, and saving-stage estimates from a future purchase.
- Require the snapshot date, previous capital and account lifecycle evidence consistently, including goal projections and test fixtures.
- Complete the Family Finance rename in setup examples, demo deployment defaults and development helpers. Repository renaming now also updates contribution links.
- Keep missing account balances visible across multiple closed months. Availability and forecast imports now require explicit complete capital coverage instead of accepting a partial account set.
- Tiny nonzero history percentages and annual growth display localized bounds rather than zero.
- Recovering from unavailable chart values restores the value scale; extreme finite growth inputs are handled safely.

### Deployment

- Public demo deployment now uses Caddy as a host service and trusts its `X-Forwarded-For` header; the demo tunnel service and token secret are removed.
- Demo updates pull and recreate only the app, use Compose to wait for health, and preserve session draining and failure cleanup.

### Upgrading from a 0.x pre-release

- The first release with migration `0026` (account lines by category, `flow_lines`): back up the data volume first (Settings → Backup → Download database copy). Existing categories become expense categories and existing `category_spending` rows become "Other sources"; no totals change. Claude sessions should re-read the guide: for a brokerage account "passive income" now means dividends, coupons and interest credited (deposits and trades show only in the balance), and income excludes transfers, refunds, loans received and asset sales.
- The `proxy` sign-in mode is removed (`AUTH_MODE=proxy`, `AUTH_PROXY_HEADER`). With `AUTH_MODE=proxy` in `.env` the server no longer starts (`AUTH_MODE must be "password", "telegram" or "demo"`): delete the line, start, and set the family password in the browser (`docker compose exec app reset-password` reopens that window).
- `install.sh` and its `doctor` are gone: install by the [installation steps](docs/deploy-docker.md#installation), update with `docker compose pull && docker compose up -d`. `.env` is optional (Docker Compose 2.24 or newer).
- `AUTH_MODE`, `APP_PASSWORD` and `TELEGRAM_BOT_TOKEN` in `.env` are overrides: a non-empty line wins and is mirrored into the app, and the Sign-in section shows it read-only. The first start after the upgrade saves those values into the app and the session signing key changes, so everyone signs in once more. To manage sign-in in the app, delete the lines from `.env` and run `docker compose up -d`. `APP_PASSWORD` is checked in every mode but `demo` with the rule of a password set in the app, 12 to 128 characters: a shorter one (an old 8-character password included) stops the server; change the line or delete it and set the password in the browser.
- The `latest` image tag moves only at releases; `master` builds publish `edge` and `sha-<7-char commit>`.
- History numbers are converted at the rate of their own date, so history in a currency other than the dollar changes meaning: before, the dollar history was multiplied by the latest rate.
- Inflation has its own currency and no default: until both the rate and its currency are set, real growth shows "—". An existing database with an inflation value gets RUB as its inflation currency (when RUB is in the project).
- Loans: the term is at most 35 years (420 months), and a payment day must be 1 to 31. A loan stored with a longer term or another day keeps it and stays editable as long as that field is left as it is. An early payment dated after the loan is repaid, or one that would leave an already entered early payment nothing to reduce, is refused.
- The database copy (`GET /api/backup`) is for members who manage users and settings only; others get 403 `no_right_manage` and no longer see the button.

[Unreleased]: https://github.com/stanislav-petryashov/monido/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/stanislav-petryashov/monido/releases/tag/v1.0.0
