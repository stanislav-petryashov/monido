import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Delays only the live-region text; persistence keeps its own timing. */
export function useMonthCloseAnnouncement({ scope, dirty, busy, blocked, completed, edited }: {
  scope: string | null; dirty: boolean; busy: boolean; blocked: boolean; completed: string; edited: string
}): string {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const seen = useRef({ scope, completed, dirty, edited, pending: false })
  useEffect(() => {
    if (!scope || blocked || !busy) return
    const timer = setTimeout(() => setText(t('data.close.saving')), 600)
    return () => clearTimeout(timer)
  }, [scope, busy, blocked, edited, t])
  /* eslint-disable react-hooks/set-state-in-effect -- clear the live region before a repeated announcement */
  useEffect(() => {
    const current = seen.current
    if (current.scope !== scope) {
      seen.current = { scope, completed, dirty, edited, pending: false }
      setText('')
      return
    }
    if ((dirty && !current.dirty) || current.edited !== edited) {
      current.pending = false
      setText('')
    }
    current.edited = edited
    current.dirty = dirty
    if (current.completed !== completed) {
      current.completed = completed
      current.pending = true
    }
    if (!scope || blocked) {
      current.pending = false
      setText('')
      return
    }
    if (dirty || busy) setText(current => busy && current === t('data.close.saving') ? current : '')
    if (dirty || busy || !current.pending) return
    setText('')
    const timer = setTimeout(() => {
      current.pending = false
      setText(t('data.close.savedAnnouncement'))
    }, 150)
    return () => clearTimeout(timer)
  }, [scope, dirty, busy, blocked, completed, edited, t])
  /* eslint-enable react-hooks/set-state-in-effect */
  return text
}
