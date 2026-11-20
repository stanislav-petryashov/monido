-- 1.12.0: written by scripts/releaseFixture.ts from v1.12.0; see README.md
PRAGMA foreign_keys = OFF;
BEGIN;
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
CREATE TABLE account_closings (
  name         TEXT NOT NULL,
  member       TEXT NOT NULL,   -- '' for an account without a member
  closed_month TEXT NOT NULL,   -- last month the account is required in
  PRIMARY KEY (name, member, closed_month)
);
INSERT INTO "account_closings" ("name", "member", "closed_month") VALUES ('Old card', 'Robin', '2026-01');
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
CREATE TABLE user_identities (
  id        INTEGER PRIMARY KEY,
  user_id   INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  issuer    TEXT NOT NULL,
  subject   TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  UNIQUE (issuer, subject)
);
INSERT INTO "user_identities" ("id", "user_id", "issuer", "subject", "linked_at") VALUES (1, 1, 'https://id.example.test', 'robin', '2026-04-02T10:00:00.000Z');
CREATE TABLE identity_invites (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hash       TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL
);
INSERT INTO "identity_invites" ("user_id", "hash", "expires_at") VALUES (2, 'invite-hash', '2026-04-09T10:00:00.000Z');
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
CREATE TABLE account_transfers (
  date     DATE NOT NULL,   -- the month's first day
  name     TEXT NOT NULL,
  member   TEXT NOT NULL,   -- '' for an account without a member
  amount   REAL NOT NULL,   -- deposited − withdrawn; zero is a value
  currency TEXT NOT NULL,
  PRIMARY KEY (date, name, member)
);
INSERT INTO "account_transfers" ("date", "name", "member", "amount", "currency") VALUES ('2026-02-01', 'Brokerage', 'Noa', 200.0, 'EUR');
INSERT INTO "account_transfers" ("date", "name", "member", "amount", "currency") VALUES ('2026-03-01', 'Brokerage', 'Noa', 0.0, 'EUR');
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
PRAGMA user_version = 4;
COMMIT;
PRAGMA foreign_keys = ON;
