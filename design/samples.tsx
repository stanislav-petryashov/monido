import type { ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import { routesFor } from '../src/routes'
import { TitleRow } from '../src/components/layout/TitleRow'
import { Freshness } from '../src/components/layout/Freshness'
import { CurrencySwitch } from '../src/components/layout/CurrencySwitch'
import { Sidebar } from '../src/components/layout/Sidebar'
import { BottomBar } from '../src/components/layout/BottomBar'
import { WindowChart } from '../src/pages/overview/WindowChart'
import { useDashboard } from '../src/lib/dashboardState'
import { PHONE, useMedia } from '../src/lib/media'
// Stateful samples for the catalog: the real components with a little local state, or behind a button when they block
// the page (a modal). Components only (react-refresh).
import { IconCalendar } from '@tabler/icons-react'
import { type ReactNode, useId, useRef, useState } from 'react'
import { Dialog } from '../src/components/ui/Dialog'
import { PasswordInput } from '../src/components/ui/PasswordInput'
import { RadioMenu } from '../src/components/ui/RadioMenu'
import { SegmentedPills } from '../src/components/ui/SegmentedPills'
import { Switch } from '../src/components/ui/Switch'
import { useModalDialog } from '../src/components/ui/useModalDialog'
import { useConfirm, useToast } from '../src/lib/notifyState'
import { PRIVACY_MASK, usePrivacy } from '../src/lib/privacy'

export function SwitchSample({ disabled = false }: { disabled?: boolean }) {
  const [on, setOn] = useState(true)
  return <Switch checked={on} label="Track income and expenses" disabled={disabled} onChange={setOn} />
}

const PERIODS = ['month', 'quarter', 'year', 'all'] as const
export function PillsSample({ withDisabled = false }: { withDisabled?: boolean }) {
  const [active, setActive] = useState<(typeof PERIODS)[number]>('month')
  return <SegmentedPills items={PERIODS} active={active} onSelect={setActive} ariaLabel="Period"
    disabledReason={withDisabled ? p => (p === 'all' ? 'No history yet' : undefined) : undefined} />
}

export function RadioMenuSample() {
  const [value, setValue] = useState<'dmy' | 'mdy' | 'ymd'>('dmy')
  return <RadioMenu value={value} onChange={setValue} label="Date format" triggerIcon={IconCalendar}
    options={[{ value: 'dmy', label: '31.12.2026' }, { value: 'mdy', label: '12/31/2026' }, { value: 'ymd', label: '2026-12-31' }]} />
}

export function PasswordSample({ invalid = false }: { invalid?: boolean }) {
  const [value, setValue] = useState('')
  const id = useId()
  return <span><span id={id} className="sr-only">Family password</span><PasswordInput value={value} onChange={setValue} invalid={invalid} aria-labelledby={id} /></span>
}

function OpenDialog({ onDone }: { onDone: () => void }) {
  const first = useRef<HTMLButtonElement>(null)
  const { dialogRef, close } = useModalDialog(first)
  return <Dialog dialogRef={dialogRef} className="form-dialog" onClose={onDone} onDismiss={() => close()} aria-labelledby="dc-dialog-title">
    <h2 id="dc-dialog-title" className="form-dialog__title">A sample dialog</h2>
    <p className="form-dialog__text">It floats on --raised with --shadow-float and blocks the page until closed.</p>
    <button ref={first} type="button" className="btn btn--primary" onClick={() => close()}>Close</button>
  </Dialog>
}

/** A modal blocks the page: it opens on demand */
export function DialogSample() {
  const [open, setOpen] = useState(false)
  // the button stays mounted, so the native dialog returns the focus to it when it closes
  return <><button type="button" className="btn" onClick={() => setOpen(true)}>Open the dialog</button>{open && <OpenDialog onDone={() => setOpen(false)} />}</>
}

export function ConfirmSample({ tone }: { tone: 'danger' | 'warning' }) {
  const confirm = useConfirm()
  return <button type="button" className="btn" onClick={() => void confirm({ title: 'Delete the account?', text: 'Its balances go with it.', confirmLabel: 'Delete', tone })}>Ask to confirm ({tone})</button>
}

export function ToastSample({ tone }: { tone: 'success' | 'error' }) {
  const toast = useToast()
  return <button type="button" className="btn" onClick={() => (tone === 'success' ? toast.success('Saved', 'The month is closed.') : toast.error('Not saved', new Error('The server did not answer.')))}>Show a {tone} toast</button>
}

/** A field with its own state: the real control, typed into on the page */
export function Stateful({ initial, children }: { initial: string; children: (value: string, set: (v: string) => void) => ReactNode }) {
  const [value, setValue] = useState(initial)
  return <>{children(value, setValue)}</>
}

/** A form window behind a button, as the screens open it */
export function FormDialogSample({ render }: { render: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  return <><button type="button" className="btn" onClick={() => setOpen(true)}>Open the form</button>{open && render(() => setOpen(false))}</>
}

/** A sample's amounts, masked while the catalog's privacy switch is on, as the app's own figures are: `<Amounts>{a => <X value={a('$1')} />}</Amounts>` */
export function Amounts({ children }: { children: (amount: (value: string) => string) => ReactNode }) {
  const { hidden } = usePrivacy()
  return <>{children(value => (hidden ? PRIVACY_MASK : value))}</>
}

export function HistorySample({ window }: Pick<ComponentProps<typeof WindowChart>, 'window'>) {
  const compact = useMedia(PHONE)
  const { fmt, fmtCompact } = useDashboard()
  return <WindowChart window={window} compact={compact} label="Net worth history"
    fmtCompact={fmtCompact} value={fmt(window.points[window.index].netWorth)} />
}

export function NavigationSample() {
  const { t } = useTranslation()
  const phone = useMedia(PHONE)
  const drawer = useMedia('(max-width: 1199px)')
  const [open, setOpen] = useState(false)
  const [path, setPath] = useState('/')
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const routes = routesFor({ demo: false })
  const route = routes.find(r => r.path === path)
  return <div className="shell" onClickCapture={event => {
    const link = event.target instanceof Element && event.target.closest('a')
    if (!link || link.origin !== location.origin) return
    event.preventDefault()
    event.stopPropagation()
    setPath(link.pathname)
    setOpen(false)
  }}>
    <Sidebar path={path} routes={routes} open={drawer && open} onClose={() => setOpen(false)} />
    <div className="shell__main" inert={drawer && open}>
      <div className={path === '/' ? 'shell__content shell__content--overview' : 'shell__content'}>
        {route && <TitleRow title={t(route.title)} subtitle={<Freshness />}
          actions={route.section === 'dashboard' ? <CurrencySwitch /> : undefined}
          drawerOpen={drawer && open} onMenu={() => setOpen(true)} menuButtonRef={menuButtonRef} />}
      </div>
      {phone && <BottomBar path={path} routes={routes} moreOpen={open} onMore={() => setOpen(true)} />}
    </div>
  </div>
}
