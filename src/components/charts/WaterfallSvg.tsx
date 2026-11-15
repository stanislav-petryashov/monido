import { useEffect, useRef, useState } from 'react'

/** The frame's width before it is measured (and in a test, where nothing has a size); then a viewBox unit is a pixel */
const DEFAULT_W = 700
/** Under this width the names take the narrow lane */
const NARROW = 480
const ROW = 28
/** The names' lane, wide and narrow */
const LEFT = { wide: 210, narrow: 132 }
/** About the width of a character of the 12px value labels, and the gap and margin around one right of its bar */
const VALUE_CHAR = 7
const VALUE_PAD = 16
/** About the width of a character of the 12px names: a longer name is cut to the lane */
const NAME_CHAR = 6.5
/** The scale's padding around the running path, of its range */
const PAD = 0.06
const MIN_PLOT = 96

/** Preserve the complete value when a compact row needs more than one line. */
function wrapValue(text: string, chars: number): string[] {
  const lines: string[] = []
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + chars)
    if (end < text.length) {
      const space = text.lastIndexOf(' ', end - 1)
      if (space > start + chars / 2) end = space + 1
    }
    lines.push(text.slice(start, end))
    start = end
  }
  return lines.length ? lines : ['']
}

/** A tick of the waterfall: the start or the end total, its name and its value as text */
export interface WaterfallTick { name: string; value: number; label: string }
/** A step: from the running total to the next; `tone` — the `.asset-tone--*` suffix of its bar, none — a neutral bar */
export interface WaterfallStep { key: string; name: string; from: number; to: number; tone?: string; label: string }

interface WaterfallSvgProps {
  start: WaterfallTick
  steps: WaterfallStep[]
  end: WaterfallTick
  /** The drawing's accessible name */
  label: string
  /** The names' lane when wide, for longer names (Real estate's «Value change · 520,000 → $568,000»); 210 by default */
  lane?: number
}

/**
 * A waterfall drawing (Assets' change waterfall, Real estate's equity): the start as a tick with its value, one row per
 * step — a bar from the running total in its tone and the step's label, a step of 0 as text alone — and the end as a
 * primary tick. The scale covers the whole running path with 6% padding; the viewBox follows the measured width, so the
 * 12px text stays 12px; the room right of the bars fits the longest label.
 */
export function WaterfallSvg({ start, steps, end, label, lane = LEFT.wide }: WaterfallSvgProps) {
  const frame = useRef<HTMLDivElement>(null)
  const [measured, setMeasured] = useState(0)
  const [textSize, setTextSize] = useState(12)
  useEffect(() => {
    const el = frame.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const text = el.querySelector('.wf__v')
    const measure = () => {
      setMeasured(Math.round(el.clientWidth))
      if (text) setTextSize(parseFloat(getComputedStyle(text).fontSize) || 12)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    // A text-size preference can change rem without resizing the container.
    if (text) observer.observe(text)
    return () => observer.disconnect()
  }, [])
  const width = measured || DEFAULT_W
  const textScale = textSize / 12
  const nameLane = width < NARROW ? LEFT.narrow : lane
  const path = [start.value, ...steps.map(s => s.to), end.value]
  const lo0 = Math.min(...path), hi0 = Math.max(...path)
  const pad = (hi0 - lo0) * PAD || 1000
  const lo = lo0 - pad, hi = hi0 + pad
  const right = Math.max(start.label.length, end.label.length, ...steps.map(s => s.label.length)) * VALUE_CHAR * textScale + VALUE_PAD
  const stacked = width - nameLane - right < MIN_PLOT
  const left = stacked ? 8 : nameLane
  const plotWidth = stacked ? width - 16 : width - left - right
  const x = (v: number) => left + ((v - lo) / (hi - lo)) * plotWidth
  const labels = [start.label, ...steps.map(s => s.label), end.label]
  const lines = labels.map(text => stacked ? wrapValue(text, Math.max(1, Math.floor((width - 16) / (VALUE_CHAR * textScale)))) : [text])
  const positions: number[] = []
  let height = 4
  for (const row of lines) {
    positions.push(height)
    height += (stacked ? row.length * 16 + 48 : ROW) * textScale
  }
  height += 4
  const maxChars = Math.max(1, Math.floor((stacked ? width - 16 : left - 10) / (NAME_CHAR * textScale)))
  const cut = (name: string) => (name.length > maxChars ? `${name.slice(0, maxChars - 1)}…` : name)
  const yAt = (i: number) => positions[i]
  const plotY = (i: number) => yAt(i) + (stacked ? lines[i].length * 16 + 26 : 6) * textScale
  const name = (i: number, text: string) => <text className="wf__n" x={stacked ? 8 : left - 10} y={yAt(i) + (stacked ? 10 : ROW / 2) * textScale} textAnchor={stacked ? 'start' : 'end'} dominantBaseline="middle">{text}</text>
  const value = (i: number, at: number, zero = false) => <text className={`wf__v${zero ? ' wf__v--zero' : ''}`} x={stacked ? 8 : at} y={yAt(i) + (stacked ? 28 : ROW / 2) * textScale} dominantBaseline="middle">{lines[i].map((line, n) => <tspan key={n} x={stacked ? 8 : at} dy={n ? 16 * textScale : 0}>{line}</tspan>)}</text>
  const tick = (i: number, t: WaterfallTick, now: boolean) => (
    <g key={now ? 'end' : 'start'}>
      {name(i, cut(t.name))}
      <rect className={now ? 'wf__tick wf__tick--now' : 'wf__tick'} x={x(t.value) - 2} y={plotY(i) - 3} width={4} height={ROW - 6} rx={2} />
      {value(i, x(t.value) + 8)}
    </g>
  )

  return (
    <div ref={frame}>
      <svg className="wf" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
        {tick(0, start, false)}
        {steps.map((s, k) => {
          const i = k + 1, a0 = x(s.from), a1 = x(s.to), y = plotY(i)
          return (
            <g key={s.key} className="wf__row">
              {!stacked && <line className="wf__link" x1={a0} x2={a0} y1={y - 10} y2={y - 2} />}
              {name(i, cut(s.name))}
              {s.from === s.to
                ? value(i, a0 + 6, true)
                : (
                  <>
                    <rect className={s.tone ? `wf__bar asset-tone--${s.tone}` : 'wf__bar wf__bar--neutral'} x={Math.min(a0, a1)} y={y} width={Math.max(2, Math.abs(a1 - a0))} height={ROW - 12} rx={2} />
                    {value(i, Math.max(a0, a1) + 6)}
                  </>
                )}
            </g>
          )
        })}
        {tick(steps.length + 1, end, true)}
      </svg>
    </div>
  )
}
