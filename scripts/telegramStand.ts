// The Telegram stand: npm run dev:telegram. The app in telegram mode on a throwaway database with one proposal in each
// state, without a real bot: see docs/development.md. A control page signs you in as any family member, and the bot's
// messages go to this terminal. Never reads .env: the real bot token stays out, and the real Telegram is not called.
import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { html } from 'hono/html'
import type { AuthRuntime } from '../src/server/authSettings'
import { startServer } from '../src/server/main'
import { prepareStand, standCookie, standEnv, standFetch, STAND_MEMBERS } from './telegramStandLib'

const DATA_DIR = resolve('data-telegram')
const CONTROL_PORT = 8081
/** Vite's address: the control page and the app share the host `localhost`, and a cookie does not depend on the port. */
const APP_URL = 'http://localhost:5173'

const nameOf = (chatId: string) => STAND_MEMBERS.find(m => m.telegramId === chatId)?.member ?? chatId

async function main(): Promise<void> {
  globalThis.fetch = standFetch(globalThis.fetch, {
    onSend: ({ method, chatId, text }) => console.log(`[bot → ${nameOf(chatId)}] ${method}\n${text}\n`),
  })

  const { scenarios, userIds } = await prepareStand(DATA_DIR, resolve('schema.sql'), new Date(), globalThis.fetch)
  let auth: AuthRuntime | undefined
  await startServer(standEnv(DATA_DIR), runtime => { auth = runtime })

  const control = new Hono()
  // the session cookie is for the host `localhost` of the app: from 127.0.0.1 it would never arrive there
  control.use(async (c, next) => {
    const url = new URL(c.req.url)
    if (url.hostname !== 'localhost') return c.redirect(`http://localhost:${CONTROL_PORT}${url.pathname}`)
    await next()
  })
  control.get('/', c => c.html(html`<!doctype html><meta charset="utf-8"><title>Telegram stand</title>
    <h1>Telegram stand</h1>
    <h2>Sign in as</h2>
    <ul>${STAND_MEMBERS.map(m => html`<li><a href="/as/${m.member}">${m.member}</a> (Telegram id ${m.telegramId})</li>`)}</ul>
    <h2>Proposals, one in each state</h2>
    <ul>${scenarios.map(s => html`<li>${s.key}: ${s.title}</li>`)}</ul>
    <p>The bot's messages are in the terminal.</p>`))
  control.get('/as/:member', async c => {
    const at = STAND_MEMBERS.findIndex(m => m.member === c.req.param('member'))
    if (at === -1 || !auth) return c.notFound()
    c.header('Set-Cookie', await standCookie(auth, userIds[at]))
    return c.redirect(`${APP_URL}/advisor`)
  })
  serve({ fetch: control.fetch, port: CONTROL_PORT, hostname: '127.0.0.1' })
  console.log(`[stand] ready: open http://localhost:${CONTROL_PORT}`)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
