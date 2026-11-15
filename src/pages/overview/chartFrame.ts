/** What WindowChart and the Accounts flows chart share of their frame, in viewBox units */

/** A phone's left edge: no gridline labels there */
export const COMPACT_LEFT = 8
/** About the width of a character of the 11px gridline labels, and the gap between a label and its line */
const LABEL_CHAR = 7
const LABEL_GAP = 12
export const RIGHT = 16
/** A window this long labels every month at the foot; a longer one, the years */
export const MONTHLY_AXIS = 13

/** The left lane that fits the longest of `labels` and the gap to its line */
export const labelLane = (labels: string[]) => Math.ceil(Math.max(...labels.map(l => l.length)) * LABEL_CHAR) + LABEL_GAP
