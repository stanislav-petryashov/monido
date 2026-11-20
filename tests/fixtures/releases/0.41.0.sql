-- 0.41.0: written by scripts/releaseFixture.ts from v0.41.0; see README.md
PRAGMA foreign_keys = OFF;
BEGIN;
CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT);
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0001_initial.sql', '2026-01-01T00:00:00.000Z', '55e6b5263559687e82fc1ecbd3b6d6fbd891e196026012c86d61843b7023bbca');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0002_portfolio_to_broker.sql', '2026-01-01T00:00:00.000Z', '62773dea8267e95b4585af08af5f5ecc928a2aca8fccac89bb0ba3b704bb0319');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0003_fx_rates.sql', '2026-01-01T00:00:00.000Z', '50dc08a096f683f1cefd67196b11f731ae8ff874045433758822f0049bae25b0');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0004_drop_legacy.sql', '2026-01-01T00:00:00.000Z', 'b39a3cce0313a2dab2a07554cc46f9e7e3aa248ef85fa6f67ef6a22a5512ea8a');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0005_change_log.sql', '2026-01-01T00:00:00.000Z', 'c2f55311eeb54d90af8b6b87d2b79674c78fa00be7a877df9c5a10da2fa55caf');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0006_month_close.sql', '2026-01-01T00:00:00.000Z', '7da380b9ae1a00e279ac7f6ecc3a260e904adb7c7418147ae7e005b27e9004cd');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0007_reminders.sql', '2026-01-01T00:00:00.000Z', '8bb9fa8f13d21b6257f6802e489a90423799d0896355f73fa4b156037fb58abd');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0008_modules.sql', '2026-01-01T00:00:00.000Z', '7aba6f966c33041e1a03941da9641bc52530510bf0d8f130b7c94b5cbeac5627');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0009_drop_mcp_module.sql', '2026-01-01T00:00:00.000Z', 'bd7c18fa9afafc7015d51fb9a206264f1f6d0eb580d936fc2fb45936c54d9106');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0010_reminder_language.sql', '2026-01-01T00:00:00.000Z', 'f550707cc958e8ee7598b62f3775d4376f55a901ce5f6604e8a923e082c08ff8');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0011_real_estate_member.sql', '2026-01-01T00:00:00.000Z', '18eb564cadcc2febfe024c9d81a2db356ce711d9e143e92e3491ff2c0abb0b26');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0012_fx_rates_per_currency.sql', '2026-01-01T00:00:00.000Z', '549ae029488fbe7243755cac676e9552a2d0edcf3ce6509905566ee400e04fce');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0013_inflation_currency.sql', '2026-01-01T00:00:00.000Z', '3f11ff7ea1148febf196fbaad520d320c1c9ee152a1a05be0b25d6d6bf233543');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0014_reminder_pairing.sql', '2026-01-01T00:00:00.000Z', '9d18d536b7c15b1ab5eda319af84ffe5c50b04c3541537793ffc77d638fd820c');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0015_app_settings.sql', '2026-01-01T00:00:00.000Z', '64e59493d55e16def5419e99b1dcc04be265fc7bcf89a18ae922e88ce76c5081');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0016_users.sql', '2026-01-01T00:00:00.000Z', '25425f607b44dd43d15406757d972459c92d4ef59fdc8688efdb8dbd739a61db');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0017_loan_payments.sql', '2026-01-01T00:00:00.000Z', 'db6e885d74cef6c1457a65e3e5a411f79c4cdd9ebea65847a70e086a49c30796');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0018_spending_categories.sql', '2026-01-01T00:00:00.000Z', '392a828d10065016f091abc99b7be0e4c18ecf619398710a8c2f834c6e2bad03');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0019_advisor_module.sql', '2026-01-01T00:00:00.000Z', '088c3abf61e7afff529015a02b723ab1884e77279cc5b5e666f66af1b9a3ff1b');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0020_advisor_oauth.sql', '2026-01-01T00:00:00.000Z', '9b0dcb3ad55653e4cbd853d9c1b5a26440602e0f7a2258c0e088d56fd362aad0');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0021_advisor_token_telegram.sql', '2026-01-01T00:00:00.000Z', 'e4e330fbbeb63fc7ae0ec64827638226d88bd59f99a6c150d7c07397d636aba9');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0022_users_telegram_linked_at.sql', '2026-01-01T00:00:00.000Z', '6690e16d8c5a79c3c4cb28f137881b122bf4a27f11fd493a7fe1585157b1a47f');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0023_advisor_council.sql', '2026-01-01T00:00:00.000Z', '01f9d24c520ba89ec28d627bb522d3ee13f8fe19e0a77b90ba30cb6425a8abd6');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0024_auth_settings.sql', '2026-01-01T00:00:00.000Z', '9d66859f5a0635958980266382499f01a32a22ac24ec1381e06b79c2697e31cd');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0025_setup_state.sql', '2026-01-01T00:00:00.000Z', 'b0d84fc59f163b1c7b569a05f343e037db01c50870c7810595211d08cc16a69c');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0026_flow_lines.sql', '2026-01-01T00:00:00.000Z', '51e793fefadb955d54a52132b52a35818a1041f24c2960b6323b66efdcbdbfc5');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0027_month_draft_revisions.sql', '2026-01-01T00:00:00.000Z', '4911cb7e37fe291bafac7a1e1d2d89302b1b169c11d002344346778de9fcd7f8');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0028_availability_assessments.sql', '2026-01-01T00:00:00.000Z', 'ab1f462c1d59b3942a95eb0115fb70738bdd34b76a67b01b3cbab4693658beb9');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0029_loan_secured_by.sql', '2026-01-01T00:00:00.000Z', '2bf6d374d7a904b6757b6cb4dead0f08d4d2d359e4bbd370284b09eb8b97e6ea');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0030_drop_modules.sql', '2026-01-01T00:00:00.000Z', '9e805d47354c393fb6abbb1487d91a6a1e55396c137747130e756e5e0c2490ff');
INSERT INTO "schema_migrations" ("name", "applied_at", "checksum") VALUES ('0031_family_telegram.sql', '2026-01-01T00:00:00.000Z', '359726ea2cb77e3914a1bc295c6558cf83aedc70893904bf89b9ca8a8213de11');
CREATE TABLE assets (
  date     DATE NOT NULL,
  class    TEXT NOT NULL,
  name     TEXT NOT NULL,
  value    REAL NOT NULL,
  currency TEXT NOT NULL,
  member   TEXT
);
INSERT INTO "assets" ("date", "class", "name", "value", "currency", "member") VALUES ('2026-01-31', 'bank', 'Checking', 10000.0, 'USD', 'Robin');
INSERT INTO "assets" ("date", "class", "name", "value", "currency", "member") VALUES ('2026-01-31', 'broker', 'Brokerage', 8000.0, 'EUR', 'Noa');
INSERT INTO "assets" ("date", "class", "name", "value", "currency", "member") VALUES ('2026-02-28', 'bank', 'Checking', 11000.0, 'USD', 'Robin');
INSERT INTO "assets" ("date", "class", "name", "value", "currency", "member") VALUES ('2026-02-28', 'broker', 'Brokerage', 8200.0, 'EUR', 'Noa');
INSERT INTO "assets" ("date", "class", "name", "value", "currency", "member") VALUES ('2026-03-31', 'bank', 'Checking', 12000.0, 'USD', 'Robin');
INSERT INTO "assets" ("date", "class", "name", "value", "currency", "member") VALUES ('2026-03-31', 'broker', 'Brokerage', 8500.0, 'EUR', 'Noa');
INSERT INTO "assets" ("date", "class", "name", "value", "currency", "member") VALUES ('2026-01-31', 'bank', 'Old card', 300.0, 'USD', 'Robin');
CREATE TABLE goals (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  target      REAL NOT NULL,
  current     REAL NOT NULL,
  target_date DATE NOT NULL,
  emoji       TEXT,
  currency    TEXT NOT NULL DEFAULT 'USD'
);
INSERT INTO "goals" ("id", "name", "target", "current", "target_date", "emoji", "currency") VALUES ('vacation', 'Vacation', 5000.0, 1200.0, '2026-12-31', NULL, 'EUR');
CREATE TABLE parameters (
  key         TEXT PRIMARY KEY,
  value       REAL NOT NULL,
  description TEXT
);
INSERT INTO "parameters" ("key", "value", "description") VALUES ('expected_return', 0.07, 'Expected yearly return');
CREATE TABLE real_estate (
  name              TEXT NOT NULL,
  purchase_date     DATE NOT NULL,
  purchase_price    REAL NOT NULL,
  purchase_currency TEXT NOT NULL,
  valuation_year    INTEGER NOT NULL,
  value             REAL NOT NULL,
  currency          TEXT NOT NULL,
  notes             TEXT, member TEXT,
  PRIMARY KEY (name, valuation_year)
);
INSERT INTO "real_estate" ("name", "purchase_date", "purchase_price", "purchase_currency", "valuation_year", "value", "currency", "notes", "member") VALUES ('Flat', '2020-05-01', 150000.0, 'USD', 2026, 180000.0, 'USD', NULL, 'Robin');
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
  type            TEXT DEFAULT 'consumer'
, secured_by TEXT);
INSERT INTO "loans" ("name", "description", "issue_date", "principal", "rate", "term_months", "monthly_payment", "currency", "member", "payment_day", "status", "closed_date", "type", "secured_by") VALUES ('Mortgage', 'Flat', '2024-01-15', 120000.0, 6.0, 240, 859.72, 'USD', 'Robin', 15, 'active', NULL, 'mortgage', 'Flat');
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
INSERT INTO "monthly_cashflow" ("date", "bank", "member", "active_income", "passive_income", "expense", "currency") VALUES ('2026-01-01', 'Checking', 'Robin', 6000.0, 30.0, 4100.0, 'USD');
INSERT INTO "monthly_cashflow" ("date", "bank", "member", "active_income", "passive_income", "expense", "currency") VALUES ('2026-02-01', 'Checking', 'Robin', 6000.0, 30.0, 4100.0, 'USD');
INSERT INTO "monthly_cashflow" ("date", "bank", "member", "active_income", "passive_income", "expense", "currency") VALUES ('2026-03-01', 'Checking', 'Robin', 6000.0, 30.0, 4100.0, 'USD');
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
INSERT INTO "loan_early_payments" ("id", "loan_name", "payment_date", "amount", "strategy", "notes", "new_payment", "principal_credit") VALUES (1, 'Mortgage', '2026-02-20', 5000.0, 'reduce_term', 'bonus', NULL, NULL);
CREATE TABLE currencies (
  code TEXT PRIMARY KEY
, inflation INTEGER NOT NULL DEFAULT 0);
INSERT INTO "currencies" ("code", "inflation") VALUES ('RUB', 0);
INSERT INTO "currencies" ("code", "inflation") VALUES ('USD', 0);
INSERT INTO "currencies" ("code", "inflation") VALUES ('EUR', 0);
CREATE TABLE members (
  name TEXT PRIMARY KEY
);
INSERT INTO "members" ("name") VALUES ('Robin');
INSERT INTO "members" ("name") VALUES ('Noa');
CREATE TABLE change_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT    NOT NULL,   -- ISO time
  actor       TEXT    NOT NULL,   -- 'family' (password mode) or the e-mail from the proxy header
  source      TEXT    NOT NULL,   -- 'admin'
  table_name  TEXT    NOT NULL,
  row_id      INTEGER NOT NULL,
  op          TEXT    NOT NULL,   -- 'insert' | 'update' | 'delete' | 'revert'
  before_json TEXT,
  after_json  TEXT,
  reverts_id  INTEGER             -- for op = 'revert': the change it undid
);
INSERT INTO "change_log" ("id", "ts", "actor", "source", "table_name", "row_id", "op", "before_json", "after_json", "reverts_id") VALUES (1, '2026-04-02T10:00:00.000Z', 'robin@example.test', 'admin', 'assets', 1, 'insert', NULL, '{"name":"Checking"}', NULL);
CREATE TABLE closed_months (
  month     TEXT PRIMARY KEY,   -- 'YYYY-MM'
  closed_at TEXT NOT NULL,      -- ISO time
  closed_by TEXT NOT NULL       -- actor of the close ('family' or the proxy e-mail); 'migration' for the history before the wizard
);
INSERT INTO "closed_months" ("month", "closed_at", "closed_by") VALUES ('2026-01', '2026-02-02T10:00:00.000Z', 'robin@example.test');
INSERT INTO "closed_months" ("month", "closed_at", "closed_by") VALUES ('2026-02', '2026-03-02T10:00:00.000Z', 'robin@example.test');
INSERT INTO "closed_months" ("month", "closed_at", "closed_by") VALUES ('2026-03', '2026-04-02T10:00:00.000Z', 'robin@example.test');
CREATE TABLE month_drafts (
  month      TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,     -- JSON MonthDraft
  updated_at TEXT NOT NULL
);
CREATE TABLE account_closures (
  name         TEXT NOT NULL,
  member       TEXT NOT NULL,   -- '' for an account without a member
  closed_month TEXT NOT NULL,   -- last month the account is required in
  PRIMARY KEY (name, member)
);
INSERT INTO "account_closures" ("name", "member", "closed_month") VALUES ('Old card', 'Robin', '2026-01');
CREATE TABLE reminder_settings (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  enabled      INTEGER NOT NULL DEFAULT 0,
  start_day    INTEGER NOT NULL DEFAULT 3  CHECK (start_day BETWEEN 1 AND 15),
  hour         INTEGER NOT NULL DEFAULT 10 CHECK (hour BETWEEN 0 AND 23),
  timezone     TEXT    NOT NULL DEFAULT 'UTC',
  chat_id      TEXT,
  chat_title   TEXT,
  last_sent_at TEXT,
  last_error   TEXT
, language TEXT NOT NULL DEFAULT 'en-US', pairing_hash TEXT, pairing_expires_at TEXT);
INSERT INTO "reminder_settings" ("id", "enabled", "start_day", "hour", "timezone", "chat_id", "chat_title", "last_sent_at", "last_error", "language", "pairing_hash", "pairing_expires_at") VALUES (1, 0, 3, 10, 'UTC', NULL, NULL, NULL, NULL, 'en-US', NULL, NULL);
CREATE TABLE "fx_rates" (
  date        DATE NOT NULL,
  currency    TEXT NOT NULL,
  per_usd     REAL NOT NULL,
  source_date DATE NOT NULL,
  PRIMARY KEY (date, currency)
);
INSERT INTO "fx_rates" ("date", "currency", "per_usd", "source_date") VALUES ('2026-01-01', 'EUR', 0.92, '2026-01-01');
INSERT INTO "fx_rates" ("date", "currency", "per_usd", "source_date") VALUES ('2026-01-31', 'EUR', 0.92, '2026-01-31');
INSERT INTO "fx_rates" ("date", "currency", "per_usd", "source_date") VALUES ('2026-02-01', 'EUR', 0.93, '2026-02-01');
INSERT INTO "fx_rates" ("date", "currency", "per_usd", "source_date") VALUES ('2026-02-28', 'EUR', 0.93, '2026-02-28');
INSERT INTO "fx_rates" ("date", "currency", "per_usd", "source_date") VALUES ('2026-03-01', 'EUR', 0.91, '2026-03-01');
INSERT INTO "fx_rates" ("date", "currency", "per_usd", "source_date") VALUES ('2026-03-31', 'EUR', 0.91, '2026-03-31');
CREATE TABLE fx_manual_rates (
  currency TEXT NOT NULL,
  date     DATE NOT NULL,
  per_usd  REAL NOT NULL CHECK (per_usd > 0),
  PRIMARY KEY (currency, date)
);
CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO "app_settings" ("key", "value") VALUES ('language', 'en-US');
INSERT INTO "app_settings" ("key", "value") VALUES ('auth_generation', '1');
INSERT INTO "app_settings" ("key", "value") VALUES ('currency', 'USD');
INSERT INTO "app_settings" ("key", "value") VALUES ('setup_state', 'done');
INSERT INTO "app_settings" ("key", "value") VALUES ('track_flows', '1');
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
  updated_at        TEXT NOT NULL
, telegram_linked_at TEXT, telegram_sign_in INTEGER NOT NULL DEFAULT 1 CHECK (telegram_sign_in IN (0, 1)), telegram_reminders INTEGER NOT NULL DEFAULT 0 CHECK (telegram_reminders IN (0, 1)), telegram_proposals INTEGER NOT NULL DEFAULT 1 CHECK (telegram_proposals IN (0, 1)), telegram_conversation INTEGER NOT NULL DEFAULT 1 CHECK (telegram_conversation IN (0, 1)));
INSERT INTO "users" ("id", "member", "email", "telegram_id", "telegram_name", "can_edit", "can_vote", "can_manage", "invite_hash", "invite_expires_at", "created_at", "updated_at", "telegram_linked_at", "telegram_sign_in", "telegram_reminders", "telegram_proposals", "telegram_conversation") VALUES (1, 'Robin', 'robin@example.test', NULL, NULL, 1, 1, 1, NULL, NULL, '2026-04-02T10:00:00.000Z', '2026-04-02T10:00:00.000Z', NULL, 1, 0, 1, 1);
INSERT INTO "users" ("id", "member", "email", "telegram_id", "telegram_name", "can_edit", "can_vote", "can_manage", "invite_hash", "invite_expires_at", "created_at", "updated_at", "telegram_linked_at", "telegram_sign_in", "telegram_reminders", "telegram_proposals", "telegram_conversation") VALUES (2, 'Noa', NULL, '1002', 'noa', 0, 1, 0, NULL, NULL, '2026-04-02T10:00:00.000Z', '2026-04-02T10:00:00.000Z', NULL, 1, 0, 1, 1);
CREATE TABLE loan_payments (
  date      DATE NOT NULL,
  loan_name TEXT NOT NULL,
  amount    REAL NOT NULL,
  currency  TEXT NOT NULL,
  PRIMARY KEY (date, loan_name)
);
INSERT INTO "loan_payments" ("date", "loan_name", "amount", "currency") VALUES ('2026-01-01', 'Mortgage', 859.72, 'USD');
INSERT INTO "loan_payments" ("date", "loan_name", "amount", "currency") VALUES ('2026-02-01', 'Mortgage', 859.72, 'USD');
INSERT INTO "loan_payments" ("date", "loan_name", "amount", "currency") VALUES ('2026-03-01', 'Mortgage', 859.72, 'USD');
CREATE TABLE spending_categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  kind TEXT NOT NULL DEFAULT 'optional' CHECK (kind IN ('mandatory', 'optional', 'loan_payment'))
, flow TEXT NOT NULL DEFAULT 'expense' CHECK (flow IN ('expense', 'active', 'passive')), one_off INTEGER NOT NULL DEFAULT 0 CHECK (one_off IN (0, 1)));
INSERT INTO "spending_categories" ("id", "name", "kind", "flow", "one_off") VALUES (1, 'loan_payments', 'loan_payment', 'expense', 0);
INSERT INTO "spending_categories" ("id", "name", "kind", "flow", "one_off") VALUES (2, 'Groceries', 'mandatory', 'expense', 0);
INSERT INTO "spending_categories" ("id", "name", "kind", "flow", "one_off") VALUES (3, 'Travel', 'optional', 'expense', 1);
CREATE TABLE category_spending (
  date        DATE NOT NULL,
  category_id INTEGER NOT NULL REFERENCES spending_categories (id),
  source      TEXT NOT NULL,
  amount      REAL NOT NULL,
  currency    TEXT NOT NULL,
  PRIMARY KEY (date, category_id, source, currency)
);
INSERT INTO "category_spending" ("date", "category_id", "source", "amount", "currency") VALUES ('2026-01-01', 1, 'Checking', 859.72, 'USD');
INSERT INTO "category_spending" ("date", "category_id", "source", "amount", "currency") VALUES ('2026-01-01', 2, 'Checking', 900.0, 'USD');
INSERT INTO "category_spending" ("date", "category_id", "source", "amount", "currency") VALUES ('2026-02-01', 1, 'Checking', 859.72, 'USD');
INSERT INTO "category_spending" ("date", "category_id", "source", "amount", "currency") VALUES ('2026-02-01', 2, 'Checking', 900.0, 'USD');
INSERT INTO "category_spending" ("date", "category_id", "source", "amount", "currency") VALUES ('2026-03-01', 1, 'Checking', 859.72, 'USD');
INSERT INTO "category_spending" ("date", "category_id", "source", "amount", "currency") VALUES ('2026-03-01', 2, 'Checking', 900.0, 'USD');
CREATE TABLE manual_mandatory_spending (
  id INTEGER PRIMARY KEY CHECK (id = 1), amount REAL NOT NULL, currency TEXT NOT NULL, updated_at TEXT NOT NULL
);
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
  revoked_at  TEXT
, telegram_id TEXT NOT NULL DEFAULT '');
CREATE TABLE advisor_settings (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  decide_days INTEGER NOT NULL DEFAULT 14 CHECK (decide_days BETWEEN 1 AND 60),
  remind_days INTEGER CHECK (remind_days IS NULL OR remind_days BETWEEN 1 AND 59)   -- NULL: no reminder
);
INSERT INTO "advisor_settings" ("id", "decide_days", "remind_days") VALUES (1, 14, 3);
CREATE TABLE proposals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL CHECK (type IN ('buy_now', 'credit', 'save_up', 'goal')),
  author_id   INTEGER NOT NULL,              -- users.id, no FK: history outlives the user
  status      TEXT NOT NULL CHECK (status IN ('open', 'revising', 'accepted', 'withdrawn', 'expired')),
  version     INTEGER NOT NULL DEFAULT 1,    -- the current version's number
  created_at  TEXT NOT NULL,
  deadline_at TEXT NOT NULL,                 -- decide by (open) or revise by (revising); a new version restarts it
  decided_at  TEXT,
  goal_id     TEXT                           -- goals.id after "Create goal"; may dangle after a goals purge
);
INSERT INTO "proposals" ("id", "type", "author_id", "status", "version", "created_at", "deadline_at", "decided_at", "goal_id") VALUES (1, 'credit', 1, 'accepted', 1, '2026-04-02T10:00:00.000Z', '2026-04-16T10:00:00.000Z', '2026-04-02T10:00:00.000Z', NULL);
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
INSERT INTO "proposal_versions" ("id", "proposal_id", "number", "title", "question", "scenario_json", "evaluation_json", "base_currency", "verdict_json", "voters_json", "created_at") VALUES (1, 1, 1, 'New car', 'Can we take a car loan?', '{}', '{}', 'USD', '{}', '[1,2]', '2026-04-02T10:00:00.000Z');
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
INSERT INTO "proposal_votes" ("version_id", "user_id", "vote", "settled", "settled_by", "pending_until", "comment", "voted_at", "settled_at") VALUES (1, 2, 'agree', 1, 'button', NULL, NULL, '2026-04-02T10:00:00.000Z', '2026-04-02T10:00:00.000Z');
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
CREATE TABLE flow_lines (
  date        DATE    NOT NULL,            -- the month's first day
  bank        TEXT    NOT NULL,
  member      TEXT    NOT NULL,            -- '' for an account without a member (as monthly_cashflow writes it)
  category_id INTEGER NOT NULL REFERENCES spending_categories (id),
  amount      REAL    NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (date, bank, member, category_id)
);
INSERT INTO "flow_lines" ("date", "bank", "member", "category_id", "amount") VALUES ('2026-01-01', 'Checking', 'Robin', 2, 900.0);
INSERT INTO "flow_lines" ("date", "bank", "member", "category_id", "amount") VALUES ('2026-02-01', 'Checking', 'Robin', 2, 900.0);
INSERT INTO "flow_lines" ("date", "bank", "member", "category_id", "amount") VALUES ('2026-03-01', 'Checking', 'Robin', 2, 900.0);
CREATE TABLE month_draft_revisions (
  month TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision >= 0)
);
CREATE TABLE availability_assessments (
  month TEXT NOT NULL,
  name TEXT NOT NULL,
  member TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL,
  balance REAL NOT NULL CHECK (balance >= 0),
  available INTEGER NOT NULL CHECK (available IN (0, 1)),
  reserve REAL NOT NULL CHECK (reserve >= 0),
  goals REAL NOT NULL CHECK (goals >= 0),
  commitments REAL NOT NULL CHECK (commitments >= 0),
  PRIMARY KEY (month, name, member),
  CHECK (reserve + goals + commitments <= balance + 0.00000001),
  CHECK (available = 1 OR reserve + goals + commitments = 0)
);
CREATE TABLE family_telegram_groups (
 chat_id TEXT PRIMARY KEY, title TEXT NOT NULL,
 reminders INTEGER NOT NULL DEFAULT 0 CHECK (reminders IN (0, 1)),
 proposals INTEGER NOT NULL DEFAULT 0 CHECK (proposals IN (0, 1)),
 conversation INTEGER NOT NULL DEFAULT 0 CHECK (conversation IN (0, 1)),
 proposal_cursor INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE family_telegram_pairing (id INTEGER PRIMARY KEY CHECK (id = 1), hash TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE family_telegram_reminder_delivery (chat_id TEXT PRIMARY KEY, last_sent_at TEXT NOT NULL);
DELETE FROM sqlite_sequence;
INSERT INTO sqlite_sequence VALUES ('change_log', 1);
INSERT INTO sqlite_sequence VALUES ('loan_early_payments', 1);
INSERT INTO sqlite_sequence VALUES ('proposal_versions', 1);
INSERT INTO sqlite_sequence VALUES ('proposals', 1);
INSERT INTO sqlite_sequence VALUES ('spending_categories', 3);
INSERT INTO sqlite_sequence VALUES ('users', 2);
CREATE INDEX idx_assets_date        ON assets(date);
CREATE INDEX idx_monthly_cashflow_date ON monthly_cashflow(date);
CREATE INDEX idx_loan_early_payments_name
  ON loan_early_payments(loan_name);
CREATE INDEX idx_change_log_row ON change_log(table_name, row_id);
CREATE UNIQUE INDEX idx_change_log_reverts ON change_log(reverts_id) WHERE reverts_id IS NOT NULL;
CREATE INDEX oauth_tokens_user ON oauth_tokens (user_id);
CREATE INDEX proposal_messages_due ON proposal_messages (state, dirty);
CREATE INDEX proposal_votes_pending ON proposal_votes (settled, pending_until);
CREATE INDEX idx_flow_lines_date ON flow_lines (date);
PRAGMA user_version = 0;
COMMIT;
PRAGMA foreign_keys = ON;
