/** The names of one demo family by role: data written into the rows, not UI text (see en-US.json / ru-RU.json). */
export interface DemoStrings {
  members: { a: string; b: string }
  accounts: { checking: string; savings: string; pensionA: string; pensionB: string; broker: string; foreign: string }
  cards: { a: string; b: string }
  categories: { housing: string; utilities: string; groceries: string; transport: string; cafes: string; entertainment: string; health: string; insurance: string; shopping: string; travel: string; other: string; salary: string; bonus: string; rent: string; interest: string; dividends: string }
  properties: { home: string; rental: string }
  loans: { mortgage: { name: string; description: string }; car: { name: string; description: string } }
  goals: { emergency: string; vacation: string; fire: string }
  notes: { bankStatement: string; annualBonus: string; agentEstimate: string }
  parameters: { inflation: string }
}

/** The dotted keys of DemoStrings, for the parity test. @public */
export const DEMO_STRING_KEYS: readonly string[] = [
  'members.a', 'members.b',
  'accounts.checking', 'accounts.savings', 'accounts.pensionA', 'accounts.pensionB', 'accounts.broker', 'accounts.foreign',
  'cards.a', 'cards.b',
  'categories.housing', 'categories.utilities', 'categories.groceries', 'categories.transport', 'categories.cafes',
  'categories.entertainment', 'categories.health', 'categories.insurance', 'categories.shopping', 'categories.travel', 'categories.other',
  'categories.salary', 'categories.bonus', 'categories.rent', 'categories.interest', 'categories.dividends',
  'properties.home', 'properties.rental',
  'loans.mortgage.name', 'loans.mortgage.description', 'loans.car.name', 'loans.car.description',
  'goals.emergency', 'goals.vacation', 'goals.fire',
  'notes.bankStatement', 'notes.annualBonus', 'notes.agentEstimate',
  'parameters.inflation',
]
