import { IconMessageCircleQuestion } from '@tabler/icons-react'
import { lazyWithChunks } from '../../i18n/lazyWithChunks'
import type { ClientModule } from '../client'
import { useProposalsTodo } from './useProposalsTodo'

// The pages sit right in the routes: this file exports no component, and a named lazy here breaks fast refresh.
// Their texts are a locale chunk (src/locales/advisor/), loaded together with the page: the page never renders raw keys.
// /advisor/connect is where Claude's sign-in lands (/oauth/authorize redirects to it); the menu does not list it.
export const advisorClient: ClientModule = {
  key: 'advisor',
  icon: IconMessageCircleQuestion,
  routes: [
    {
      section: 'dashboard', path: '/advisor', group: 'planning', bottomBar: 80, navigationTitle: 'modules.advisor.tabs.proposals', title: 'modules.advisor.title', icon: IconMessageCircleQuestion, order: 60,
      // 'records' too: the proposal settings and the goal dialog are built from its form parts, which speak its keys
      page: lazyWithChunks(() => import('./AdvisorPage').then(m => ({ default: m.AdvisorPage })), 'advisor', 'records'),
    },
    {
      section: 'dashboard', path: '/advisor/ask', area: '/advisor', menu: false, title: 'modules.advisor.tabs.ask', icon: IconMessageCircleQuestion, order: 65,
      page: lazyWithChunks(() => import('./AskClaudePage').then(m => ({ default: m.AskClaudePage })), 'advisor', 'records'),
    },
    {
      section: 'settings', path: '/advisor/connect', title: 'modules.advisor.connect.title', icon: IconMessageCircleQuestion, order: 90, menu: false,
      page: lazyWithChunks(() => import('./ConnectPage').then(m => ({ default: m.ConnectPage })), 'advisor'),
    },
  ],
  // "Vote: <title>" rows on the menu's second floor, read from the server: in the initial bundle, so it holds one query and one key
  overview: { todoHook: useProposalsTodo },
  // a sign-in switch ends Claude's connections: the warning in Family and access, with the page texts' chunk
  signInSwitchNotice: lazyWithChunks(() => import('./SwitchNotice').then(m => ({ default: m.SwitchNotice })), 'advisor'),
}
