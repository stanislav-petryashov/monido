// What the bot hears, in the shape the handlers read: Telegram's raw update, normalized by telegram.ts.

/** name: first + last name, else @username, else null */
export interface BotUser { id: string; name: string | null }

/** A text message (chatType is Telegram's: 'private', 'group', …) or an inline button press. */
export type BotUpdate =
  | { kind: 'message'; chatId: string; chatType: string; chatTitle?: string; from: BotUser; text: string; date: number }
  | { kind: 'callback'; id: string; chatId: string; messageId: number; from: BotUser; data: string }
