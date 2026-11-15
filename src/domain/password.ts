// The rule for a family password set in the app, shared by the server and the browser: length only, no composition rules.

export const PASSWORD_MIN = 12
export const PASSWORD_MAX = 128

/** The password's problem, or null: 12 to 128 characters counted as code points (an emoji is one), spaces kept and counted. */
export function passwordProblem(password: string): 'password_too_short' | 'password_too_long' | null {
  const length = [...password].length
  if (length < PASSWORD_MIN) return 'password_too_short'
  if (length > PASSWORD_MAX) return 'password_too_long'
  return null
}

/** What is wrong with a new password typed twice (the browser's forms): its own problem first, then the mismatch; null — nothing */
export type NewPasswordProblem = ReturnType<typeof passwordProblem> | 'mismatch'

export function newPasswordProblem(password: string, repeat: string): NewPasswordProblem {
  return passwordProblem(password) ?? (password === repeat ? null : 'mismatch')
}
