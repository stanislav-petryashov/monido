/** An M whose middle is a nest, the right leg rising: money + nido. Static copies: public/favicon.svg (16 px cut) and docs/assets/logo.svg. */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path d="M14 0 H34 C43.2 0 48 4.8 48 14 V34 C48 43.2 43.2 48 34 48 H14 C4.8 48 0 43.2 0 34 V14 C0 4.8 4.8 0 14 0 Z" style={{ fill: 'var(--brand)' }} />
      <path
        d="M13 39 V20.5 C14.5 27.5 18.5 29.5 23 29.5 C28.5 29.5 34 23 35 11.5 V39"
        fill="none"
        strokeWidth="5.5"
        strokeLinecap="butt"
        strokeLinejoin="round"
        style={{ stroke: 'var(--on-fill)' }}
      />
    </svg>
  )
}
