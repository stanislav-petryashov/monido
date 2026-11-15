export interface TelegramPreferences { signIn: boolean; reminders: boolean; proposals: boolean; conversation: boolean }
export interface FamilyTelegramUser extends TelegramPreferences { userId: number }
export interface FamilyTelegramGroup { chatId: string; title: string; reminders: boolean; proposals: boolean; conversation: boolean }
export interface FamilyTelegramView { users: FamilyTelegramUser[]; groups: FamilyTelegramGroup[] }
export interface FamilyTelegramPairing { command: string; expiresAt: string }
