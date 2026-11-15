import { useCallback, useState } from 'react'
import { readCssPx } from '../../lib/chartColors'

/** Express geometry in text-sized units: 12-unit labels stay 12 CSS px, or 24 at 200% text. */
export function useChartFrame<T extends Element = SVGSVGElement>(defaultWidth: number) {
  const [frame, setFrame] = useState(() => ({ pixels: defaultWidth, scale: readCssPx('--fs-meta', 12) / 12 }))
  const ref = useCallback((el: T | null) => {
    if (!el || typeof ResizeObserver === 'undefined') return
    const probe = document.createElement('span')
    probe.className = 'chart-type-probe'
    probe.setAttribute('aria-hidden', 'true')
    document.body.append(probe)
    const measure = () => {
      const pixels = el.clientWidth || defaultWidth, scale = readCssPx('--fs-meta', 12) / 12
      setFrame(previous => previous.pixels === pixels && previous.scale === scale ? previous : { pixels, scale })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    observer.observe(probe)
    return () => { observer.disconnect(); probe.remove() }
  }, [defaultWidth])
  return { ref, width: frame.pixels / frame.scale, scale: frame.scale }
}
