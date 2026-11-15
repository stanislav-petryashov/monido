import { render, screen } from '@testing-library/react'
import { ProgressTrack } from '../../src/components/ui/ProgressTrack'

it.each([[37.5, 37.5], [-10, 0], [150, 100]])('bounds the visible and accessible progress for %s', (pct, expected) => {
  render(<ProgressTrack pct={pct} label="Saved" />)
  const track = screen.getByRole('progressbar', { name: 'Saved' })
  expect(track).toHaveAttribute('aria-valuemin', '0')
  expect(track).toHaveAttribute('aria-valuemax', '100')
  expect(track).toHaveAttribute('aria-valuenow', String(expected))
  expect(track.firstElementChild).toHaveStyle({ width: `${expected}%` })
})

it.each([NaN, Infinity, -Infinity])('keeps non-finite progress unknown and visually empty (%s)', pct => {
  render(<ProgressTrack pct={pct} label="Saved" />)
  const track = screen.getByRole('progressbar', { name: 'Saved' })
  expect(track).not.toHaveAttribute('aria-valuenow')
  expect(track.firstElementChild).toHaveStyle({ width: '0%' })
})

it('exposes the amount description as well as the bounded percentage', () => {
  render(<ProgressTrack pct={125} label="Allocation" valueText="125 of 100" />)
  expect(screen.getByRole('progressbar', { name: 'Allocation' })).toHaveAttribute('aria-valuetext', '125 of 100')
})
