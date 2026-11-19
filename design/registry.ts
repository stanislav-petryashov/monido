// The registry of every shared UI element: the catalog page draws it, the AI greps it (grep -rn "use:" design/), and
// tests/design/registry.test.tsx checks it against the code. One entry per element; `name` and `use` on one line.
import type { ReactNode } from 'react'
import { CSS_ENTRIES } from './sections/css'
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
export const FOLDERS = ['src/components/ui']

/** The shared stylesheets every block class of which must have an entry or a reason */
export const SHARED_CSS = [
  'src/styles/controls.css', 'src/styles/ui-surfaces.css', 'src/styles/record-list.css',
  'src/styles/progress-track.css', 'src/styles/disclosure.css', 'src/styles/record-charts.css',
]

/** The registry's source files, for the one-line check */
export const REGISTRY_FILES = ['design/sections/ui.tsx', 'design/sections/css.tsx']

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
  '.dialog': 'the surface of Dialog, shown there',
  '.card': 'the surface of Card, shown there',
  '.progress-track': 'the track of ProgressTrack, shown there',
  '.floating-surface': 'the surface of menus and popovers, shown under RadioMenu',
  '.gl-table': 'the Goals shares table: the reading table, shown under .page-table, merges into it',
  '.re-vals': 'the property valuations table: the reading table, merges into .page-table',
  '.num': 'a utility: tabular figures on any element',
  '.record-row': 'a row of a record list, shown under the record list pattern of its screens',
  '.progress-label': 'the caption of ProgressTrack, shown there',
  '.disclosure-group': 'the frame of DisclosureGroup, shown there',
  '.gl-chart': 'the frame of a chart on Goals, shown with its chart',
  '.ln-chart': 'the frame of a chart on Loans, shown with its chart',
  '.re-chart': 'the frame of a chart on Real estate, shown with its chart',
  '.wchart': 'the frame of WindowChart (Overview), shown with its chart',
  '.cfband': 'the frame of the income and expenses band chart, shown with its chart',
  '.acc-flows': 'the frame of an account flows chart, shown with its chart',
  '.chart-key': 'a chart legend swatch, shown with its chart',
}

export const ENTRIES: DesignEntry[] = [...UI_ENTRIES, ...CSS_ENTRIES]
