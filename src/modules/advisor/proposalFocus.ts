// Where the focus goes after a write on a proposal whose button is gone (a vote, Withdraw).

/**
 * After a write whose button is gone (a vote, Withdraw): the focus goes to the proposal's card, or to its history row
 * once it has moved there. The new state may be drawn a frame or more later: while the element focused leaves the page
 * (the old card), it tries again on the next frame, for half a second at most.
 */
let focusFrame = 0
export function focusProposal(id: number, frame = 0): void {
  focusFrame = requestAnimationFrame(() => {
    const target = document.getElementById(`proposal-${id}`) ?? document.getElementById(`proposal-row-${id}`)
    if (!target) return
    target.focus()
    // only the element just focused leaving the page (the old card) asks for another try
    if (frame < 30) focusFrame = requestAnimationFrame(() => { if (!target.isConnected) focusProposal(id, frame + 1) })
  })
}

/** Stops a pending focusProposal: the proposals left the page, a later card with the same id is not its target. */
export function cancelProposalFocus(): void {
  cancelAnimationFrame(focusFrame)
}
