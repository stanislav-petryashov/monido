// The advisor's tools: named operations over the pure domain, each with a JSON schema for the input. The routes and the connector call them by name.
import type { AdvisorToolInfo, AuthMode } from '../../../domain/api'
import type { ModuleEnv } from '../../../server/config'
import type { Database } from '../../../server/db'
import { InputError, requireRight, type Actor } from '../../../server/http'
import { evaluateGoal, evaluatePurchase } from './evaluate'
import { getAdvisorGuide } from './guide'
import { getFamilyOverview } from './overview'
import { getProposal, listProposals, previewProposal, proposeToFamily, reviseProposal, withdrawProposal } from './proposals'
import { closeMonthTool, getMonthDraft } from './monthDraft'
import { addSpendingCategory, listSpendingCategories, saveAccountLinesTool, saveCategorySpending } from './spending'
import { commitLoan, previewLoan } from './loans'
import { commitStatement, previewStatement } from './statements'

/**
 * What a tool runs with: the database, who asks, whether rates may be
 * downloaded, the moment of the call; the variables the delivery to Telegram needs and the sign-in mode (proposals exist
 * only with Telegram sign-in).
 */
export interface ToolContext { db: Database; actor: Actor; download: boolean; now: Date; env: ModuleEnv; authMode: AuthMode }

export interface AdvisorTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** The right the tool needs besides a signed-in user (enter data, or vote on proposals); null — none */
  right: 'edit' | 'vote' | null
  /** True for a tool that writes with no right of its own (its store checks who may); a tool with no right and no `writes` is read-only */
  writes?: boolean
  /** True for a tool that needs a right yet writes nothing (preview_proposal): read-only all the same */
  readOnly?: boolean
  run(ctx: ToolContext, input: unknown): Promise<unknown>
}

/** Every tool, in the order Claude is shown them. */
export const ADVISOR_TOOLS: readonly AdvisorTool[] = [
  getAdvisorGuide, getFamilyOverview, evaluatePurchase, evaluateGoal, listSpendingCategories, addSpendingCategory, saveAccountLinesTool, saveCategorySpending,
  getMonthDraft, previewStatement, commitStatement, previewLoan, commitLoan, closeMonthTool,
  previewProposal, proposeToFamily, getProposal, listProposals, reviseProposal, withdrawProposal,
]

/** The tool of that name; undefined — there is none. */
export const findTool = (name: string): AdvisorTool | undefined => ADVISOR_TOOLS.find(t => t.name === name)

export const toolInfo = (tool: AdvisorTool): AdvisorToolInfo => ({
  name: tool.name, description: tool.description, inputSchema: tool.inputSchema, readOnly: tool.readOnly ?? (tool.right === null && !tool.writes),
})

/** Runs the named tool: an unknown name is 404 `unknown_tool`; a tool that writes needs its right first (403 `no_right_<right>`). */
export async function callTool(name: string, ctx: ToolContext, input: unknown): Promise<unknown> {
  const tool = findTool(name)
  if (!tool) throw new InputError('unknown_tool', 404)
  if (tool.right) requireRight(ctx.actor, tool.right)
  return tool.run(ctx, input)
}
