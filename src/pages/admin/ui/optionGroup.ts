/** At most this many options are shown side by side as a segmented control; more go into a dropdown. */
export const MAX_SEGMENTS = 4

/** Whether a list of this many options is drawn as a radiogroup (else a Select): the Field around it passes this as `group`. */
export const isOptionGroup = (count: number) => count <= MAX_SEGMENTS
