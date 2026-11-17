# Database schema

The source of truth is [`schema.sql`](../schema.sql). It creates empty databases only; existing databases are validated without changing their data. Fresh databases use `PRAGMA user_version = 1`; updated legacy databases (through former migration 0031) remain usable without rewriting their bookkeeping. Older schemas are not automatically upgraded. What follows is the current schema, each table with its named indexes (primary keys and `UNIQUE` columns also get SQLite's automatic ones). The database is SQLite (`finance.sqlite` in `DATA_DIR`); you can connect to it with `sqlite3 "$DATA_DIR/finance.sqlite"` (in Docker, `/data/finance.sqlite` inside the container), only as a last resort: such edits bypass the `change_log` journal (they are not on the "Change history" page), and reverting a journaled edit of a row that was later changed directly returns 409.

Dates are ISO `YYYY-MM-DD`. Monetary values are stored as SQLite REAL; rounding to exact currency units and domain constraints are not yet implemented for all tables. The built-in SQLite rowid is used by the API as the row identifier; it is not a separate business ID.

## `assets`

Allowed values of `class`: `bank`, `broker`, `crypto`, `other`.

```sql
CREATE TABLE assets (
  date     DATE NOT NULL,
  class    TEXT NOT NULL,
  name     TEXT NOT NULL,
  value    REAL NOT NULL,
  currency TEXT NOT NULL,
  member   TEXT
);
CREATE INDEX idx_assets_date ON assets (date);
```

## `goals`

```sql
CREATE TABLE goals (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  target      REAL NOT NULL,
  current     REAL NOT NULL,
  target_date DATE NOT NULL,
  emoji       TEXT,
  currency    TEXT NOT NULL DEFAULT 'USD'
);
```

## `parameters`

```sql
CREATE TABLE parameters (
  key         TEXT PRIMARY KEY,
  value       REAL NOT NULL,
  description TEXT
);
```

Known keys: `inflation_rate` (% a year, in the currency flagged `inflation`), `expected_return` (% a year, 0–30: the yearly return the financial independence goal grows at; 8 until set). A missing key is not a zero: each has its own default or none.

## `real_estate`

```sql
CREATE TABLE real_estate (
  name              TEXT NOT NULL,
  purchase_date     DATE NOT NULL,
  purchase_price    REAL NOT NULL,
  purchase_currency TEXT NOT NULL,
  valuation_year    INTEGER NOT NULL,
  value             REAL NOT NULL,
  currency          TEXT NOT NULL,
  notes             TEXT,
  member            TEXT,   -- the owner, a name from members; NULL — none set
  PRIMARY KEY (name, valuation_year)
);
```

One row per valuation; the property-level fields (`purchase_*`, `member`) repeat on every row of the property, and editing the property rewrites all of them. Migration `0011` adds `member` (the column comes last in the real table): properties entered before it have no owner and count under "No member" until one is set.

## `loans`

```sql
CREATE TABLE loans (
  name            TEXT PRIMARY KEY,
  description     TEXT,
  issue_date      DATE NOT NULL,
  principal       REAL NOT NULL,
  rate            REAL NOT NULL,
  term_months     INTEGER NOT NULL,
  monthly_payment REAL NOT NULL,
  currency        TEXT NOT NULL,
  member          TEXT NOT NULL,
  payment_day     INTEGER,
  status          TEXT DEFAULT 'active',
  closed_date     DATE,
  type            TEXT DEFAULT 'consumer',
  secured_by      TEXT   -- the property (real_estate.name) the loan is secured by; NULL — none
);
```

Migration `0029` adds `secured_by`. It names a property without a foreign key (`real_estate`'s key is `(name, valuation_year)`), so the server keeps the link: a written value is NULL or the name of a property that exists, checked inside the guarded transaction (else 400 `invalid_value { column: 'secured_by' }`). Renaming a property moves the link and deleting it sets the column NULL (the loan stays), journaled in the same mutation (`planRenameProperty` / `planDeleteProperty` of the Loans server module); the rows API refuses deleting a property's last valuation (409 `last_valuation`). Reverting the property's delete or rename entry also reverts the `secured_by` entries written with it (same `ts`). A link to a name that no longer exists (a hand-edited database) reads as none. The Real estate page shows equity and loan-to-value of a linked property.

## `monthly_cashflow`

```sql
CREATE TABLE monthly_cashflow (
  date           DATE NOT NULL,
  bank           TEXT NOT NULL,
  member         TEXT NOT NULL,
  active_income  REAL NOT NULL DEFAULT 0,
  passive_income REAL NOT NULL DEFAULT 0,
  expense        REAL NOT NULL DEFAULT 0,
  currency       TEXT NOT NULL,
  PRIMARY KEY (date, bank, member)
);
CREATE INDEX idx_monthly_cashflow_date ON monthly_cashflow (date);
```

## `loan_early_payments`

`strategy` is `reduce_term` (the payment stays, the term shortens) or `reduce_payment` (the term stays, the payment is recalculated). Optional exact bank values: `new_payment` is the actual payment after a `reduce_payment` early payment (without it the annuity formula over the remaining term, unless the loan's stored payment does not follow the formula, which then stays); `principal_credit` is the exact amount credited to principal (when NULL or 0, the formula `amount / (1 + dailyRate × days)`, with `dailyRate = rate / 365 / 100` and `days` since the previous payment or early payment). Both are read by `computeSchedule()` (`src/domain/loans.ts`).

```sql
CREATE TABLE loan_early_payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_name     TEXT    NOT NULL,
  payment_date  DATE    NOT NULL,
  amount        REAL    NOT NULL,
  strategy      TEXT    NOT NULL,
  notes         TEXT,
  new_payment REAL,
  principal_credit REAL
);
CREATE INDEX idx_loan_early_payments_name ON loan_early_payments (loan_name);
```

## `loan_payments`

What was actually paid on each loan in a month: one row per (month's first day, loan). The snapshot turns each row into an expense row of the loan (`loan: true`, the member taken from the loan) and adds it to the month's expenses. Rows exist only for months closed after migration `0017`; a month with no rows is a legacy month whose account expenses already hold the payments, so nothing is added to it (no double count). Only a month of the closed set counts, and only while the family tracks income and expenses (`app_settings.track_flows`). `loan_name` points to `loans.name` without a foreign key: a payment of a deleted loan stays as history, with no member. The rows are written only by the month-close wizard: the Data section's generic insert, update and delete answer 409 `loan_payments_by_wizard` (a hand-typed payment in a legacy month would be counted twice).

```sql
CREATE TABLE loan_payments (
  date      DATE NOT NULL,
  loan_name TEXT NOT NULL,
  amount    REAL NOT NULL,
  currency  TEXT NOT NULL,
  PRIMARY KEY (date, loan_name)
);
```

## `spending_categories`

The family's categories, one list for the whole family, for income and expenses alike (the table keeps its historical name, as do `category_spending`, `/api/spending` and the advisor's `*_spending_*` tools). `flow` (migration `0026`) names the `monthly_cashflow` total a category allocates and so its direction: `expense`, `active` income (`active_income`) or `passive` income (`passive_income`); every category from before `0026` is `expense`. The flow is fixed once the category exists (`PATCH` answers 409 `flow_fixed`: lines depend on it). `kind` applies to expense categories only: only `mandatory` feeds the mandatory monthly spending the advisor uses; `optional` is the default; `loan_payment` is the one reserved category `loan_payments` (seeded by migration `0018`; its title is the translation key, it is never renamed, re-kinded or deleted, and it survives a wipe and a demo reload). **An income category keeps the stored default `kind = 'optional'`, which means nothing for it**: the server never lets a client set a kind on an income category (400 `invalid_kind`), and a reader that filters on `kind` must check `flow` first (only `mandatory` is filtered today, and no income category can be mandatory). `one_off` marks an income that does not repeat (a bonus, a tax refund); only an income category may have it (400 `invalid_one_off` for `true` on an expense category; `false` is accepted), and no metric reads it yet. Names are unique regardless of case. The table belongs to the `cashflow` module. Like `category_spending`, `flow_lines` and `manual_mandatory_spending`, it is written only through `/api/spending`: the generic Records API answers 409 `spending_by_route` to an insert, update or delete (reading, the journal and revert stay open). A category with a line in `category_spending` or `flow_lines` cannot be deleted (409 `category_in_use`).

```sql
CREATE TABLE spending_categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  kind TEXT NOT NULL DEFAULT 'optional' CHECK (kind IN ('mandatory', 'optional', 'loan_payment'))
);
-- 0026
ALTER TABLE spending_categories ADD COLUMN flow TEXT NOT NULL DEFAULT 'expense' CHECK (flow IN ('expense', 'active', 'passive'));
ALTER TABLE spending_categories ADD COLUMN one_off INTEGER NOT NULL DEFAULT 0 CHECK (one_off IN (0, 1));
```

## `account_transfers`

What was put into (plus) or taken out of (minus) an investment account in a month, in the account's currency: one row per (month's first day, account name, member; `member` is `''` for an account without one). It is what the per-account return needs besides the balances: a transfer between the family's own accounts, so the family-wide figures (savings, growth beyond savings) never read it. No row means not known, never zero; zero is a value. An account rename or currency change moves its rows, deleting the account deletes them. Added by schema step 2.

```sql
CREATE TABLE account_transfers (
  date     DATE NOT NULL,   -- the month's first day
  name     TEXT NOT NULL,
  member   TEXT NOT NULL,   -- '' for an account without a member
  amount   REAL NOT NULL,   -- deposited − withdrawn; zero is a value
  currency TEXT NOT NULL,
  PRIMARY KEY (date, name, member)
);
```

## `flow_lines`

Lines by category that allocate one account's month totals (migration `0026`): "of this account's 1 500 of active income, 1 200 is Salary". `(date, bank, member)` is the `monthly_cashflow` row's key (the month's first day; `member` is `''` for an account without one), as text, without a foreign key (like `loan_payments.loan_name`); the amount is in that row's currency, so the table has no `currency` column (an account's currency change re-denominates its lines). The category's `flow` says which total a line allocates. The sum of an account's lines per flow never exceeds that total (0.005 tolerance): `PUT /api/spending/months/:month/account` refuses it (409 `lines_exceed_total`), so does the generic rows API when a `monthly_cashflow` insert or update would drop a total below its lines (the Cash flow row check), and so does closing a month whose draft total was lowered under its lines (422 `lines_exceed_total`, the Cash flow close check). What the lines leave is derived, never stored, and shown as Unallocated. Lines are written for a closed month (capped by its `monthly_cashflow` row) or for the month being closed (capped by its draft row; a draft field not filled in caps nothing): the snapshot sees them only once the month is closed and only while the `cashflow` module is on. A rename on the Accounts screen moves an account's lines (`onRenameAccount`), except a line whose new `(date, category_id)` key the new name already has: it stays under the old name and the snapshot warns `orphan_lines`; a line whose account row is gone (a deleted row, a direct edit) is left out of the snapshot, which warns `orphan_lines`; revert runs no module checks, and an excess it re-creates is warned (`lines_exceed_total`): only the account's remainder is clamped to zero, the categories and the coverage keep the full lines. Not a monthly table: reverting a line insert in a closed month leaves a bigger unallocated amount, not a hole. The reserved `loan_payment` category is never an account line (400 `invalid_category_flow`).

```sql
CREATE TABLE flow_lines (
  date        DATE    NOT NULL,            -- the month's first day
  bank        TEXT    NOT NULL,
  member      TEXT    NOT NULL,            -- '' for an account without a member (as monthly_cashflow writes it)
  category_id INTEGER NOT NULL REFERENCES spending_categories (id),
  amount      REAL    NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (date, bank, member, category_id)
);
CREATE INDEX idx_flow_lines_date ON flow_lines (date);
```

## `category_spending`

A month's spending in one category from one free source: a card or cash that is not an account (an account's lines are `flow_lines`); rows written before `0026`, the `Statement: …` sources included, are free sources too. One row per (month's first day, category, source, currency); a second source of the month adds to the category; the route that writes it (`/api/spending`) keeps `date` on the month's first day, accepts expense categories only (400 `invalid_category_flow`) and replaces a source's rows when it is saved again. The snapshot totals each expense category over the account lines and the free sources at the rate of the month's first day (`spending.months`). A free source has no total of its own: its lines reduce the month's pooled unallocated expense (the accounts' remainders plus the loan rows' expense), and the month warns `lines_exceed_total` (context `sources`) when they exceed it (a soft cap). The snapshot sees only the closed months and only while the `cashflow` module is on. `category_id` is a foreign key.

```sql
CREATE TABLE category_spending (
  date        DATE NOT NULL,
  category_id INTEGER NOT NULL REFERENCES spending_categories (id),
  source      TEXT NOT NULL,
  amount      REAL NOT NULL,
  currency    TEXT NOT NULL,
  PRIMARY KEY (date, category_id, source, currency)
);
```

## `manual_mandatory_spending`

The mandatory monthly spending typed by hand: at most one row (`id = 1`). The snapshot uses it, converted at today's rate, only while none of the last three calendar months up to the closed month has an amount in a `mandatory` category (a list of only optional categories does not count); `updated_at` is when it was typed (an amount older than six months is stale).

```sql
CREATE TABLE manual_mandatory_spending (
  id INTEGER PRIMARY KEY CHECK (id = 1), amount REAL NOT NULL, currency TEXT NOT NULL, updated_at TEXT NOT NULL
);
```

## `currencies`

The project's currencies, a reference list edited in Settings. `inflation = 1` marks the currency the `inflation_rate` parameter is measured in: real growth is computed in it whatever currency the dashboard shows (if several rows carry the flag, the first code wins; with none, there is no real growth). Migration `0013` added the column and set the flag on `RUB` when an `inflation_rate` row existed.

```sql
CREATE TABLE currencies (
  code      TEXT PRIMARY KEY,
  inflation INTEGER NOT NULL DEFAULT 0
);
```

## `members`

```sql
CREATE TABLE members (
  name TEXT PRIMARY KEY
);
```

## `fx_rates`

Exchange rates downloaded from Frankfurter and cached by the server (`src/server/fx.ts`): `per_usd` units of `currency` per 1 USD (USD itself is never stored). `date` is the day the rate was requested for; `source_date` is the day the source dated it. Rates stored before migration `0012` came from the Central Bank of Russia and were kept as `RUB` and `EUR` rows. Read-only through the API.

```sql
CREATE TABLE fx_rates (
  date        DATE NOT NULL,
  currency    TEXT NOT NULL,
  per_usd     REAL NOT NULL,
  source_date DATE NOT NULL,
  PRIMARY KEY (date, currency)
);
```

## `fx_manual_rates`

Rates the family enters itself, a data table (writes go through the rows API and `change_log`). A manual rate applies from its `date` until the next manual rate of the same currency, overrides the downloaded rate, and the server downloads nothing for a currency on dates it covers.

```sql
CREATE TABLE fx_manual_rates (
  currency TEXT NOT NULL,
  date     DATE NOT NULL,
  per_usd  REAL NOT NULL CHECK (per_usd > 0),
  PRIMARY KEY (currency, date)
);
```

## `change_log`

A log of every write from the control panel (`src/server/rows.ts`). `actor` is `family` (password login), the member's name (Telegram sign-in), `demo` (a demo sandbox's visitor), `scheduler`, `config` or `reset-password` (`Actor`, `src/server/http.ts`); `source` is `admin`, `mcp` for a write Claude made through the advisor's connector as that member, `bot` for a vote or comment the Telegram bot wrote for the member who sent it, `scheduler` for the hourly module run (actor `scheduler`, no person), or `config` for the server's own writes of the `auth_*` sign-in rows (actor `config` for the mirror of `.env` at start, `reset-password` for that command); `op` is `insert`, `update`, `delete`, `revert`, `restore`, `wipe` or `demo_data`; `reverts_id` refers, for `op = 'revert'`, to the reverted entry. A `restore` (Settings → Data → "Restore from file"), a `wipe` and a `demo_data` ("Load test data"; `after_json` is `{ "family": "en-US" | "ru-RU" }`) replace whole tables: their entry has `table_name = '*'` and `row_id = 0` (a restore's `after_json` is `{ "kept": "before-restore-….sqlite" }`, the copy of the replaced data in `DATA_DIR`) and cannot be reverted.

```sql
CREATE TABLE change_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT    NOT NULL,
  actor       TEXT    NOT NULL,
  source      TEXT    NOT NULL,
  table_name  TEXT    NOT NULL,
  row_id      INTEGER NOT NULL,
  op          TEXT    NOT NULL,
  before_json TEXT,
  after_json  TEXT,
  reverts_id  INTEGER
);
CREATE INDEX idx_change_log_row ON change_log (table_name, row_id);
CREATE UNIQUE INDEX idx_change_log_reverts ON change_log (reverts_id) WHERE reverts_id IS NOT NULL;
```

`idx_change_log_row` indexes the entries by table and row. `idx_change_log_reverts` allows one revert per entry: the server answers 409 `already_reverted` to a second one, and the unique index closes the race of two concurrent reverts of the same entry. Reverting the insert of a balance, flow or loan-payment row in a closed month returns 409 `closed_month_row`: it would leave a gap in the month. Fix the value on "Accounts", or the whole month with "Reopen" in the wizard.

## The "Close month" wizard

Migration `0006`. The dashboard reads only the months in `closed_months`; everything entered before the wizard is marked `closed_by = 'migration'`.

```sql
CREATE TABLE closed_months (
  month     TEXT PRIMARY KEY,   -- 'YYYY-MM'
  closed_at TEXT NOT NULL,
  closed_by TEXT NOT NULL       -- `family` or the member's name; 'migration' — history before the wizard
);

CREATE TABLE month_drafts (
  month      TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,     -- JSON MonthDraft: { rows: [{ name, member, currency, class, balance, active, passive, expense, closing, added }], loans?: [{ name, amount }] }
  updated_at TEXT NOT NULL
);

-- Added by 0027; existing month_drafts are seeded at revision 0.
CREATE TABLE month_draft_revisions (
  month TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision >= 0)
);

CREATE TABLE account_closures (
  name         TEXT NOT NULL,
  member       TEXT NOT NULL,   -- '' for an account without a member
  closed_month TEXT NOT NULL,   -- the last month in which the account is asked for
  PRIMARY KEY (name, member)
);
```

Reopening (only the last month closed by the wizard) deletes its rows with a journal entry and returns the values to the draft. The dashboard ignores `assets` and `monthly_cashflow` rows of a month with no mark in `closed_months`; the wizard shows them in the fields and replaces them on closing.

`loans` in the draft holds only the loan payments that were typed (`MonthDraft`, `src/domain/monthClose.ts`); a loan without an entry is prefilled from its schedule.

Draft saves require an opaque `expectedRevision`: a persistent counter combined with a SHA-256 digest of authoritative edit inputs. The counter advances atomically on save, rename, close and reopen; its row survives close. Category lines are excluded from the digest so flushing them after a draft save does not invalidate that save. Close still validates their limits inside the guarded mutation. Wipe and demo loading clear this internal table; backup restoration migrates and restores it, and it does not count as family data for setup.

Closing a month is a single guarded batch: the `assets` rows (dated the last day of the month) and `monthly_cashflow` rows (the first day) for each account, the `loan_payments` rows (the first day, while `loans` and `cashflow` are on), `change_log` entries, `account_closures`, the mark in `closed_months`, deletion of the draft, and advancement of its revision counter.

## Telegram reminders

Migration `0007`: a single settings row. The bot token is not stored here: the `TELEGRAM_BOT_TOKEN` environment variable sets it.

```sql
CREATE TABLE reminder_settings (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  enabled      INTEGER NOT NULL DEFAULT 0,
  start_day    INTEGER NOT NULL DEFAULT 3  CHECK (start_day BETWEEN 1 AND 15),
  hour         INTEGER NOT NULL DEFAULT 10 CHECK (hour BETWEEN 0 AND 23),
  timezone     TEXT    NOT NULL DEFAULT 'UTC',   -- IANA: 'Europe/Moscow'
  chat_id      TEXT,                             -- the linked private chat; never included in API responses
  chat_title   TEXT,
  last_sent_at TEXT,                             -- the last successful send, ISO
  last_error   TEXT,                             -- why the last send failed: JSON {"code", "params"?} (`errors.<code>`), or NULL
  language     TEXT    NOT NULL DEFAULT 'en-US', -- 0010; legacy, unused: the messages are in the family language (app_settings)
  pairing_hash       TEXT,                       -- 0014: sha256 of the pending one-time link code
  pairing_expires_at TEXT                        -- 0014: its expiry; NULL once the chat is linked
);
```

Migration `0010` added `language` (a chat bound before it got `ru-RU`, everything else `en-US`) and cleared the old prose `last_error` values. The column is no longer read for the messages, which go out in the family language (`app_settings.language`, `src/modules/reminders/reminders.ts`); migration `0015` read it once to seed that language.

Migration `0014` adds `pairing_hash` and `pairing_expires_at`: the sha256 of the one-time code that links a chat and its expiry (10 minutes); issuing a new code replaces it. When the bot hears a private `/start <code>` with the pending code, the chat is linked and `pairing_expires_at` becomes NULL in the same write; the consumed hash stays until the next code or an unlink, so the browser that issued it can confirm the link.

A restore keeps the live row and never copies a backup file's, so a chat unlinked since the backup is not linked again (`RESTORE_KEEP`, `src/server/restore.ts`).

## Family settings

Migration `0015`: the language and the display currency the whole family shares. Keys: `language` (one of `LANGUAGES`, `src/i18n/languages.ts`), `currency` (a `currencies.code`) and `track_flows` ("Track income and expenses", Settings → General: `'0'` off, absent or `'1'` on; migration `0030` writes `'0'` where the cash-flow module was off; off, the month-close wizard asks for balances only and the snapshot reads no flows, which stay in their tables). The migration seeds `language` from `reminder_settings.language` (else `en-US`) and `currency` with `USD` if listed, else the first currency alphabetically. A stored value that is no longer valid falls back when read. Changes are written to `change_log` (`table_name = 'app_settings'`, op `update`) and can be reverted from the journal. The currency in use cannot be deleted from `currencies`.

`setup_state` is the first-run wizard flag: `done`, `skipped`, or absent, which reads as `pending`. Migration `0025` writes `done` once when the database already holds an `assets`, `closed_months`, `monthly_cashflow` or `users` row (not when only `change_log` has rows). `PUT /api/setup` writes `done` or `skipped` with a `change_log` entry like the other keys; a wipe deletes only this row, so the wizard runs again. It is also written `done` by every writer of a whole family: "Load test data", the seed script and the demo template. A `setup_state` journal entry reverts with the `manage` right like the other settings. "Load test data" (`src/server/demoData.ts`) also overwrites `language` and `currency` (the family's own currency, the one with the inflation mark) and switches the sign-in to the shared family password in the same transaction (`planSharedPassword`, `src/server/authSettings.ts`): `auth_mode` becomes `password`, `auth_password` is replaced when a new password is typed, and `auth_generation` is raised, which signs everyone else out; unlike a wipe it replaces `users` and `fx_rates` too. `GET /api/setup` answers `hasData: true` when any table that load would replace holds a family record: every table but the ones a wipe keeps (`WIPE_KEEP`), the reference lists `currencies`, `members` and `parameters`, `change_log`, internal `month_draft_revisions` and the advisor's `oauth_*`, and with `spending_categories` counted without its reserved `loan_payment` row; so `closed_months` and `month_drafts` count, and a fresh or wiped install answers `false`.

```sql
CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

`schema.sql` initializes `auth_generation` to 1; the other rows appear when the server first writes them. Keys `auth_mode` (`password` or `telegram`), `auth_password` (a salted scrypt hash, `scrypt$N$r$p$salt$hash`, never the password), `auth_bot_token` (the Telegram bot token, stored in clear because the bot has to use it) and `auth_generation` (a counter that every password or mode change raises; it is part of the session signing key, so a raise signs everyone out). They are written by `src/server/authSettings.ts`; only `TELEGRAM_BOT_TOKEN` in `.env` overrides its row and is mirrored into it at every start; Password and Telegram sign-in and the password are managed in the web UI. `AUTH_MODE=none` is a temporary override and never replaces these rows.

- **Journal.** Each change is a `change_log` entry for `app_settings` whose `after_json` is `{ key, value }`; for `auth_password` and `auth_bot_token` the value is the mask `***`, never the secret or the hash. The writer is the signed-in person, or the source `config` (the mirror at start and the `reset-password` command, named `reset-password`; the journal shows "Server configuration"). A revert of an `auth_*` entry is refused.
- **Backups.** A database copy carries the hash and the token (keep it private). A restore keeps the live `auth_*` rows and does not copy the file's, so an old password, mode or revoked token does not come back. A wipe keeps `app_settings`, so the sign-in settings survive it.
- **`reset-password`** deletes `auth_password`, selects `auth_mode=password` and raises `auth_generation`; it refuses in demo mode and under `AUTH_MODE=none`. The server opens a 15-minute window to set a replacement password.

## Users

Migration `0016`: who may sign in and with which rights, one row per family member. `member` is a `members.name` (no foreign key: the Data section refuses to delete or rename a member a user points to, `member_has_user`; a wipe and a restore handle the link explicitly). `telegram_id` is unique (`email` is an unused leftover of the removed proxy sign-in). Rights default to enter data on, vote on, manage off. `invite_hash` is the sha256 of a one-time Telegram link code, valid 7 days until `invite_expires_at`. Changes are written to `change_log` (`table_name = 'users'`) without the invite columns. "Load test data" replaces the rows with two fictional users (no Telegram link).

Migration `0022` adds `telegram_linked_at`: when an accepted invite last linked a Telegram account, even the same one again. A browser session (counted from the bot's approval) or a Claude token issued at or before it was the previous link's and is dead; a value that is not a 24-character ISO time fails closed (`actorOfUser`, and the token join of `src/modules/advisor/oauth/store.ts`), so re-inviting a member to another Telegram account signs them out everywhere and ends their Claude connections, and linking the old account back does not revive them. Users linked before the migration have NULL and keep their sessions and tokens. Like the invite columns it is left out of the journal: sign-in bookkeeping, while the linking itself shows there as the new `telegram_id`. The column comes last in the real table.

```sql
CREATE TABLE users (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  member            TEXT NOT NULL UNIQUE,
  email             TEXT UNIQUE COLLATE NOCASE,
  telegram_id       TEXT UNIQUE,
  telegram_name     TEXT,
  can_edit          INTEGER NOT NULL DEFAULT 1 CHECK (can_edit IN (0, 1)),
  can_vote          INTEGER NOT NULL DEFAULT 1 CHECK (can_vote IN (0, 1)),
  can_manage        INTEGER NOT NULL DEFAULT 0 CHECK (can_manage IN (0, 1)),
  invite_hash       TEXT,
  invite_expires_at TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  telegram_linked_at TEXT          -- 0022; NULL — linked before it
);
```

## Modules (dropped)

Migration `0008` kept which features were on; migration `0030` drops the table: every module is always present. Before the drop it writes `app_settings.track_flows = '0'` when the installation had the cash-flow module off (and is not a fresh one: `setup_state` is set). Old `change_log` rows with `table_name = 'modules'` stay as history: the journal names them "Modules" and the server refuses to revert them (409 `not_revertible`).

## Claude's connector (OAuth)

Migration `0020`: the advisor connector's OAuth state, written only by `src/modules/advisor/oauth/store.ts`. `oauth_clients` are the clients Claude registers itself (Dynamic Client Registration; public clients, no secret), with their redirect URIs as a JSON array. `oauth_tokens` holds the access tokens (1 hour) and refresh tokens (30 days, replaced on every use) issued to them: only the SHA-256 hex of a token is stored, never the token. Every authorization starts a chain (`chain_id`) that refresh rotation keeps; a replayed authorization code or a reused refresh token revokes the whole chain (`revoked_at`). `user_id` is a `users.id` without a foreign key: a token of a deleted or re-created user (`users.created_at` after the token's `created_at`) is dead when used. Rows that expired more than 30 days ago are deleted whenever tokens are issued (a new authorization or a refresh). At 50 clients a registration evicts the oldest client without a live token, older than 10 minutes and not in a pending authorization or code; its token rows go with it (`ON DELETE CASCADE`).

Migration `0021` adds `telegram_id`: the Telegram account the user was linked to when they approved the connection, copied to every token of the chain on refresh. A token is live only while `users.telegram_id` is still that account, so linking the member to another Telegram account ends the old account's connection (it is not counted as connected, `/mcp` answers 401, a refresh is `invalid_grant` and revokes the chain); linking the old account back does not revive it (migration 0022: a token older than `users.telegram_linked_at` is dead too). Tokens from before the migration get `''`, which no linked account has: they are dead on their next use and their owner connects once more (the rows stay until pruned, so a reused refresh token is still recognised). The column comes last in the real table.

These are credentials, not family data and not module data (they are not among the `advisor` module's `tables`): a wipe empties both tables (Claude is disconnected for everyone), a restore keeps the live rows and never copies a backup file's, and the demo writer empties them with the users it replaces. They are not in the Records API, the journal or the CSV export.

```sql
CREATE TABLE oauth_clients (
  client_id     TEXT PRIMARY KEY,
  client_name   TEXT,
  redirect_uris TEXT NOT NULL,          -- JSON array
  created_at    TEXT NOT NULL
);
CREATE TABLE oauth_tokens (
  token_hash  TEXT PRIMARY KEY,          -- sha256 hex of the token
  kind        TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  client_id   TEXT NOT NULL REFERENCES oauth_clients (client_id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL,
  chain_id    TEXT NOT NULL,             -- one per authorization: rotation keeps it, reuse revokes it
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  revoked_at  TEXT,
  telegram_id TEXT NOT NULL DEFAULT ''   -- the user's Telegram account at consent (0021): the token dies when the user is linked to another one
);
CREATE INDEX oauth_tokens_user ON oauth_tokens (user_id);
```

## Proposals (the advisor's council)

Migration `0023`: the proposals Claude sends to the family for approval in Telegram, and how the family decided. The tables belong to the `advisor` module (`advisorMeta.tables`). They are not in the Records API or the CSV export.

- `advisor_settings`: the module's one settings row (`id = 1`, seeded with 14 days to decide and a reminder 3 days before the deadline; `remind_days` NULL means no reminder). A wipe keeps it (`WIPE_KEEP`) and empties the other council tables; a restore takes all five from the file.
- `proposals`: one per proposal: its type (a `Scenario` kind), the author (`users.id`, no foreign key: the history outlives a deleted user), the status, the current version's number, the deadline (to decide while `open`, to revise while `revising`; a new version restarts it) and when it was decided. `goal_id` is the `goals.id` made with "Create goal": it links into the Goals module's table and may dangle after the goal is deleted (the view says "goal deleted").
- `proposal_versions`: every version as it was sent. JSON columns: `scenario_json` (the `Scenario`), `evaluation_json` (the `Evaluation` the server computed at sending, in `base_currency`: the record keeps what people voted on even after the data change), `verdict_json` (Claude's `Verdict`: risk, recommended alternative, a reason without numbers) and `voters_json` (an array of `users.id` fixed at sending, the author included). `title` and `question` are people's and Claude's text after `cleanText` (`src/domain/proposals.ts`).
- `proposal_votes`: one vote per voter per version (a change overwrites). A vote from Telegram stays provisional (`settled = 0`) while its comment window is open (`pending_until`); `settled_by` says what settled it. `comment` is the voter's own text after `cleanText`.
- `proposal_messages`: delivery bookkeeping, not journaled: one row per Telegram message the bot keeps up to date (a voter's card, the author's status, a one-off notice), with its delivery state, a `dirty` count (the store's changes since the last delivery: a delivery clears only the count it read, so a change during the send stays), the attempts (reset when a failed row is marked dirty again), the last error code (a `TelegramError` code, `unlinked` (the recipient no longer has that chat), `resent` (the message was deleted and sent again once; `resent:<code>` after a later failure), `message_gone`; never a text), the hash of the last delivered render (an unchanged one is not re-sent) and `updated_at`, the last delivery attempt (a failed row waits an hour after it). The author has one `status` row per proposal: a new version moves it (its `version_id`, and its `chat_id` to the author's current account, starting over as a new message there if it changed), the cards are new per version.

Writes to `proposals`, `proposal_versions`, `proposal_votes` and `advisor_settings` are journaled, with `source` `mcp` (Claude), `bot` (Telegram), `scheduler` (the hourly run: an expiry) or `admin` (the site); none of them can be reverted from the journal (outside `isRevertibleTable`, `src/domain/journal.ts`: 409 `not_revertible`). "Load test data" and the seed script empty the four proposal tables with the users they replace and keep `advisor_settings` (`LOAD_KEEP`, `src/server/demo/writeFamily.ts`); only the demo template resets it to the defaults (`resetTelegramForDemo`, `src/server/demo/template.ts`). After a restore, `author_id` and `voters_json` may name users that are gone, or ids that now belong to someone else (a restore keeps the live `users`): the views fall back to what they know of the id, and a voter who no longer exists drops out of the count. A known limit: a restore also brings back the file's `proposal_messages` as they were then, so a row the file holds as pending or dirty is delivered again (a card re-sent or edited to the restored state, an old notice sent late); clearing them would need a restore extension point for a module's tables, which there is not yet.

```sql
CREATE TABLE advisor_settings (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  decide_days INTEGER NOT NULL DEFAULT 14 CHECK (decide_days BETWEEN 1 AND 60),
  remind_days INTEGER CHECK (remind_days IS NULL OR remind_days BETWEEN 1 AND 59)   -- NULL: no reminder
);
INSERT INTO advisor_settings (id, decide_days, remind_days) VALUES (1, 14, 3);
CREATE TABLE proposals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL CHECK (type IN ('buy_now', 'credit', 'save_up', 'goal')),
  author_id   INTEGER NOT NULL,              -- users.id, no FK: history outlives the user
  status      TEXT NOT NULL CHECK (status IN ('open', 'revising', 'accepted', 'withdrawn', 'expired')),
  version     INTEGER NOT NULL DEFAULT 1,    -- the current version's number
  created_at  TEXT NOT NULL,
  deadline_at TEXT NOT NULL,                 -- decide by (open) or revise by (revising); a new version restarts it
  decided_at  TEXT,
  goal_id     TEXT                           -- goals.id after "Create goal"; may dangle after the goal is deleted
);
CREATE TABLE proposal_versions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id     INTEGER NOT NULL REFERENCES proposals (id) ON DELETE CASCADE,
  number          INTEGER NOT NULL,
  title           TEXT NOT NULL,
  question        TEXT NOT NULL,
  scenario_json   TEXT NOT NULL,             -- Scenario
  evaluation_json TEXT NOT NULL,             -- Evaluation as computed at sending
  base_currency   TEXT NOT NULL,
  verdict_json    TEXT NOT NULL,             -- Verdict
  voters_json     TEXT NOT NULL,             -- JSON array of users.id fixed at sending, the author included
  created_at      TEXT NOT NULL,
  UNIQUE (proposal_id, number)
);
CREATE TABLE proposal_votes (
  version_id    INTEGER NOT NULL REFERENCES proposal_versions (id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL,
  vote          TEXT NOT NULL CHECK (vote IN ('agree', 'against')),
  settled       INTEGER NOT NULL DEFAULT 0 CHECK (settled IN (0, 1)),
  settled_by    TEXT CHECK (settled_by IN ('author', 'comment', 'button', 'timeout', 'site')),
  pending_until TEXT,                        -- while settled = 0: when the comment window closes
  comment       TEXT,
  voted_at      TEXT NOT NULL,
  settled_at    TEXT,
  PRIMARY KEY (version_id, user_id)
);
CREATE TABLE proposal_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL REFERENCES proposal_versions (id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL,
  chat_id    TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('card', 'status', 'notice')),   -- card: a voter's; status: the author's; notice: one-off
  notice     TEXT NOT NULL DEFAULT '' CHECK (notice IN ('', 'against', 'accepted', 'withdrawn', 'expired', 'reminder')),
  message_id INTEGER,
  state      TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sent', 'failed', 'blocked')),
  dirty      INTEGER NOT NULL DEFAULT 1,     -- the stored state changed since the last successful send or edit
  attempts   INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,                           -- a TelegramError code, never a text
  sent_hash  TEXT,                           -- sha256 of the last text + buttons delivered: an unchanged render is not re-sent
  updated_at TEXT NOT NULL,
  UNIQUE (version_id, user_id, kind, notice)
);
CREATE INDEX proposal_messages_due ON proposal_messages (state, dirty);
CREATE INDEX proposal_votes_pending ON proposal_votes (settled, pending_until);
```

## Schema version and legacy bookkeeping

Fresh databases store version 2 in SQLite's `PRAGMA user_version`; `src/server/schema.ts` initializes, upgrades and validates them. Required table columns are checked against `schema.sql`. A newer version or incompatible structure is refused before application writes.

An older database is upgraded at start (the server, the MCP connector): first a copy of it, `before-upgrade-v<old version>-YYYYMMDD-HHMMSS.sqlite` (UTC) in `DATA_DIR`, written by `VACUUM INTO`; then, in one transaction, every missing step of `STEPS` and the new version. A step only adds (a table, an index) and never rewrites data. If the copy cannot be written, the server does not start and the database is left as it was. The copy is never deleted by the app: delete it once the new version works. A restored backup of an older version is upgraded the same way (without a copy: the upload is one). An older release refuses a database of a newer version, so to go back to it, restore the copy or a backup made before the update.

| Version | Step |
|---|---|
| 1 | The schema of 1.0.0 (and updated legacy databases, below) |
| 2 | `account_transfers` (1.6.0) |

Existing installations updated through former migration `0031_family_telegram.sql` retain `schema_migrations`; their `user_version = 0` counts as version 1 and is upgraded like it. The table is left untouched and excluded from restore, wipe and demo-data replacement. Historical migration SQL files are no longer shipped. A current legacy backup restores into a fresh or legacy installation; older incomplete schemas require the previous release to update them first.
