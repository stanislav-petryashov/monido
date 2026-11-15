import type { ModuleMeta } from '../types'

export const remindersMeta: ModuleMeta = {
  key: 'reminders',
  tables: ['reminder_settings'],
  // Telegram messages leave the sandbox
  notInDemo: true,
}
