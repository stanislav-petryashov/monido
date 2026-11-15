// The Goals page's state in the address (`?goal=emergency`, `?new=1`): the title row's "+ Goal" (drawn by the shell, outside
// the page) opens the dialog through it, and a reload or a shared link keeps the chosen goal.
import { setQueryParams, useQuerySearch } from '../../lib/queryAddress'

/** `push` makes selection a history step, left with the phone's Back button. */
export function setParam(key: string, value: string | null, push = false): void {
  setQueryParams({ [key]: value }, push)
}

export function useParam(key: string): string | null {
  return new URLSearchParams(useQuerySearch()).get(key)
}
