import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { IconDatabaseImport } from '@tabler/icons-react'
import type { DemoDataResult } from '../../domain/api'
import { newPasswordProblem } from '../../domain/password'
import type { Language } from '../../i18n/languages'
import { loadDemoData, useDemoDataAvailability } from '../../lib/demoData'
import { useAdminWrite } from './adminQuery'
import { useBackupDownload } from './useBackupDownload'
import { DangerDialog } from './DangerDialog'
import { NewPasswordFields } from './ui/NewPasswordFields'

export interface DemoDataDialogProps {
  open: boolean
  /** 'word': the typed confirmation word and the database copy offer (the Danger zone, the wizard over data); 'plain': neither (the wizard on an empty database) */
  confirmation: 'word' | 'plain'
  /** becomes the family language with the load (the wizard's pick); without it the family language stays */
  language?: Language
  /** the load succeeded (the toast is shown); the caller closes the dialog and lands (afterDemoData) */
  onDone: (result: DemoDataResult) => void
  onClose: () => void
}

/**
 * "Load test data?" — the one dialog of the load, drawn by the Danger zone and the first-run wizard: what is replaced,
 * in telegram mode that Telegram sign-in ends, and, when no family password is stored, the new password typed twice, checked as the server checks it, before anything is deleted. The password is
 * sent only when its fields were shown, so a stored one is never replaced. A refusal is toasted and the dialog stays.
 */
export function DemoDataDialog({ open, ...props }: DemoDataDialogProps) {
  // each opening starts afresh: no password or busy state left from the last one
  return open ? <DemoDataQuestion {...props} /> : null
}

function DemoDataQuestion({ confirmation, language, onDone, onClose }: Omit<DemoDataDialogProps, 'open'>) {
  const { t } = useTranslation()
  // the host (the Danger zone, the wizard) tells a failed read of the settings
  const { available, needsPassword, endsTelegram } = useDemoDataAvailability({ reportLoadFailure: false })
  const write = useAdminWrite([])
  const [loading, setBusy] = useState(false)
  const backup = useBackupDownload()
  const busy = loading || backup.busy
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  /** remounts the question on the answer (its <dialog> closed itself) and when the password fields appear (the focus goes to the first) */
  const [round, setRound] = useState(0)

  const word = confirmation === 'word'
  const problem = needsPassword ? newPasswordProblem(password, repeat) : null
  // worded once both fields are typed: not while the first one is still being typed
  const shownProblem = password !== '' && repeat !== '' ? problem : null

  async function answer(yes: boolean) {
    if (!yes) {
      // a close the browser forced while the request runs (DangerDialog refuses the others): the question is drawn again
      if (busy) setRound(r => r + 1)
      else onClose()
      return
    }
    setBusy(true)
    // the question stays on screen, its action disabled, while the request runs
    setRound(r => r + 1)
    const loaded: { result?: DemoDataResult } = {}
    // the password only when its fields were shown: a stored one is never replaced
    const ok = await write(async () => { loaded.result = await loadDemoData(language, needsPassword ? password : undefined) },
      [t('data.danger.demo.done'), t('data.danger.demo.doneText')], t('data.danger.demo.failed'))
    // on success the caller closes the dialog and lands; the action stays disabled meanwhile
    if (ok && loaded.result) onDone(loaded.result)
    else setBusy(false)
  }

  return (
    <DangerDialog
      key={`${round}:${needsPassword}`}
      icon={IconDatabaseImport}
      title={t('data.danger.demo.confirmTitle')}
      text={(
        <>
          {word
            ? <Trans i18nKey="data.danger.demo.confirmText" values={{ word: t('data.danger.word') }} components={{ strong: <strong /> }} />
            : t('data.danger.demo.confirmTextPlain')}
          {endsTelegram && <><br /><br />{t('data.danger.demo.confirmTelegram')}</>}
        </>
      )}
      confirmLabel={t(word ? 'data.danger.demo.confirm' : 'data.danger.demo.confirmPlain')}
      requireWord={word}
      onBackup={word ? backup.download : undefined}
      busy={busy}
      onAnswer={answer}
      canSubmit={available && problem === null}
    >
      {needsPassword && (
        <>
          <p className="confirm-dialog__text">{t('data.danger.demo.passwordNote')}</p>
          <NewPasswordFields password={password} repeat={repeat} onPassword={setPassword} onRepeat={setRepeat} problem={shownProblem}
            labels={{ password: t('data.danger.demo.password'), repeat: t('data.danger.demo.passwordRepeat'), hint: t('auth.bootstrap.passwordHint') }} />
        </>
      )}
    </DangerDialog>
  )
}
