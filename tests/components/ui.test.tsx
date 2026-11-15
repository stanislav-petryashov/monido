import { fireEvent, render, screen } from '@testing-library/react'
import { IconTrash, IconWallet } from '@tabler/icons-react'
import { PageSkeleton } from '../../src/components/ui/Skeleton'
import { Chip } from '../../src/components/ui/Chip'
import { Avatar } from '../../src/components/ui/Avatar'
import { PasswordInput } from '../../src/components/ui/PasswordInput'
import { Switch } from '../../src/components/ui/Switch'
import { Notice } from '../../src/components/ui/Notice'
import { SegmentedBar } from '../../src/components/ui/SegmentedBar'
import { Ring } from '../../src/components/ui/Ring'
import { createRef } from 'react'
import { TitleRow } from '../../src/components/layout/TitleRow'
import { requestPageFocus } from '../../src/lib/pageFocus'
import { renderWithSnapshot } from '../helpers/render'

// the small building blocks of src/components/ui (and the title row), one describe each

describe('Skeleton', () => {
  it('PageSkeleton exposes an accessible loading status', () => {
    render(<PageSkeleton />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
  })
})

describe('Chip', () => {
  it('renders its text in a neutral color by default', () => {
    render(<Chip>No data</Chip>)
    expect(screen.getByText('No data')).toHaveAttribute('data-color', 'secondary')
  })

  it('takes a semantic color', () => {
    render(<Chip color="success">Good</Chip>)
    expect(screen.getByText('Good')).toHaveAttribute('data-color', 'success')
  })

  it('paints its text with the readable text token, the tint stays the base color', () => {
    render(<Chip color="warning">Needs work</Chip>)
    const chip = screen.getByText('Needs work')
    expect(chip.style.color).toBe('var(--warning-text)')
    expect(chip.style.background).toBe('var(--warning-16)')
  })
})

describe('Notice', () => {
  it('is its own paper strip, not a bordered card', () => {
    render(<Notice as="p">Finish setting up</Notice>)
    const notice = screen.getByText('Finish setting up')
    expect(notice.tagName).toBe('P')
    expect(notice).toHaveClass('notice', 'mb-2')
    expect(notice).not.toHaveClass('card')
  })
})

describe('Avatar', () => {
  it('renders the icon on a tinted square of the given size', () => {
    const { container } = render(<Avatar icon={IconWallet} color="info" size="sm" />)
    const box = container.firstChild as HTMLElement
    expect(box).toHaveAttribute('data-color', 'info')
    expect(box.style.width).toBe('30px')
    expect(box.querySelector('svg')).toBeInTheDocument()
  })

  it('hides from the accessibility tree: the text beside it carries the meaning', () => {
    const { container } = render(<Avatar icon={IconWallet} color="primary" size="sm" />)
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('has a large size for dialogs', () => {
    const { container } = render(<Avatar icon={IconTrash} color="error" size="lg" />)
    const avatar = container.querySelector('.avatar') as HTMLElement
    expect(avatar.style.width).toBe('72px')
    expect(avatar.querySelector('svg')).toHaveAttribute('width', '36')
  })
})

describe('Switch', () => {
  it('is a switch with its state and name', () => {
    const onChange = vi.fn()
    render(<Switch checked={false} label="Loans" onChange={onChange} />)
    const sw = screen.getByRole('switch', { name: 'Loans' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(sw)
    expect(onChange).toHaveBeenCalledWith(true)
  })
  it('does nothing while disabled, but stays focusable (aria-disabled, not the attribute)', () => {
    const onChange = vi.fn()
    render(<Switch checked label="Loans" disabled onChange={onChange} />)
    const sw = screen.getByRole('switch')
    sw.focus()
    fireEvent.click(sw)
    expect(onChange).not.toHaveBeenCalled()
    expect(sw).toHaveAttribute('aria-disabled', 'true')
    expect(sw).not.toBeDisabled()
    expect(sw).toHaveFocus()
  })
})


describe('TitleRow', () => {
  const row = (props: { subtitle?: string } = {}) =>
    renderWithSnapshot(<TitleRow title="Overview" drawerOpen={false} onMenu={() => {}} menuButtonRef={createRef()} {...props} />)

  it('renders the title as the focus target h1 and takes a page focus requested before it mounted', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    requestPageFocus() // no #page-title yet: the request waits for the row
    row()
    const h1 = screen.getByRole('heading', { level: 1, name: 'Overview' })
    expect(h1).toHaveAttribute('id', 'page-title')
    expect(h1).toHaveAttribute('tabindex', '-1')
    expect(h1).toHaveFocus()
    vi.unstubAllGlobals()
  })

  it('omits the subtitle when there is none', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const { container, unmount } = row()
    expect(container.querySelector('.title-row__subtitle')).toBeNull()
    unmount()
    row({ subtitle: 'Data for June' })
    expect(document.querySelector('.title-row__subtitle')).toHaveTextContent('Data for June')
    vi.unstubAllGlobals()
  })
})

describe('PasswordInput', () => {
  it('toggles visibility and takes autoComplete', () => {
    render(<label>Pass<PasswordInput value="abc" onChange={() => {}} invalid={false} autoComplete="new-password" /></label>)
    const input = document.querySelector('input')!
    expect(input).toHaveAttribute('type', 'password')
    expect(input).toHaveAttribute('autocomplete', 'new-password')
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(input).toHaveAttribute('type', 'text')
  })
})

describe('SegmentedBar', () => {
  it('fills whole segments and a partial one for the remainder', () => {
    const { container } = render(<SegmentedBar pct={50.8} label="Cushion" />)
    const widths = [...container.querySelectorAll('.segbar__seg > b')].map(b => (b as HTMLElement).style.width)
    expect(widths.slice(0, 5)).toEqual(Array(5).fill('100%'))
    expect(widths[5]).toBe('8%')
    expect(widths.slice(6)).toEqual(Array(4).fill('0%'))
    expect(screen.getByRole('progressbar', { name: 'Cushion' })).toHaveAttribute('aria-valuenow', '51')
  })

  it('clamps to the ends and takes a tone and a class', () => {
    const { container } = render(<SegmentedBar pct={140} segments={4} tone="member-2" className="hl__track" label="Over" />)
    const bar = screen.getByRole('progressbar', { name: 'Over' })
    expect(bar).toHaveAttribute('aria-valuenow', '100')
    expect(bar).toHaveClass('segbar', 'segbar--member-2', 'hl__track')
    expect([...container.querySelectorAll('.segbar__seg > b')].map(b => (b as HTMLElement).style.width)).toEqual(Array(4).fill('100%'))
  })

  it('draws a non-finite share empty', () => {
    const { container } = render(<SegmentedBar pct={NaN} label="Broken" />)
    expect([...container.querySelectorAll('.segbar__seg > b')].map(b => (b as HTMLElement).style.width)).toEqual(Array(10).fill('0%'))
    expect(screen.getByRole('progressbar', { name: 'Broken' })).toHaveAttribute('aria-valuenow', '0')
  })
})

describe('Ring', () => {
  it('draws N segments, fills by share and writes the percent in the centre', () => {
    const { container } = render(<Ring pct={10.25} label="FIRE" />)
    expect(container.querySelectorAll('.ring__track')).toHaveLength(12)
    expect(container.querySelectorAll('.ring__fill')).toHaveLength(2)
    expect(screen.getByRole('img', { name: 'FIRE: 10.3%' })).toHaveTextContent('10.3%')
  })

  it('does not fill one segment too many for a count-derived share', () => {
    const { container, unmount } = render(<Ring pct={7 / 9 * 100} segments={9} label="Steps" />)
    expect(container.querySelectorAll('.ring__fill')).toHaveLength(7)
    unmount()
    const second = render(<Ring pct={5 / 12 * 100} segments={12} label="Months" />)
    expect(second.container.querySelectorAll('.ring__fill')).toHaveLength(5)
  })

  it('marks given segments amber and shows a custom centre', () => {
    const { container } = render(<Ring pct={100} segments={9} amberAt={[8]} center="8 / 9" label="Stability" />)
    expect(container.querySelectorAll('.ring__fill--amber')).toHaveLength(1)
    expect(screen.getByRole('img', { name: 'Stability: 8 / 9' })).toHaveTextContent('8 / 9')
  })

  it('marks given segments red and sizes the small ring', () => {
    const { container } = render(<Ring pct={50} segments={4} size={44} redAt={[0]} label="Debt" />)
    expect(container.querySelectorAll('.ring__fill--red')).toHaveLength(1)
    expect(container.querySelectorAll('.ring__fill')).toHaveLength(2)
    const svg = screen.getByRole('img', { name: 'Debt: 50%' })
    expect(svg).toHaveAttribute('width', '44')
    expect(svg.querySelector('.ring__track')).toHaveAttribute('stroke-width', '6')
  })

  it('draws a non-finite share empty', () => {
    const { container } = render(<Ring pct={NaN} label="Broken" />)
    expect(container.querySelectorAll('.ring__fill')).toHaveLength(0)
    expect(screen.getByRole('img', { name: 'Broken: 0%' })).toHaveTextContent('0%')
  })
})
