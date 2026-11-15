// Modules: the features the code is organised in, every one always present. Types and the key list only — pure, shared by the server and the browser.

/** The order of the blocks on Overview. A new module is a new line here and in catalog.ts. */
export const MODULE_KEYS = ['cashflow', 'loans', 'real_estate', 'goals', 'health', 'claude_prompts', 'advisor', 'reminders'] as const
export type ModuleKey = typeof MODULE_KEYS[number]

/** A module's facts. Its title is the locale key `modules.<key>.title`. */
export interface ModuleMeta {
  key: ModuleKey
  /** Its own tables: their row checks and limits are the module's */
  tables: readonly string[]
  /** Upper limits of numeric columns of its tables, table → column → the largest value; a write over one is 400 invalid_value */
  limits?: Readonly<Record<string, Readonly<Record<string, number>>>>
  /** Absent in the public demo (it would reach outside the sandbox: Telegram, Claude's connector): no pages, API, routes, hourly run or bot updates there */
  notInDemo?: true
}
