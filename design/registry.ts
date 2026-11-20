// The registry of every shared UI element: the catalog page draws it, the AI greps it (grep -rn "use:" design/), and
// tests/design/registry.test.tsx checks it against the code. One entry per element; `name` and `use` on one line.
import type { ReactNode } from 'react'
import { CSS_ENTRIES } from './sections/css'
import { MORE_ENTRIES } from './sections/more'
import { CANONICAL_ENTRIES, TO_MERGE_ENTRIES } from './sections/toMerge'
import { UI_ENTRIES } from './sections/ui'

export interface DesignEntry {
  /** The export (`Card`) or the CSS class (`.note`) */
  name: string
  /** When to use it, and what to use instead when not */
  use: string
  kind: 'component' | 'css' | 'pattern'
  /** A component's module */
  from?: string
  /** The stylesheet that owns its look */
  owner: string
  variants: { label: string; render: () => ReactNode }[]
  /** On a duplicate: the canonical entry it is to merge into */
  duplicateOf?: string
}

/** The component folders every export of which must have an entry or a reason in NOT_SHOWN */
export const FOLDERS = ['src/components/ui', 'src/components/cards', 'src/pages/admin/ui', 'src/components/charts', 'src/components/finance']

/** The shared stylesheets every block class of which must have an entry or a reason */
export const SHARED_CSS = [
  'src/styles/controls.css', 'src/styles/ui-surfaces.css', 'src/styles/record-list.css',
  'src/styles/progress-track.css', 'src/styles/disclosure.css', 'src/styles/record-charts.css',
]

/** The registry's source files, for the one-line check */
export const REGISTRY_FILES = ['design/sections/ui.tsx', 'design/sections/css.tsx', 'design/sections/more.tsx', 'design/sections/toMerge.tsx']

/** Exports and classes the catalog does not draw, each with the reason */
export const NOT_SHOWN: Record<string, string> = {
  SUCCESS_MS: 'a constant: how long a success toast stays',
  memberTint: 'a helper: the tint of a member, seen in OwnerAvatar',
  toneStyle: 'a helper: the inline style of a semantic tone, seen in Avatar',
  toneTextStyle: 'a helper: the text colour of a semantic tone, seen in Chip',
  useModalDialog: 'a hook: the mechanics behind Dialog',
  useTopModalDialog: 'a hook: the mechanics behind Dialog',
  usePopover: 'a hook: the mechanics behind RadioMenu and the menus',
  useDisclosure: 'a hook: the open state behind a popover',
  // src/pages/admin/ui
  PageAction: 'places the screen action in the title row through a portal; seen on every Records screen',
  PageActionSlot: 'the context PageAction renders into',
  LoadingScreen: 'a Records screen while it loads: Loading in .admin-empty, shown under Loading',
  DateTextInput: 'the typed part of DateInput, shown there',
  onEscape: 'a helper: Escape handling of fields',
  MAX_SEGMENTS: 'a constant: when OptionPicker turns into a Select',
  isOptionGroup: 'a helper of OptionPicker',
  revealUnreadDate: 'a helper of DateInput',
  datePatternHint: 'a helper of DateInput',
  dateProblem: 'a helper of DateInput',
  holdEnter: 'a helper of DateInput',
  useDateText: 'a hook behind DateInput',
  useFieldError: 'a hook behind Field errors',
  useMaskedInput: 'a hook behind AmountInput and NumberInput',
  useRestoredCaret: 'a hook behind the masked inputs',
  // src/components/charts
  AreaChart: 'the ECharts area chart inside CapitalHistoryPanel, shown there',
  wrapChartText: 'a helper: chart label wrapping',
  textWidth: 'a helper: chart label measuring',
  fitAxisLabels: 'a helper: chart axis labels',
  core: 'the ECharts core with the app modules registered',
  buildChartTheme: 'a helper: the chart theme from the tokens',
  ensureChartTheme: 'a helper: registers the chart theme',
  useChartTheme: 'a hook: the chart theme of the current colour mode',
  escapeHtml: 'a helper: tooltip HTML escaping',
  useChartFrame: 'a hook: a chart frame size',
  // src/components/finance
  AccountRow: 'an account of AvailabilityPanel, shown there',
  AssessmentEditor: 'the editor of an account of AvailabilityPanel, shown there',
  AvailabilityHero: 'the head of AvailabilityPanel, shown there',
  FlowBar: 'the family flow bar of AvailabilityPanel, shown there',
  '.dialog': 'the surface of Dialog, shown there',
  '.card': 'the surface of Card, shown there',
  '.progress-track': 'the track of ProgressTrack, shown there',
  '.floating-surface': 'the surface of menus and popovers, shown under RadioMenu',
  '.gl-table': 'the Goals shares table: the reading table, shown under .page-table, merges into it',
  '.re-vals': 'the property valuations table: the reading table, merges into .page-table',
  '.num': 'a utility: tabular figures on any element',
  '.record-row': 'a row of a record list, shown under the record list pattern of its screens',
  '.progress-label': 'the caption of ProgressTrack, shown there',
  '.disclosure': 'the surface of Disclosure, shown there',
  '.disclosure-group': 'the frame of DisclosureGroup, shown there',
  '.gl-chart': 'the frame of a chart on Goals, shown with its chart',
  '.ln-chart': 'the frame of a chart on Loans, shown with its chart',
  '.re-chart': 'the frame of a chart on Real estate, shown with its chart',
  '.wchart': 'the frame of WindowChart (Overview), shown with its chart',
  '.cfband': 'the frame of the income and expenses band chart, shown with its chart',
  '.acc-flows': 'the frame of an account flows chart, shown with its chart',
  '.chart-key': 'a chart legend swatch, shown with its chart',
}

export const ENTRIES: DesignEntry[] = [...UI_ENTRIES, ...MORE_ENTRIES, ...CSS_ENTRIES, ...CANONICAL_ENTRIES, ...TO_MERGE_ENTRIES]
