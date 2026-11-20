import type { DateFormat } from './dateFormat'
// The shapes that cross the HTTP boundary: what /api/* answers and what the browser sends. Types only —
// the server builds the answers, the browser reads them with apiFetch<T> / apiSend<T>, neither imports the other.
import type { AccountKey } from './accounts'
import type { AccountInfo, DraftLoanPayment, DraftRow, FlowHints, MonthDraft, draftTotals, problemsIn } from './monthClose'
import type { CatchUpRow } from './catchUp'
import type { ReminderSettings, Schedule } from '../modules/reminders/domain'
import type { Language } from '../i18n/languages'
import type { ManualMandatory, SpendingCategory } from './types'
import type { Scenario } from './advisor'
import type { Evaluation } from './advisorImpact'
import type { NumberChange, ProposalStatus, ScenarioChange, Verdict, VoteValue } from './proposals'

// --- Data section: the generic tables (/api/admin/:table) -------------------------------------------------------

/** A row of a table as the API sends it: its columns and the address (`rowid`) the writes use. */
export type Row = Record<string, string | number | null> & { rowid: number }

/** GET /api/admin/:table — the rows, newest first, and the names of the table's columns. */
export interface AdminRows<R = Row> {
  rows: R[]
  columns: string[]
}

/** A row of the change journal (`change_log`); the rows of before/after are JSON text. */
export interface ChangeEntry {
  id: number; ts: string; actor: string; source: string; table_name: string; row_id: number
  op: string; before_json: string | null; after_json: string | null; reverts_id: number | null
}

// --- Family settings ---------------------------------------------------------------------------------------------

/** GET/PUT /api/settings — the family-wide UI language and display currency (a code of the project's currencies). */
/** GET/PUT /api/settings; `trackFlows` — "Track income and expenses": false closes months with balances only and leaves the flows out of the dashboard */
export interface FamilySettings { language: Language; currency: string; trackFlows: boolean; dateFormat: DateFormat }

/** The first-run wizard flag: absent in the database means 'pending'. */
export type SetupState = 'pending' | 'done' | 'skipped'
/** GET /api/setup */
export interface SetupView { state: SetupState; hasData: boolean; hasAccounts: boolean }
/** PUT /api/setup */
export interface SetupRequest { state: 'done' | 'skipped' }

/** POST /api/demo-data — the fictional family was written: the family language and currency it set. */
export interface DemoDataResult { loaded: true; language: Language; currency: string }

// --- Month close -------------------------------------------------------------------------------------------------

/** The wizard's screen: GET /api/month-close, and the answer of every write under /api/month-close/:month/*. */
/** The catch-up grid after a pause (src/server/catchUp.ts); GET /api/month-close/catch-up answers { grid }, null when it is not offered */
export interface CatchUpState {
  /** The grid's months, oldest first: the open months but the newest, up to the first with income or expense data */
  months: string[]
  /** The first open month left to the wizard because it already has income or expense data; null when none was */
  leftOut: string | null
  /** The newest open month, closed in the wizard after the grid */
  newest: string
  rows: CatchUpRow[]
  /** The last known balance per account key: the hint under a row's first empty cell */
  lastKnown: Record<AccountKey, number>
  /** Sent back as expectedRevision: a change since the grid was read refuses the close */
  revision: string
}

export interface MonthCloseState {
  /** Finished months waiting to be closed, oldest first */
  queue: string[]
  /** The catch-up grid is offered (two or more open months, the first without income or expense data): GET /api/month-close/catch-up draws it */
  catchUp: boolean
  /** The first month of the queue — the only one that can be filled in */
  month: string | null
  rows: DraftRow[]
  /** One line per loan with a payment due this month; empty without the loans and cash-flow modules */
  loanPayments: DraftLoanPayment[]
  /** Last month's balances by account key */
  hints: Record<AccountKey, number>
  /** Last closed month's flow figures by account key, each marked steady when it repeats (flowHintsFor) */
  flowHints: FlowHints
  totals: ReturnType<typeof draftTotals>
  problems: ReturnType<typeof problemsIn>
  /** Opaque identity of the authoritative edit inputs; null only when no month is open. */
  draftRevision: string | null
  draftSavedAt: string | null
  lastClosed: { month: string; reopenable: boolean } | null
  /** The queue is empty: the date from which the next month can be closed */
  nextOpensOn: string | null
  incomplete: { month: string; missing: number }[]
  /** Accounts from past months missing in this one: brought back in one click */
  suggested: AccountInfo[]
  /** Rows of this month already in the tables (entered past the wizard); closing replaces them */
  strayRows: number
  members: string[]
  currencies: string[]
  /** The family tracks income and expenses (`trackFlows`): without it the wizard neither asks for nor writes flows or loan payments */
  flows: boolean
  /** What a history import (Settings → Data) works with */
  history: {
    /** The month an import must end at (right before the first closed month); null — nothing closed, any month up to `until` */
    endsAt: string | null
    /** The last finished month */
    until: string
    /** The months imports closed; null — none */
    imported: { first: string; last: string } | null
    /** The accounts recorded so far: a sheet column with the same name and member is the same account */
    accounts: { name: string; member: string; class: string; currency: string }[]
  }
}

/** PUT /api/month-close/:month/draft */
export interface DraftRevisionRequest { expectedRevision: string }

export interface DraftRequest extends DraftRevisionRequest {
  rows: DraftRow[]
  loans?: MonthDraft['loans']
}

/** PUT /api/loans/:rowid — loan fields plus every rename dependency, atomically. */
export type LoanUpdateRequest = { expectedName: string } & Partial<Record<'name' | 'description' | 'issue_date' | 'principal' | 'rate' | 'term_months' | 'monthly_payment' | 'currency' | 'member' | 'payment_day' | 'status' | 'closed_date' | 'type', string | number | null>>

/** POST /api/real-estate/update — shared fields across all stored valuations. */
export interface PropertyUpdateRequest {
  name: string
  values: { name: string; purchase_date: string; purchase_price: number; purchase_currency: string; member: string | null }
  /** The details the editor opened with: stored ones that differ → 409 row_changed */
  expected?: Record<'purchase_date' | 'purchase_price' | 'purchase_currency' | 'member', string | number | null>
}

/** POST /api/real-estate/delete — remove every stored valuation of the property. */
export interface PropertyDeleteRequest { name: string }

/** Account identity is the exact name/member tuple; an absent stored member is ''. */
export interface AccountIdentity { name: string; member: string }

/** POST /api/accounts/update — all account rows and rename dependencies in one operation. */
export interface AccountUpdateRequest {
  from: AccountIdentity
  values: { name: string; member: string; currency: string; class: string }
}

/** POST /api/accounts/month — edit an existing month's balance and flows together. */
export interface AccountMonthRequest {
  account: AccountIdentity
  month: string
  balance: number | null
  active: number
  passive: number
  expense: number
  /** A broker or crypto account's deposits (account_transfers): absent — left alone; null — not known; a number, zero too — written */
  deposited?: number | null
  /** The month as the form opened it (null — no balance or no flow row); stored values that differ → 409 row_changed */
  expected?: { balance: number | null; active: number | null; passive: number | null; expense: number | null; deposited?: number | null }
}

// --- Reminders ---------------------------------------------------------------------------------------------------

/** GET /api/reminders and writes to settings, link and test. */
export interface RemindersView {
  recipients: { id: string; title: string; kind: 'user' | 'group' | 'legacy'; enabled: boolean }[]
  /** Whether the bot token is set; without it the block explains how to set it up */
  configured: boolean
  linked: boolean
  /** chatId never leaves the server: only whether a chat is linked and the account name */
  settings: Omit<ReminderSettings, 'chatId'>
  openMonths: string[]
  next: { date: string; hour: number; minute: number } | null
}

/** POST /api/reminders/pairing returns this code; POST /api/reminders/link must return it. */
export interface ReminderPairing { pairingToken: string }

/** PUT /api/reminders — the schedule. */
export type RemindersRequest = Schedule

// --- Spending: /api/spending (the Cash flow module) ---------------------------------------------------------------

/**
 * What every /api/spending call answers: the family's categories (each with the flow it allocates), each account's lines
 * per month with the totals they allocate, each free source's month with its totals per currency, the hand-typed mandatory amount.
 */
export interface SpendingRecords {
  categories: SpendingCategory[]
  /**
   * An account of a closed month (its cash-flow row) or of the month being closed (its draft row), and any month's lines
   * whose account is gone (`orphaned`, `totals` and `currency` null). `totals` — what the lines allocate (a draft field
   * not filled in is null); `items` — the stored lines, in the account's currency; `allocated` — their sum per flow.
   * Newest month first, then bank and member
   */
  accounts: {
    month: string; bank: string; member: string; currency: string | null
    totals: { active: number | null; passive: number | null; expense: number | null } | null
    items: { categoryId: number; amount: number }[]
    allocated: { active: number; passive: number; expense: number }
    orphaned: boolean
  }[]
  /** `items` — the stored lines of the source's month (the screen edits them); `totals` — their sum per currency */
  sources: { month: string; source: string; totals: { currency: string; amount: number }[]; items: { categoryId: number; amount: number; currency: string }[] }[]
  manual: ManualMandatory | null
}

// --- Advisor ------------------------------------------------------------------------------------------------------

/** A tool of the advisor as /api/advisor/tools lists it; `inputSchema` is JSON Schema, `readOnly` — it writes nothing. */
export interface AdvisorToolInfo {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  readOnly: boolean
}

/**
 * GET /api/advisor/oauth/requests/:id: what the consent screen shows. `clientName` is the client's own claim (anyone can
 * register one); `redirectHost` is where the answer goes, which is what the person should check; `member` — who signs
 * (null — the family, with the family password).
 */
export interface ConsentRequest { clientName: string | null; redirectHost: string; member: string | null }

/**
 * GET /api/advisor/connector: whether Claude's connector works here (`reason` — the missing condition: `auth_mode` —
 * neither Telegram nor the family password is the sign-in, `fallback` — Telegram sign-in with no linked manager, `app_url` — APP_URL is not https://), the address to paste into Claude, and who is connected.
 */
export interface ConnectorView {
  available: boolean
  reason: 'auth_mode' | 'fallback' | 'app_url' | null
  mcpUrl: string | null
  /** member null — the family's connection (family-password sign-in); clients — the apps holding it; lastIssuedAt — the newest approval or refresh */
  connected: { member: string | null; you: boolean; clients: number; lastIssuedAt: string }[]
}

// --- Advisor: proposals and approval --------------------------------------------------------------------------------

/** The council settings: days to decide, and how many days before the deadline the reminder goes (null — none). */
export interface AdvisorSettings { decideDays: number; remindDays: number | null }

/** A voter of a version and their vote; `settled` false — still provisional (the comment window is open) or none yet. */
export interface ProposalVoteView { userId: number; member: string; vote: VoteValue | null; settled: boolean; comment: string | null; votedAt: string | null }

/** One version of a proposal as it was sent: the numbers are the server's, stored at sending, in its `baseCurrency`. */
export interface ProposalVersionView {
  id: number; number: number; title: string; question: string; scenario: Scenario; evaluation: Evaluation; verdict: Verdict
  baseCurrency: string
  createdAt: string; votes: ProposalVoteView[]
  /** against the previous version; empty for version 1 */
  changes: { scenario: ScenarioChange[]; numbers: NumberChange[] }
}

/** A proposal: its current version, the earlier ones newest first, and what the person asking may do with it. */
export interface ProposalView {
  id: number; type: Scenario['kind']; status: ProposalStatus; author: { userId: number; member: string }
  createdAt: string; deadlineAt: string; decidedAt: string | null; baseCurrency: string
  /** the goal made with "Create goal"; `deleted` — it is gone (a goals purge) */
  goal: { id: string; deleted: boolean } | null
  current: ProposalVersionView; previous: ProposalVersionView[]
  /** `vote` — the user's vote on the current version, `settled` — and it is counted (false while the bot's comment window is open) */
  you: { voter: boolean; vote: VoteValue | null; settled: boolean; author: boolean }
}

/** GET /api/advisor/proposals; `available` false — no council here (Telegram sign-in is not enabled, or no user): no proposals. */
export interface ProposalsView { available: boolean; proposals: ProposalView[]; settings: AdvisorSettings; canCreateGoal: boolean }

/**
 * POST /api/advisor/proposals/:id/votes: a vote from the site, settled at once; the comment is the person's own text.
 * `versionId` — the version the person read; another one is current now → 409 advisor.version_changed.
 */
export interface VoteRequest { vote: VoteValue; comment?: string; versionId: number }

/** POST /api/advisor/proposals/:id/comment: a comment added to one's own settled agree on the current version. */
export interface CommentRequest { comment: string; versionId: number }

/** PUT /api/advisor/proposals/:id/goal: links an accepted proposal to the goal made from it. */
export interface LinkGoalRequest { goalId: string }


// --- Users and rights --------------------------------------------------------------------------------------------

export type Right = 'edit' | 'vote' | 'manage'
export type Rights = Record<Right, boolean>
export type AuthMode = 'password' | 'telegram' | 'oidc' | 'demo' | 'bootstrap' | 'none'

/** Who is signed in. name null: the family password or the demo */
export interface Me { name: string | null; rights: Rights }

export interface BotStatus { configured: boolean; username: string | null; problem: string | null }

/** telegram: '@username' or the account's name; null — not linked */
export interface UserView { id: number; member: string; telegram: string | null; invitePending: boolean; rights: Rights }

/** GET /api/users @public */
export interface UsersView { mode: AuthMode; bot: BotStatus; users: UserView[]; meId: number | null }

/** GET /api/auth-settings: the sign-in settings as a manager sees them; never a token or a hash */
export interface AuthSettingsView {
  mode: 'password' | 'telegram' | 'oidc' | 'none'
  /** The mode the family chose; differs from `mode` while it has fallen back to the password */
  stored: 'password' | 'telegram' | 'oidc'
  /** Whether changes to the sign-in mode are disabled. */
  locked: boolean
  password: { set: boolean; source: 'app' | null }
  bot: { source: 'env' | 'app' | null; username: string | null; problem: string | null }
  /** The switch to Telegram sign-in: each condition as it stands now */
  switchToTelegram: { bot: boolean; linkedManager: boolean; proof: { member: string; manage: boolean } | null }
  /** The effective mode fell back from the stored personal mode (no manager who can sign in, or no usable provider) at start */
  fallback: 'password' | 'bootstrap' | null
}

/** @public */
export interface NewUserRequest { member: string; rights?: Partial<Rights> }
/** @public */
export interface UserUpdate { rights?: Partial<Rights> }

/** A single-use link to the bot that ties a Telegram account to a user */
/** @public */
export interface InviteLink { link: string; expiresAt: string }
