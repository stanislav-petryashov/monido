/**
 * A JSON request body held open: `reading` resolves once the server starts reading it (the stream's pull(), not a
 * timer), and nothing arrives until `release()`. The high-water mark 0 keeps pull() from running before a read.
 */
export function heldBody(payload: unknown): { body: ReadableStream<Uint8Array>; reading: Promise<void>; release: () => void } {
  let started!: () => void
  const reading = new Promise<void>(resolve => { started = resolve })
  let release!: () => void
  const released = new Promise<void>(resolve => { release = resolve })
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      started()
      await released
      controller.enqueue(new TextEncoder().encode(JSON.stringify(payload)))
      controller.close()
    },
  }, { highWaterMark: 0 })
  return { body, reading, release }
}
