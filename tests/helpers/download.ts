import { vi } from 'vitest'

/**
 * Stubs the browser's file download, which jsdom cannot do: `URL.createObjectURL` / `revokeObjectURL` live on a URL
 * subclass put in place with vi.stubGlobal (the real URL is never changed; unstubGlobals puts it back), and the
 * download's click on its `<a>` is a spy that records the link (restored by restoreMocks).
 */
export function stubDownload(href = 'blob:copy') {
  const createObjectURL = vi.fn<(blob: Blob) => string>(() => href)
  const revokeObjectURL = vi.fn<(url: string) => void>()
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createObjectURL
    static revokeObjectURL = revokeObjectURL
  })
  const clicked: { href: string; download: string }[] = []
  const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ href: this.getAttribute('href') ?? '', download: this.download })
  })
  return { createObjectURL, revokeObjectURL, anchorClick, clicked }
}
