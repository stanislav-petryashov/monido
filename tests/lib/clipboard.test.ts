import { copyText } from '../../src/lib/clipboard'

afterEach(() => {
  delete (document as { execCommand?: unknown }).execCommand
})

describe('copyText', () => {
  it('does not start when the guard refuses', async () => {
    const writeText = vi.fn()
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    expect(await copyText('prompt', () => false)).toBe(false)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('does not start fallback after authorization is revoked', async () => {
    let reject!: (reason: Error) => void
    vi.stubGlobal('navigator', { clipboard: { writeText: () => new Promise<void>((_, fail) => { reject = fail }) } })
    document.execCommand = vi.fn(() => true)
    let allowed = true
    const copying = copyText('prompt', () => allowed)
    allowed = false
    reject(new Error('denied'))
    expect(await copying).toBe(false)
    expect(document.execCommand).not.toHaveBeenCalled()
  })

  it('uses the Clipboard API when it is available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    expect(await copyText('prompt')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('prompt')
  })

  it('falls back to a hidden textarea without the Clipboard API', async () => {
    vi.stubGlobal('navigator', {})
    const exec = vi.fn(() => true)
    document.execCommand = exec
    expect(await copyText('prompt')).toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('falls back when the Clipboard API refuses', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    document.execCommand = vi.fn(() => true)
    expect(await copyText('prompt')).toBe(true)
  })

  it('reports failure when nothing works', async () => {
    vi.stubGlobal('navigator', {})
    document.execCommand = vi.fn(() => false)
    expect(await copyText('prompt')).toBe(false)
  })

  it('the fallback gives keyboard focus back to where it was', async () => {
    vi.stubGlobal('navigator', {})
    document.execCommand = vi.fn(() => true)
    const button = document.createElement('button')
    document.body.appendChild(button)
    button.focus()
    await copyText('prompt')
    expect(document.activeElement).toBe(button)
    button.remove()
  })
})
