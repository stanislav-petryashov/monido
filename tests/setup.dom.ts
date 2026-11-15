import '@testing-library/jest-dom'
import { setAuth } from '../src/lib/authState'

// the jsdom project only (vitest.config.ts), after tests/setup.ts

// jsdom has no modal <dialog>: open it with the attribute, close it with a close event, as the browser does
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  if (!('returnValue' in HTMLDialogElement.prototype)) {
    Object.defineProperty(HTMLDialogElement.prototype, 'returnValue', { value: '', writable: true })
  }
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement, value?: string) {
    if (!this.hasAttribute('open')) return
    if (value !== undefined) this.returnValue = value
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
}

// the default signed-in person has every right (the family password); a test of rights sets `me` with setAuth
beforeEach(() => { setAuth({ mode: 'password', me: null }) })
