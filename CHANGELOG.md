# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.9.0] - 2026-11-18

### Changed

- **The database is updated on start (schema version 3).** Before the update the server writes a copy of the database, `before-upgrade-v2-<date>.sqlite`, next to it in the data folder; delete it once the new version works. An older release cannot open the updated database: to go back, restore that copy or a backup made before the update. The closings of accounts are kept one per closing (`account_closings`, filled from `account_closures`, which goes); an older backup restores and is updated too.

### Fixed

- Review fixes: an early payment that holds interest is judged by the principal the bank credited; undoing a property rename is refused when the old name was taken by another property or a loan was linked to the new name since; undoing a one-balance account rename is refused while its closings stay under the new name; two people with no live member never share an id after a restore; a goal editor keeps the goal it opened on; a Telegram supergroup paired already keeps its own settings, and a refused resend does not count as today's reminder; a demo tab notices a fresh sandbox at once; a day or month with surplus digits is not read; gridline labels share one precision.
- Restoring a backup into an installation whose users were created in another order no longer gives the family proposals' authorship and votes to other people: they follow the member.
- A double click on "Add standard categories" adds them once, instead of a false "Could not save".
- Only one database copy is downloaded at a time; downloads left hanging no longer each hold a copy in memory.
- A date typed in another order than the field's (a day-first date in a year-first field) is left unread instead of saved as another day; a pasted "(500)" or "500-" is a minus; a pasted "1e5" or "1.5k" is refused instead of read as another number.
- Chart and amount texts: no "−0" or "NaN" in short amounts, gridline labels that never repeat (Chinese 亿), and no "+" beside an amount hidden in privacy mode.
- A demo tab brought back after "Start over" in another tab reads the fresh sandbox; the history template downloads in Safari; pairing a Telegram group works with the device clock off; Escape in a menu inside a window closes only the menu; an amount in its own currency is hidden in privacy mode too.
- An account name that was closed, used again and closed again keeps both closings: the months between its two lives no longer lose their net worth, and reopening the later month keeps the earlier closing. A closing already overwritten before this update cannot be brought back, so those months stay incomplete.
- Reminders and proposal notices follow a Telegram group that was upgraded to a supergroup (it gets a new id); they used to stop silently while Settings still showed the group as connected.
- A group the bot was removed from no longer gets a retry of every proposal notice on every run, nor the whole backlog when the bot is added back: its notices are switched off.
- A group gets one notice per proposal with its status now, instead of one per vote or change.
- If Telegram sign-in was switched off at start, Settings now offers "Stay on the family password", and the bot can no longer be disconnected meanwhile: it used to come back in Telegram mode with no bot after a restart, and nobody could sign in.
- Signing out also ends a manager's confirmed test sign-in in that browser, so the next person signing in there cannot switch the sign-in mode with it.
- A sign-out the server did not answer keeps you signed in and says so, instead of showing the sign-in screen over a live session.
- After the sign-in mode is switched on another device, an open tab shows the new sign-in screen instead of the old one.
- The rights of a user added under the family password while nobody manages can be changed again ("last manager" was refused).
- The setup wizard asks for the typed word before loading test data whenever it cannot be sure there is no data.
- A family member can no longer be named "migration", which made their closed months look like history from before the wizard.
- `npm run reset-password` outside Docker no longer signals the system's process 1; it says to restart the server.
- Growth beyond savings no longer counts a month in which an account's balance is missing, where it showed falls like −90% a year.
- Goals no longer read "unreachable", with financial independence in a century, before the first month with income and expenses is closed: how much you save is shown as unknown until then.
- A goal in a currency without an exchange rate no longer hides "What changed in net worth" on Income and expenses.
- An inflation currency without an exchange rate is now named in the warnings; real growth was left empty without a reason.
- A question for Claude no longer states the assets of a month in which a balance is missing, and no longer names a family member who has no records of their own.
- Editing a goal while "What if we saved a month" is filled no longer rewrites it in the dashboard currency, and a goal edited on an out-of-date page no longer puts back a change made elsewhere: the save is refused instead.
- A breakdown by category saved in Close month no longer deletes a line Claude or another device filed meanwhile: the save is refused and the panel shows the stored lines.
- A refused save or delete in Records shows the rows as they are now, instead of the table from before the attempt (which made every retry fail and could bring back a deleted row).
- The vote window of a family proposal votes only on the version it was opened on: if the author revised the proposal meanwhile, the vote is refused instead of being cast on the unread version.
- Selecting text in a window's field and releasing the mouse outside the window no longer closes the window and loses what was typed.
- "No income or expenses" and reopening the previous month no longer leave a "not a number" mark that blocked closing; removing a new account from the month also removes its lines by category.
- Renaming a property to another property's name is refused: the two used to merge silently, and one of them dropped out of net worth.
- Renaming an account no longer takes over an account added only in this month's Close month draft (its typed figures were lost), nor the leftover closing mark of a deleted account with that name (the renamed account vanished from the next month).
- Reverting one line of a renamed account, loan or property in "Change history" no longer splits it in two; a revert is checked like the edit it undoes, so it cannot leave early payments without their loan, a loan secured by a property that is gone, or a total below its lines by category.
- An early payment can no longer be more than the loan owes on its day, and the principal the bank credited can no longer be more than the payment: an extra zero used to cut the debt by far more than was paid.
- Records cannot delete a balance or flow of a closed month or move one into or out of it, which left the month with a hole; a balance added there is a month end of a known class and currency.
- Claude no longer saves a "carried over" statement with last month's balance as it was when previewed, if that balance was corrected before you approved it: the approval is refused and Claude prepares a new preview.
- The public demo can no longer be slowed down or brought down by one visitor: a visitor may add up to 10 accounts, each visitor has at most 8 requests in flight, a request body still arriving after 30 seconds is cut, and the history import's preview is refused in the demo like the import itself. Building the dashboard figures is also faster with many accounts.
- A typed amount no longer shrinks a thousandfold in languages that group the thousands with a comma or a dot: `12,500` in English (or `12.500` in German, Spanish and Portuguese) is twelve thousand five hundred, as the field shows it, not 12.50, and `1,250,000` is no longer 1.25. `12,50` and `12,5` are still read as decimals.

## [1.8.3] - 2026-11-17

### Fixed

- Chart text no longer turns blurry after the page is zoomed or moved to another screen: the charts are drawn as vectors (SVG), not as a picture.
- On Overview, "Left after expenses" names only the largest overspend, under its bar, instead of every overspent month at the zero line, where two neighbouring months' amounts ran into each other and into the bars.
- Month names under the charts no longer run into each other or get cut off at the edge (Income and expenses, Goals, the account charts and the loans timeline, seen in German, French and Spanish).

## [1.8.2] - 2026-11-17

### Fixed

- A page title no longer breaks into one letter per line when the actions beside it take the room (Overview and Income and expenses in the Russian demo at about 1200px). The title row now wraps its buttons to the next line on every page instead.
- While a page or a section loads, grey placeholders stand where its content will come, instead of the word "Loading…".

## [1.8.1] - 2026-11-17

### Changed

- The demo's sign-in page shows how many times the demo was opened from the first launch, not from the hundredth.

## [1.8.0] - 2026-11-17

### Changed

- The public demo's sign-in page is new. On the left are what Monido is, three facts and the chosen language's image. The card lists the seven families, each with its names, country and currencies. The password is filled in and named in a note, so a visitor only presses Sign in. On a phone each family takes two lines. Once the demo has been opened 100 times, the page shows how many times.
- New README images for every language, each with that language's sample family and currency, and each with a short caption:
  - the hero: the family's accounts, properties and loans running into one net worth figure;
  - Close month, Goals, Income and expenses, Assets and Financial health;
  - the phone.

  The social preview follows the hero.
- The data age under the page title warns from two finished months not closed, not one: the month that just ended waiting to be closed is the routine (the Close month badge asks for it), so the demo and a family a few days into the month no longer see "2 mo ago".
- The demo families' home repair is paid from money the checking account held for it, so no family's checking balance goes below zero after it.

## [1.7.0] - 2026-11-17

### Changed

- The demo families show the usual-month story: a December bonus of about a month's salary and one home repair three months back. A category met in fewer than half of the previous months (a one-time repair) has no "usual" amount to compare with and no zero row after it.
- The demo families' early mortgage payments are paid from the checking account, which holds that money until then, so net worth no longer jumps in the month of an early payment.
- The Claude advisor plans on the same year as the Goals page: its savings, income and expenses are the last twelve closed months' averages (the stress test stays on the last three), and it says when the last three months saved notably less than the year.
- Emergency fund in months of the year's average expenses: Financial health, the metric card and the Claude advisor divide the liquid money by the average monthly expenses of the last twelve closed months (was the last closed month's), so one big month no longer swings the zone.
- Goals plan from the year's average saving: the goals plan and the independence forecast use the average of the last twelve closed months (was three), so one repair or bonus moves them by a twelfth of it; the line under a goal also shows the last three months.
- A goal that will not be reached says why: nothing was saved in the last closed months, goals with nearer deadlines take all the savings, or not within 100 years at the current savings.
- The financial independence goal's chart shows a band of returns from 5% to 11% a year around the 8% forecast, with the month at each end, instead of a single 10% strategy; the fixed "+500 a month" line is gone, "What if we saved a month" shows any amount.
- Real net worth growth is now growth divided by inflation, `(now ÷ a year ago) ÷ (1 + inflation) − 1`, instead of growth minus inflation, which overstated it (20% growth at 10% inflation is 9.1%, not 10%); a family with high growth may see the figure and its zone move a little.

### Added

- A fictional family for every language, each in its country's currency: German, Spanish and French in euros, Brazilian in reais, Chinese in yuan, beside the American and the Russian ones. The public demo's sign-in card lists the languages and says which family each brings; "Load test data" loads the family language's family.
- Settings → Data → Import history: bring the months before you started from a spreadsheet of month-end balances (a row per month and a column per account, or a row per balance as other apps export it), pasted or as a CSV file; checked in words before it is written, removed together if needed. A template to download; the Overview and the setup wizard point to it while the history is short.
- Settings → Parameters → Expected return: the yearly return the financial independence goal grows at (8% until set, 0–30%); its forecast, its 5–11%-style band, the coast figure, the real return and the Claude advisor follow it.
- Goals: "What if we saved a month" under the saving re-runs the whole plan for the amount you type (every goal's date, the shares, the independence forecast); nothing is saved.
- Net worth in today's money: a dashed line on the net worth chart of Assets ("In today's money" in its legend), each month lifted to the last month's prices by the yearly inflation from Parameters; shown when the dashboard is in the inflation's currency ([Finance rules](docs/finance-rules.md#net-worth-in-todays-money)).
- Repay early or invest: an early loan payment still to make shows that repaying earns the loan's rate for certain and, at a return you type, which leaves more money by the loan's last payment ([Finance rules](docs/finance-rules.md#repay-early-or-invest)).
- The Claude advisor answers "repay early or invest?" for one of the family's loans with its own figures, the loan rate as the certain return and the emergency fund before and after (`compare_early_repayment`).

## [1.6.1] - 2026-11-16

### Changed

- The READMEs are plain Markdown (no centred HTML header, the screens one under another, no phone screenshot), so the translations on Weblate keep every part translated.

### Fixed

- A new loan with a term over 35 years keeps the cursor in the term field instead of losing it while the refused save runs.
- After withdrawing a proposal (or a vote that decides it) the focus lands on its history row even when the list redraws a moment later, instead of falling to the page.

## [1.6.0] - 2026-11-16

### Added

- Close month asks a broker or crypto account what was put in or taken out this month (optional, never blocks closing), the data for the per-account return.
- The month form of a broker or crypto account (Assets → Accounts → Correct) edits what was put in or taken out that month, so past months can be filled in.
- A broker or crypto account shows its return per year (money-weighted, in the account's currency) and the amount it earned, from the months where deposits and withdrawals were entered ([Finance rules](docs/finance-rules.md#return-of-an-account-money-weighted)).

### Changed

- **The database is updated on start (schema version 2).** Before the update the server writes a copy of the database, `before-upgrade-v1-<date>.sqlite`, next to it in the data folder; delete it once the new version works. An older release cannot open the updated database: to go back, restore that copy or a backup. Making a backup before updating is still the safest way.
- A new table, `account_transfers`, holds what was put into or taken out of an investment account each month (for the per-account return); an older backup restores and is updated too.

### Fixed

- Editing an account without an owner (renaming it, changing its type or currency) failed with "required field: member" once it had income and expenses.

## [1.5.0] - 2026-11-16

### Added

- Install Monido on a phone's home screen or as a desktop app (a web app manifest and icons); it opens in its own window. Nothing is cached offline.
- Close month suggests last month's income and expenses under each empty field, and offers a figure with one click when it is steady (the same in two of the last three closed months); "Fill steady figures" in an account's menu fills them all. Nothing is filled in without a click.
- The Close month breakdown offers "Add usual lines": the category lines that repeat from month to month (a rent, a subscription), added in one click and still editable.

### Changed

- The install guide creates the folder `monido` (volume `monido_data`); an installation made in `family-finance` keeps its folder and volume.

## [1.4.0] - 2026-11-16

### Added

- The interface in German, Spanish, French, Brazilian Portuguese and Simplified Chinese (machine-translated, open for review), alongside English and Russian. Telegram reminders and proposals follow the family language too.

### Fixed

- Month and year counts take the language's plural form, and month titles follow the language's order of month and year.
- Four-digit amounts are grouped in every language (`1.234` in Spanish), as the amount fields already show them.

## [1.3.0] - 2026-11-16

### Added

- Run the container as another user for a NAS data folder: `user: "uid:gid"`, or a deliberate root start (`user: "0:0"` with three capabilities) with `PUID`/`PGID`, which hands the data folder to that user and runs the server as it. The default is unchanged.

### Fixed

- Claude no longer reads a new loan's zero payment in the closed month as a missing figure (its first payment falls later), and no longer offers to edit a loan: the family does that on Loans.

## [1.2.0] - 2026-11-16

### Added

- The project website, https://monido.dev, linked from the README.
- Claude's connector works with the family password too, not only Telegram sign-in: the family approves the connection once, Claude enters data as the family (proposals still need Telegram), and the Advisor page shows how many apps are connected and when.

### Changed

- Switching the sign-in (to Telegram, or back to the password) disconnects Claude for everyone; the settings warn before the switch. A password change made while Telegram sign-in is on keeps the connections.

## [1.1.0] - 2026-11-16

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
- A month with an income or expense in a currency without a rate no longer counts that amount as zero: the Overview's twelve-month total and the month before, the Income and expenses chart and members, and the Goals months show it as unknown (`—`, a gap on the charts).
- One such row in the last closed month no longer blanks the whole Income and expenses page and the forecast's budget: only the periods that include that month have no totals.
- Financial health no longer grades a loan or an account without a rate as zero debt or money: the debt indicators and the emergency fund show no data instead of a confident zone.
- Car loans count as consumer debt in Financial health.
- The advisor's earners, stress test and income sources no longer inflate when a month of the three has a currency without a rate.
- Overview shows `—` with a note for a month whose net worth misses a balance or a rate, and no month or year change against such a month.
- The loan payments line on "Breakdown by category" shows `—` when a payment has no rate, instead of a partial sum.
- The advisor no longer grades a purchase or credit on a zero: when the last closed month has an amount without a rate, or a bank account has no rate or balance, the payment share, emergency fund and stress test are unknown and Claude says why (a 30 000 credit showed a 60.66-month fund instead of 5.12).
- The advisor's payment share is unknown, as in Financial health, while a loan with a payment has no rate; its income sources are unknown when no month of the three can be averaged.
- Financial health checks only what each indicator reads: a rateless mortgage no longer hides the consumer debt, a rateless property no longer hides the emergency fund, and a paid-off loan in a currency without a rate counts as 0.
- Real growth, capital growth per year, the net worth "How it is calculated" panel, the month and year changes and the Telegram /summary treat a month whose net worth misses a balance or a rate as unknown, as Overview does; the Overview's twelve-month savings rate is `—` with its total.
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
- Inflation has its own currency and no default: until both the rate and its currency are set, real growth shows `—`. An existing database with an inflation value gets RUB as its inflation currency (when RUB is in the project).
- Loans: the term is at most 35 years (420 months), and a payment day must be 1 to 31. A loan stored with a longer term or another day keeps it and stays editable as long as that field is left as it is. An early payment dated after the loan is repaid, or one that would leave an already entered early payment nothing to reduce, is refused.
- The database copy (`GET /api/backup`) is for members who manage users and settings only; others get 403 `no_right_manage` and no longer see the button.

[Unreleased]: https://github.com/stanislav-petryashov/monido/compare/v1.9.0...HEAD
[1.9.0]: https://github.com/stanislav-petryashov/monido/compare/v1.8.3...v1.9.0
[1.8.3]: https://github.com/stanislav-petryashov/monido/compare/v1.8.2...v1.8.3
[1.8.2]: https://github.com/stanislav-petryashov/monido/compare/v1.8.1...v1.8.2
[1.8.1]: https://github.com/stanislav-petryashov/monido/compare/v1.8.0...v1.8.1
[1.8.0]: https://github.com/stanislav-petryashov/monido/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/stanislav-petryashov/monido/compare/v1.6.1...v1.7.0
[1.6.1]: https://github.com/stanislav-petryashov/monido/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/stanislav-petryashov/monido/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/stanislav-petryashov/monido/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/stanislav-petryashov/monido/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/stanislav-petryashov/monido/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/stanislav-petryashov/monido/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/stanislav-petryashov/monido/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/stanislav-petryashov/monido/releases/tag/v1.0.0
