import { createContext, useContext } from 'react'

/** A link in a success toast: it goes to a page of the app. */
export interface ToastLink {
  label: string
  to: string
}

/** Notifications: a success disappears by itself, an error stays until dismissed. */
export interface ToastApi {
  /** `links` are shown under the text; following one closes the toast */
  success(title: string, text?: string, links?: readonly ToastLink[]): void
  /** The explanation is errorText(error) */
  error(title: string, error?: unknown): void
}

export const ToastContext = createContext<ToastApi | null>(null)

const MAX_ERROR_TEXT = 300

/** An error's text for a notification: the message without "Error: ", at most 300 characters. */
export function errorText(e: unknown): string {
  const text = (e instanceof Error ? e.message : String(e ?? '')).replace(/^Error:\s*/, '')
  return text.length > MAX_ERROR_TEXT ? `${text.slice(0, MAX_ERROR_TEXT - 1)}…` : text
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast: no NotifyProvider')
  return api
}

/** A question before an irreversible action: danger is a deletion, warning is a rollback. */
export interface ConfirmOptions {
  title: string
  text?: string
  confirmLabel: string
  tone: 'danger' | 'warning'
}
/** true if confirmed; false on Cancel, Escape, the backdrop or a new question on top. */
export type Confirm = (options: ConfirmOptions) => Promise<boolean>

export const ConfirmContext = createContext<Confirm | null>(null)

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('useConfirm: no NotifyProvider')
  return confirm
}
