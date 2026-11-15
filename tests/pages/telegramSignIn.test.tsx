import { act, fireEvent, render, screen } from '@testing-library/react'
import { TelegramSignIn } from '../../src/pages/TelegramSignIn'
import { jsonResponse } from '../helpers/http'

const link = 'https://t.me/family_bot?start=login_attempt'
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(2000) })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  vi.stubGlobal('open', vi.fn())
})
afterEach(() => vi.useRealTimers())

function server(poll: () => Promise<Response>) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') return jsonResponse({ link, attempt: 'attempt' })
    if (init?.method === 'DELETE') return jsonResponse({ ok: true })
    return poll()
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
async function start() { await act(async () => { fireEvent.click(screen.getByRole('button', { name: /confirm in telegram/i })) }) }

it('targets the selected profile and checks immediately on returning to the page', async () => {
  const fetchMock = server(async () => jsonResponse({ status: 'done', member: 'Anna', manage: true }))
  const onDone = vi.fn()
  render(<TelegramSignIn proof={{ userId: 7, onDone }} />)
  await start()
  expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ userId: 7 })
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  expect(onDone).toHaveBeenCalledWith({ member: 'Anna', manage: true })
  await tick()
  expect(onDone).toHaveBeenCalledTimes(1)
})

it('resumes checking the same attempt after temporary connection failures', async () => {
  let online = false
  const fetchMock = server(async () => {
    if (!online) throw new Error('offline')
    return jsonResponse({ status: 'done', member: 'Anna', manage: true })
  })
  const onDone = vi.fn()
  render(<TelegramSignIn proof={{ userId: 7, onDone }} />)
  await start()
  await tick(); await tick(); await tick()
  expect(screen.getByRole('alert')).toBeInTheDocument()
  online = true
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /check again/i })) })
  await tick()
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
})

it('cancels the exact pending attempt and ignores a late poll after unmount', async () => {
  let finish!: (response: Response) => void
  const fetchMock = server(() => new Promise(resolve => { finish = resolve }))
  const onDone = vi.fn()
  const { unmount } = render(<TelegramSignIn proof={{ userId: 7, onDone }} />)
  await start()
  await tick()
  unmount()
  await act(async () => { finish(jsonResponse({ status: 'done', member: 'Anna', manage: true })) })
  expect(onDone).not.toHaveBeenCalled()
  expect(fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE')?.[1]?.body).toBe(JSON.stringify({ attempt: 'attempt' }))
})

it('does not overlap polling with focus checks', async () => {
  let finish!: (response: Response) => void
  const fetchMock = server(() => new Promise(resolve => { finish = resolve }))
  render(<TelegramSignIn proof={{ userId: 7, onDone: vi.fn() }} />)
  await start()
  await tick()
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  await tick()
  expect(fetchMock.mock.calls.filter(([, init]) => !init?.method)).toHaveLength(1)
  await act(async () => { finish(jsonResponse({ status: 'waiting' })) })
})

it('cancels a start that finishes after leaving the page without opening Telegram', async () => {
  let finish!: (response: Response) => void
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') return new Promise<Response>(resolve => { finish = resolve })
    return jsonResponse({ ok: true })
  })
  vi.stubGlobal('fetch', fetchMock)
  const { unmount } = render(<TelegramSignIn proof={{ userId: 7, onDone: vi.fn() }} />)
  await start()
  unmount()
  await act(async () => { finish(jsonResponse({ link, attempt: 'late' })) })
  expect(window.open).not.toHaveBeenCalled()
  expect(fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE')?.[1]?.body).toBe(JSON.stringify({ attempt: 'late' }))
})
