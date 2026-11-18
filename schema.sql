-- Current database schema. Used only to create an empty database.

CREATE TABLE assets (
  date     DATE NOT NULL,
  class    TEXT NOT NULL,
  name     TEXT NOT NULL,
  value    REAL NOT NULL,
  currency TEXT NOT NULL,
  member   TEXT
);

CREATE TABLE goals (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  target      REAL NOT NULL,
  current     REAL NOT NULL,
  target_date DATE NOT NULL,
  emoji       TEXT,
  currency    TEXT NOT NULL DEFAULT 'USD'
);

CREATE TABLE parameters (
  key         TEXT PRIMARY KEY,
  value       REAL NOT NULL,
  description TEXT
);

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

CREATE TABLE currencies (
  code TEXT PRIMARY KEY
, inflation INTEGER NOT NULL DEFAULT 0);

CREATE TABLE members (
  name TEXT PRIMARY KEY
);

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

CREATE TABLE closed_months (
  month     TEXT PRIMARY KEY,   -- 'YYYY-MM'
  closed_at TEXT NOT NULL,      -- ISO time
  closed_by TEXT NOT NULL       -- actor of the close ('family' or the proxy e-mail); 'migration' for the history before the wizard
);

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

CREATE TABLE "fx_rates" (
  date        DATE NOT NULL,
  currency    TEXT NOT NULL,
  per_usd     REAL NOT NULL,
  source_date DATE NOT NULL,
  PRIMARY KEY (date, currency)
);

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

CREATE TABLE loan_payments (
  date      DATE NOT NULL,
  loan_name TEXT NOT NULL,
  amount    REAL NOT NULL,
  currency  TEXT NOT NULL,
  PRIMARY KEY (date, loan_name)
);

CREATE TABLE spending_categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  kind TEXT NOT NULL DEFAULT 'optional' CHECK (kind IN ('mandatory', 'optional', 'loan_payment'))
, flow TEXT NOT NULL DEFAULT 'expense' CHECK (flow IN ('expense', 'active', 'passive')), one_off INTEGER NOT NULL DEFAULT 0 CHECK (one_off IN (0, 1)));

CREATE TABLE category_spending (
  date        DATE NOT NULL,
  category_id INTEGER NOT NULL REFERENCES spending_categories (id),
  source      TEXT NOT NULL,
  amount      REAL NOT NULL,
  currency    TEXT NOT NULL,
  PRIMARY KEY (date, category_id, source, currency)
);

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

CREATE TABLE flow_lines (
  date        DATE    NOT NULL,            -- the month's first day
  bank        TEXT    NOT NULL,
  member      TEXT    NOT NULL,            -- '' for an account without a member (as monthly_cashflow writes it)
  category_id INTEGER NOT NULL REFERENCES spending_categories (id),
  amount      REAL    NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (date, bank, member, category_id)
);

-- What was put into (plus) or taken out of (minus) an investment account in a month, in its currency; no row: not known
CREATE TABLE account_transfers (
  date     DATE NOT NULL,   -- the month's first day
  name     TEXT NOT NULL,
  member   TEXT NOT NULL,   -- '' for an account without a member
  amount   REAL NOT NULL,   -- deposited − withdrawn; zero is a value
  currency TEXT NOT NULL,
  PRIMARY KEY (date, name, member)
);

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

INSERT INTO "currencies" ("code", "inflation") VALUES ('RUB', 0);
INSERT INTO "currencies" ("code", "inflation") VALUES ('USD', 0);
INSERT INTO "currencies" ("code", "inflation") VALUES ('EUR', 0);
INSERT INTO "reminder_settings" ("id", "enabled", "start_day", "hour", "timezone", "chat_id", "chat_title", "last_sent_at", "last_error", "language", "pairing_hash", "pairing_expires_at") VALUES (1, 0, 3, 10, 'UTC', NULL, NULL, NULL, NULL, 'en-US', NULL, NULL);
INSERT INTO "app_settings" ("key", "value") VALUES ('language', 'en-US');
INSERT INTO "app_settings" ("key", "value") VALUES ('currency', 'USD');
INSERT INTO "app_settings" ("key", "value") VALUES ('auth_generation', '1');
INSERT INTO "spending_categories" ("id", "name", "kind", "flow", "one_off") VALUES (1, 'loan_payments', 'loan_payment', 'expense', 0);
INSERT INTO "advisor_settings" ("id", "decide_days", "remind_days") VALUES (1, 14, 3);

PRAGMA user_version = 3;
