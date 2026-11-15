export type ChatBehaviour = 'ok' | 'down' | 'blocked' | 'gone' | 'timeout' | 'messageGone'

/**
 * Telegram as a fetch: every call is remembered (`method`, the JSON `body`, its `chat`); each chat answers as set in
 * `chats` (default: yes; down = 502, blocked = 403, gone = 400 chat not found, timeout = the socket drops, messageGone =
 * an edit answers 400), `goDown()` makes every chat answer 502, `hold()` keeps every call waiting until the release it
 * returns. Message ids count up from 500. `stub: true` also installs it as the global fetch (vi.stubGlobal).
 */
export function fakeTelegram({ stub = false }: { stub?: boolean } = {}) {
  const calls: { method: string; chat: string; body: Record<string, unknown> }[] = []
  const chats: Record<string, ChatBehaviour> = {}
  let held: Promise<void> | null = null
  let down = false
  let nextId = 500
  const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (held) await held
    const url = String(input)
    const method = url.slice(url.lastIndexOf('/') + 1)
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    const chat = String(body.chat_id)
    calls.push({ method, chat, body })
    if (down) return answer({ ok: false, error_code: 502, description: 'Bad Gateway' }, 502)
    if (chats[chat] === 'timeout') throw new Error('socket hang up')
    if (chats[chat] === 'messageGone' && method === 'editMessageText') {
      return answer({ ok: false, error_code: 400, description: 'Bad Request: message to edit not found' }, 400)
    }
    switch (chats[chat] ?? 'ok') {
      case 'down': return answer({ ok: false, error_code: 502, description: 'Bad Gateway' }, 502)
      case 'blocked': return answer({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }, 403)
      case 'gone': return answer({ ok: false, error_code: 400, description: 'Bad Request: chat not found' }, 400)
      default: return answer({ ok: true, result: method === 'sendMessage' ? { message_id: nextId++ } : true })
    }
  }) as unknown as typeof fetch
  if (stub) vi.stubGlobal('fetch', fetchImpl)
  const to = (chat: string) => calls.filter(c => c.chat === chat)
  function hold(): () => void {
    let release!: () => void
    held = new Promise(resolve => { release = resolve })
    return () => { held = null; release() }
  }
  return { calls, chats, fetchImpl, to, hold, goDown: () => { down = true } }
}
