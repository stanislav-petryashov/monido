import { useId, useState } from 'react'
import { ApiError } from '../../lib/api'

/**
 * The "current password" field of a confirmation that the server checks (POST /api/auth-settings/...): its text and the
 * server's word `wrong_current_password`, shown under the field instead of a notification (`handled` is the write's
 * fourth argument, `reset` clears the word before a new try).
 */
export function useCurrentPassword() {
  const [current, setCurrent] = useState('')
  const [wrong, setWrong] = useState(false)
  const errorId = useId()
  return {
    current, setCurrent, wrong, errorId,
    reset: () => setWrong(false),
    handled: (e: unknown) => {
      if (!(e instanceof ApiError) || e.code !== 'wrong_current_password') return false
      setWrong(true)
      return true
    },
  }
}
