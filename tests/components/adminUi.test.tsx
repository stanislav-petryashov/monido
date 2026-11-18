import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AmountInput } from '../../src/pages/admin/ui/AmountInput'
import { NumberInput } from '../../src/pages/admin/ui/NumberInput'
import { Field } from '../../src/pages/admin/ui/Field'
import { FormDialog } from '../../src/pages/admin/ui/FormDialog'
import { Select } from '../../src/pages/admin/ui/Select'
import { OptionPicker } from '../../src/pages/admin/ui/OptionPicker'
import { isOptionGroup } from '../../src/pages/admin/ui/optionGroup'
import { typeText } from '../helpers/adminScreens'
import { ru, withLanguage } from '../helpers/i18n'
import { fmtCompact, fmtCompactCurrency, fmtDayLong } from '../../src/lib/formatters'
import { DateInput } from '../../src/pages/admin/ui/DateInput'
import { MonthInput } from '../../src/pages/admin/ui/MonthInput'
import { PrivacyContext } from '../../src/lib/privacy'
import { PageAction } from '../../src/pages/admin/ui/PageAction'
import { PageActionSlot } from '../../src/pages/admin/ui/pageActionSlot'
import { RowMenu } from '../../src/pages/admin/ui/RowMenu'
import { TagList } from '../../src/pages/admin/ui/TagList'
import { CurrencyCombobox } from '../../src/pages/admin/ui/CurrencyCombobox'
import { UNREAD_DATE } from '../../src/pages/admin/dateMask'
import { TermInput } from '../../src/pages/admin/ui/TermInput'

describe('RowMenu', () => {
  const setup = () => {
    const edit = vi.fn(); const remove = vi.fn()
    render(<><RowMenu label="May 2031" items={[{ label: 'Edit', onSelect: edit }, { label: 'Delete', onSelect: remove, danger: true }]} /><button>outside</button></>)
    return { edit, remove, trigger: screen.getByRole('button', { name: 'Actions: May 2031' }) }
  }

  it('is closed until asked and says so to assistive tech', () => {
    const { trigger } = setup()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens, runs the chosen action and closes', () => {
    const { trigger, edit } = setup()
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(edit).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('choosing an item leaves focus on the trigger, not on the page body', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(trigger).toHaveFocus()
  })

  it('Escape closes it and returns focus to the trigger', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger).toHaveFocus()
  })

  it('Escape closes it even while focus is still on the trigger', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('moves focus into the menu when it opens', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus()
  })

  it('is drawn outside any scrolling table so it cannot be clipped, and opens upward near the bottom of the window', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    const menu = screen.getByRole('menu')
    expect(menu.parentElement).toBe(document.body)
    expect(menu.style.position).toBe('fixed')
    expect(menu.style.top).not.toBe('')
    fireEvent.keyDown(menu, { key: 'Escape' })
    trigger.getBoundingClientRect = () => box(window.innerHeight - 40, 32)
    menuHeight(80)
    fireEvent.click(trigger)
    expect(screen.getByRole('menu').style.bottom).not.toBe('')
    expect(screen.getByRole('menu').style.top).toBe('')
  })

  // the menu is as tall as its items: four items that do not fit under the button open upward, two that fit stay below
  const box = (top: number, height: number) => ({ top, bottom: top + height, left: 0, right: 100, width: 100, height, x: 0, y: 0, toJSON() {} })
  const menuHeight = (height: number) => vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return box(0, this.getAttribute('role') === 'menu' ? height : 0)
  })
  it.each([[80, 'top'], [176, 'bottom']] as const)('measures a menu %ipx tall 150px above the window’s foot: it opens by its %s', (height, side) => {
    const { trigger } = setup()
    trigger.getBoundingClientRect = () => box(window.innerHeight - 182, 32)
    menuHeight(height)
    fireEvent.click(trigger)
    const style = screen.getByRole('menu').style
    expect(style[side]).not.toBe('')
    expect(style[side === 'top' ? 'bottom' : 'top']).toBe('')
  })

  it('closes when the page scrolls under it', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    fireEvent.scroll(window)
    expect(screen.queryByRole('menu')).toBeNull()
    // focus was in the menu — it must not vanish along with it
    expect(trigger).toHaveFocus()
  })

  it('arrow keys move between items and wrap around; Home and End jump', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    const [edit, remove] = screen.getAllByRole('menuitem')
    fireEvent.keyDown(edit, { key: 'ArrowDown' })
    expect(remove).toHaveFocus()
    fireEvent.keyDown(remove, { key: 'ArrowDown' })
    expect(edit).toHaveFocus()
    fireEvent.keyDown(edit, { key: 'ArrowUp' })
    expect(remove).toHaveFocus()
    fireEvent.keyDown(remove, { key: 'Home' })
    expect(edit).toHaveFocus()
    fireEvent.keyDown(edit, { key: 'End' })
    expect(remove).toHaveFocus()
  })

  it.each([['Tab', false], ['Tab', true]])('%s (shift: %s) closes the menu and leaves focus on the trigger instead of losing it', (key, shiftKey) => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0], { key, shiftKey })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('is placed from the width of the page, not of the window with its scrollbar', () => {
    const { trigger } = setup()
    Object.defineProperty(document.documentElement, 'clientWidth', { value: 1000, configurable: true })
    trigger.getBoundingClientRect = () => ({ top: 10, bottom: 42, left: 868, right: 900, width: 32, height: 32, x: 0, y: 0, toJSON() {} })
    fireEvent.click(trigger)
    expect(screen.getByRole('menu').style.right).toBe('100px')
    Reflect.deleteProperty(document.documentElement, 'clientWidth')
  })

  it('a click outside closes it without running anything', () => {
    const { trigger, edit, remove } = setup()
    fireEvent.click(trigger)
    fireEvent.mouseDown(screen.getByRole('button', { name: 'outside' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(edit).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it('opening one menu closes another', () => {
    render(<><RowMenu label="A" items={[{ label: 'Edit', onSelect() {} }]} /><RowMenu label="B" items={[{ label: 'Edit', onSelect() {} }]} /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Actions: A' }))
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Actions: B' }))
    fireEvent.click(screen.getByRole('button', { name: 'Actions: B' }))
    expect(screen.getAllByRole('menu')).toHaveLength(1)
  })

  it('marks the destructive item', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveClass('row-menu__item--danger')
  })
})

describe('TagList', () => {
  function Harness({ onAdd, onRemove }: { onAdd: () => void; onRemove: (k: string | number) => void }) {
    const [value, setValue] = useState('')
    return <TagList label="Currencies" tags={[{ key: 1, text: 'EUR' }, { key: 2, text: 'RUB' }]} onRemove={onRemove} value={value} onChange={setValue} onAdd={onAdd} placeholder="Code" />
  }

  it('removes a tag by a button named after it', () => {
    const onRemove = vi.fn()
    render(<Harness onAdd={() => {}} onRemove={onRemove} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove: RUB' }))
    expect(onRemove).toHaveBeenCalledWith(2)
  })

  it('adds on the button and on Enter', () => {
    const onAdd = vi.fn()
    render(<Harness onAdd={onAdd} onRemove={() => {}} />)
    const input = screen.getByRole('textbox', { name: 'Currencies: add' })
    fireEvent.change(input, { target: { value: 'USD' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }))
    expect(onAdd).toHaveBeenCalledTimes(2)
  })
})

describe('CurrencyCombobox', () => {
  /** A word of a currency's Russian name, taken from Intl so this file holds no Cyrillic. */
  const ruName = (code: string) => new Intl.DisplayNames(['ru-RU'], { type: 'currency' }).of(code)!

  const setup = (exclude: readonly string[] = []) => {
    const onPick = vi.fn()
    render(<CurrencyCombobox label="Currencies" exclude={exclude} onPick={onPick} />)
    return { onPick, input: screen.getByRole('combobox', { name: 'Currencies: add' }) }
  }

  it('is a combobox tied to its list, closed until something is typed', () => {
    const { input } = setup()
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(input).toHaveAccessibleDescription('Code or name: dollar, lari, KZT')
    fireEvent.change(input, { target: { value: 'KZ' } })
    expect(input).toHaveAttribute('aria-expanded', 'true')
    const list = screen.getByRole('listbox')
    expect(input).toHaveAttribute('aria-controls', list.id)
    const option = within(list).getByRole('option', { name: /KZT/ })
    expect(option.querySelector('.currency-combo__code')).toHaveTextContent('KZT')
    expect(option).toHaveTextContent('Kazakhstani Tenge')
  })

  it('finds a currency by its Russian name: ArrowDown, Enter picks it', async () => {
    await withLanguage('ru-RU', () => {
      const onPick = vi.fn()
      render(<CurrencyCombobox label="Currencies" exclude={[]} onPick={onPick} />)
      const input = screen.getByRole('combobox')
      fireEvent.change(input, { target: { value: ruName('TRY').split(' ').at(-1)!.slice(0, 3) } })
      fireEvent.keyDown(input, { key: 'ArrowDown' })
      const active = input.getAttribute('aria-activedescendant')
      expect(active).toBeTruthy()
      expect(document.getElementById(active!)).toHaveAttribute('aria-selected', 'true')
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(onPick).toHaveBeenCalledWith('TRY')
      expect(input).toHaveValue('')
    })
  })

  it('a click on an option picks it', () => {
    const { input, onPick } = setup()
    fireEvent.change(input, { target: { value: 'KZ' } })
    fireEvent.click(screen.getByRole('option', { name: /KZT/ }))
    expect(onPick).toHaveBeenCalledWith('KZT')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('Enter adds a typed three-letter code, uppercased', () => {
    const { input, onPick } = setup()
    fireEvent.change(input, { target: { value: 'XAG' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith('XAG')
    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenLastCalledWith('ABC')
  })

  it('keeps the typed text when the add fails, clears it when it succeeds', async () => {
    let ok = false
    const onPick = vi.fn(async () => ok)
    render(<CurrencyCombobox label="Currencies" exclude={[]} onPick={onPick} />)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'xag' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await act(async () => {})
    expect(onPick).toHaveBeenCalledWith('XAG')
    expect(input).toHaveValue('xag')
    ok = true
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(input).toHaveValue(''))
  })

  it('ArrowUp wraps to the last option, Escape closes the list', () => {
    const { input } = setup()
    fireEvent.change(input, { target: { value: 'us' } })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    const options = screen.getAllByRole('option')
    expect(input).toHaveAttribute('aria-activedescendant', options.at(-1)!.id)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(input).not.toHaveAttribute('aria-activedescendant')
  })

  it('leaves out the family currencies', () => {
    const { input } = setup(['USD'])
    fireEvent.change(input, { target: { value: 'usd' } })
    expect(screen.queryByRole('option', { name: /USD/ })).toBeNull()
  })

  it('an unknown text that is not a code: Enter does nothing, the error shows after leaving', () => {
    const { input, onPick } = setup()
    fireEvent.change(input, { target: { value: 'US1' } })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByText('Nothing found: type a 3-letter code')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.blur(input)
    expect(screen.getByRole('alert')).toHaveTextContent('A code is three Latin letters, for example RUB')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    // the no-match hint stays with the marked field, after leaving it and after Escape
    expect(input).toHaveAccessibleDescription(/Nothing found: type a 3-letter code/)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.getByText('Nothing found: type a 3-letter code')).toBeInTheDocument()
  })

  it('three letters of a name are not a code: "yen" finds JPY, Enter marks it, a second Enter picks it', () => {
    const { input, onPick } = setup()
    fireEvent.change(input, { target: { value: 'yen' } })
    expect(screen.getByRole('button', { name: '+ Add' })).toBeDisabled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).not.toHaveBeenCalled()
    expect(document.getElementById(input.getAttribute('aria-activedescendant')!)).toHaveTextContent('JPY')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith('JPY')
    expect(onPick).not.toHaveBeenCalledWith('YEN')
  })

  it('a family currency typed as a code cannot be added again', () => {
    const { input, onPick } = setup(['XAG'])
    fireEvent.change(input, { target: { value: 'xag' } })
    expect(screen.getByRole('button', { name: '+ Add' })).toBeDisabled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).not.toHaveBeenCalled()
  })

  it('one add at a time: a second Enter or "+ Add" while the first is written does nothing', async () => {
    let release!: (ok: boolean) => void
    const onPick = vi.fn(() => new Promise<boolean>(r => { release = r }))
    render(<CurrencyCombobox label="Currencies" exclude={[]} onPick={onPick} />)
    const input = screen.getByRole('combobox')
    const add = screen.getByRole('button', { name: '+ Add' })
    fireEvent.change(input, { target: { value: 'xag' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(add).toBeDisabled()
    fireEvent.click(add)
    expect(onPick).toHaveBeenCalledTimes(1)
    await act(async () => release(false))
    expect(add).toBeEnabled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledTimes(2)
  })

  it('"+ Add" adds a typed code and is off for a name', () => {
    const { input, onPick } = setup()
    const add = screen.getByRole('button', { name: '+ Add' })
    expect(add).toBeDisabled()
    fireEvent.change(input, { target: { value: 'dollar' } })
    expect(add).toBeDisabled()
    fireEvent.change(input, { target: { value: 'xau' } })
    fireEvent.click(add)
    expect(onPick).toHaveBeenCalledWith('XAU')
  })
})

describe('TagList adder', () => {
  it('renders the given adder in place of its own field and button', () => {
    render(<TagList label="Currencies" tags={[{ key: 1, text: 'EUR' }]} onRemove={() => {}} adder={<input aria-label="custom adder" />} />)
    expect(screen.getByRole('textbox', { name: 'custom adder' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Currencies: add' })).toBeNull()
    expect(screen.queryByRole('button', { name: '+ Add' })).toBeNull()
  })
})

describe('Field', () => {
  it('names the control by the label above it', () => {
    render(<Field label="Name"><input /></Field>)
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeInTheDocument()
  })
})

describe('Field extras', () => {
  it('a unit is shown in the field and named to screen readers', () => {
    const { container } = render(<Field label="Rate" unit="%"><input /></Field>)
    expect(screen.getByLabelText('Rate (%)')).toBeInTheDocument()
    expect(container.querySelector('.input-unit')).toHaveTextContent('%')
  })

  it("Select forwards the field's name and description", () => {
    render(<Field label="Member" hint="Who owns it"><Select defaultValue="a"><option value="a">A</option></Select></Field>)
    const select = screen.getByRole('combobox', { name: 'Member' })
    expect(select).toHaveClass('admin-select')
    expect(select).toHaveAccessibleDescription('Who owns it')
  })
})

describe('OptionPicker', () => {
  const three = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }, { value: 'c', label: 'Gamma' }]

  it('three options are radios in a radiogroup named by the Field caption; a click reports the value', () => {
    const onChange = vi.fn()
    render(<Field label="Kind" hint="Pick one" group><OptionPicker options={three} value="a" onChange={onChange} /></Field>)
    const group = screen.getByRole('radiogroup', { name: 'Kind' })
    expect(group).toHaveAccessibleDescription('Pick one')
    expect(within(group).getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByRole('radio', { name: 'Alpha' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'Beta' }))
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('the caption is not a label: clicking it does not choose the first option', () => {
    const onChange = vi.fn()
    render(<Field label="Kind" group><OptionPicker options={three} value="b" onChange={onChange} /></Field>)
    fireEvent.click(screen.getByText('Kind'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('more than four options render a dropdown', () => {
    const five = [...three, { value: 'd', label: 'Delta' }, { value: 'e', label: 'Epsilon' }]
    render(<Field label="Kind" group><OptionPicker options={five} value="a" onChange={() => {}} /></Field>)
    expect(screen.getByRole('combobox', { name: 'Kind' })).toHaveValue('a')
    expect(screen.queryByRole('radio')).toBeNull()
  })

  it('with five options the Field is a real label for the dropdown, so the caption focuses it', () => {
    const five = [...three, { value: 'd', label: 'Delta' }, { value: 'e', label: 'Epsilon' }]
    render(<Field label="Kind" group={isOptionGroup(five.length)}><OptionPicker options={five} value="a" onChange={() => {}} /></Field>)
    expect(screen.getByText('Kind').closest('label')).not.toBeNull()
    expect(isOptionGroup(three.length)).toBe(true)
    expect(isOptionGroup(five.length)).toBe(false)
  })

  it('disabled disables every radio', () => {
    render(<Field label="Kind" group><OptionPicker options={three} value="a" onChange={() => {}} disabled /></Field>)
    for (const r of screen.getAllByRole('radio')) expect(r).toBeDisabled()
  })
})

describe('AmountInput', () => {
  const NBSP = '\u00a0'
  const Harness = ({ initial = '', unit, signed, describedBy, onChange }: { initial?: string; unit?: string; signed?: boolean; describedBy?: string; onChange?: (v: string) => void }) => {
    const [v, setV] = useState(initial)
    return <><AmountInput label="Sum" unit={unit} signed={signed} describedBy={describedBy} value={v} onChange={text => { onChange?.(text); setV(text) }} /><output data-testid="raw">{v}</output></>
  }
  const raw = () => screen.getByTestId('raw').textContent

  it('groups thousands while typing, not only at rest', async () => {
    await withLanguage('ru-RU', () => {
      render(<Harness />)
      const input = screen.getByLabelText('Sum')
      typeText(input, '1250000', { append: true })
      expect(input).toHaveValue(`1${NBSP}250${NBSP}000`)
      expect(raw()).toBe('1250000')
    })
  })

  it('a typed comma is the decimal separator', async () => {
    await withLanguage('ru-RU', () => {
      render(<Harness />)
      const input = screen.getByLabelText('Sum')
      typeText(input, '12,5', { append: true })
      expect(raw()).toBe('12.5')
      expect(input).toHaveValue('12,5')
    })
  })

  it('in en-US the comma of the grouping is not read as a decimal', () => {
    render(<Harness initial="1250" />)
    const input = screen.getByLabelText('Sum')
    expect(input).toHaveValue('1,250')
    typeText(input, '0', { append: true })
    expect(input).toHaveValue('12,500')
    expect(raw()).toBe('12500')
    typeText(input, '.5', { append: true })
    expect(raw()).toBe('12500.5')
    expect(input).toHaveValue('12,500.5')
  })

  it('while typing a third decimal is dropped, not read as a thousands separator', () => {
    render(<Harness />)
    const input = screen.getByLabelText('Sum')
    typeText(input, '1.000', { append: true })
    expect(input).toHaveValue('1.00')
    expect(raw()).toBe('1.00')
    fireEvent.change(input, { target: { value: '' } })
    typeText(input, '12.500', { append: true })
    expect(raw()).toBe('12.50')
    expect(input).toHaveValue('12.50')
  })

  // the locale's own group symbol typed before a third digit is the grouping: the field shows it so, and a third decimal
  // does not exist (two at most), so "12,500" in en-US is twelve thousand five hundred, never 12.50
  it.each([
    ['en-US', '12,500', '12500', '12,500'],
    ['en-US', '1,250,000', '1250000', '1,250,000'],
    ['en-US', '12,50', '12.50', '12.50'],
    ['en-US', '12,5', '12.5', '12.5'],
    ['en-US', '0,125', '0.12', '0.12'],
    ['en-US', '-1,250', '-1250', '−1,250'],
    ['zh-CN', '12,500', '12500', '12,500'],
    ['de-DE', '12.500', '12500', '12.500'],
    ['de-DE', '1.250.000,5', '1250000.5', '1.250.000,5'],
    ['de-DE', '12,500', '12.50', '12,50'],
    ['ru-RU', '12,500', '12.50', '12,50'],
    ['ru-RU', '12.500', '12.50', '12,50'],
  ] as const)('in %s typed "%s" is %s', async (lang, typed, canonical, shown) => {
    await withLanguage(lang, () => {
      render(<Harness signed />)
      const input = screen.getByLabelText('Sum')
      typeText(input, typed, { append: true })
      expect(raw()).toBe(canonical)
      expect(input).toHaveValue(shown)
    })
  })

  it('in en-US a comma typed into the middle of a grouped number changes nothing', () => {
    render(<Harness initial="12500" />)
    const input = screen.getByLabelText('Sum')
    expect(input).toHaveValue('12,500')
    fireEvent.input(input, { target: { value: '1,2,500', selectionStart: 2, selectionEnd: 2 }, inputType: 'insertText' })
    expect(raw()).toBe('12500')
    expect(input).toHaveValue('12,500')
  })

  it('a decimal opened by the group symbol stays one once the field is set from outside', () => {
    render(<Harness />)
    const input = screen.getByLabelText('Sum')
    typeText(input, '12,5', { append: true })
    expect(raw()).toBe('12.5')
    // a fresh value typed from scratch with the real decimal: its third digit is dropped as before
    typeText(input, '7.25')
    typeText(input, '0', { append: true })
    expect(raw()).toBe('7.25')
  })

  it('a paste still reads "12,345" as a thousand', () => {
    render(<Harness />)
    fireEvent.input(screen.getByLabelText('Sum'), { target: { value: '12,345' }, inputType: 'insertFromPaste' })
    expect(raw()).toBe('12345')
  })

  it.each([['insertFromDrop'], ['insertFromYank'], ['insertReplacementText'], ['insertText']])('reads text brought in by %s as a paste', inputType => {
    render(<Harness />)
    // insertText with several characters at once: a phone's clipboard chip
    fireEvent.input(screen.getByLabelText('Sum'), { target: { value: '12,345' }, inputType })
    expect(raw()).toBe('12345')
  })

  it('one typed character is typed, not pasted', () => {
    render(<Harness initial="12" />)
    fireEvent.input(screen.getByLabelText('Sum'), { target: { value: '12,' }, inputType: 'insertText' })
    expect(raw()).toBe('12.')
  })

  it('Backspace right after a group separator removes the digit before it; Delete right before one, the digit after it', async () => {
    await withLanguage('ru-RU', () => {
      render(<Harness initial="12345678" />)
      const input = screen.getByLabelText('Sum') as HTMLInputElement
      input.focus()
      expect(input).toHaveValue(`12${NBSP}345${NBSP}678`)
      // the caret after the second space, Backspace: the space goes, so the 5 before it does
      fireEvent.input(input, { target: { value: `12${NBSP}345678`, selectionStart: 6, selectionEnd: 6 }, inputType: 'deleteContentBackward' })
      expect(raw()).toBe('1234678')
      expect(input).toHaveValue(`1${NBSP}234${NBSP}678`)
      expect(input.selectionStart).toBe(5)
      // the caret before the first space, Delete: the 2 after it goes
      fireEvent.input(input, { target: { value: `1234${NBSP}678`, selectionStart: 1, selectionEnd: 1 }, inputType: 'deleteContentForward' })
      expect(raw()).toBe('134678')
      expect(input).toHaveValue(`134${NBSP}678`)
      expect(input.selectionStart).toBe(1)
    })
  })

  it('Backspace on a prefilled four-decimal amount cuts it to two decimals, not to a thousand', () => {
    render(<Harness initial="5.1250" />)
    const input = screen.getByLabelText('Sum')
    expect(input).toHaveValue('5.1250')
    fireEvent.change(input, { target: { value: '5.125' } })
    expect(raw()).toBe('5.12')
    expect(input).toHaveValue('5.12')
  })

  it('a caller\'s description stays beside the automatic compact hint', () => {
    render(<><p id="shared-note">Shared note</p><Harness initial="12500" describedBy="shared-note" /></>)
    const input = screen.getByLabelText('Sum')
    const ids = input.getAttribute('aria-describedby')?.split(' ') ?? []
    expect(ids).toHaveLength(2)
    expect(ids).toContain('shared-note')
    expect(input).toHaveAccessibleDescription(`${fmtCompact(12500)} Shared note`)
  })

  it('a paste reads the grouping and the currency sign of a bank statement', async () => {
    await withLanguage('ru-RU', () => {
      render(<Harness />)
      fireEvent.input(screen.getByLabelText('Sum'), { target: { value: '1.250.000,50 ₽' }, inputType: 'insertFromPaste' })
      expect(raw()).toBe('1250000.5')
    })
  })

  it('a prefilled value is shown grouped as it is and is not re-masked on mount', async () => {
    await withLanguage('ru-RU', () => {
      const onChange = vi.fn()
      render(<Harness initial="1234.1250" onChange={onChange} />)
      expect(screen.getByLabelText('Sum')).toHaveValue(`1${NBSP}234,1250`)
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  it('the caret stays after the typed digit when the grouping moves it', () => {
    render(<Harness initial="999999" />)
    const input = screen.getByLabelText('Sum') as HTMLInputElement
    input.focus()
    // "999,999" with "1" typed after the first "9": "9,199,999" — a comma appears before the caret, which stays after the "1"
    fireEvent.change(input, { target: { value: '9199,999', selectionStart: 2, selectionEnd: 2 } })
    expect(input).toHaveValue('9,199,999')
    expect(raw()).toBe('9199999')
    expect(input.selectionStart).toBe(3)
  })

  it('a large amount gets a compact hint in its currency, hidden in privacy mode', async () => {
    await withLanguage('ru-RU', () => {
      const expected = fmtCompactCurrency(12500000, 'RUB')
      expect(expected).toMatch(/^12,5\s\S+\s₽$/)
      const { unmount } = render(<Harness initial="12500000" unit="RUB" />)
      expect(screen.getByLabelText('Sum (RUB)')).toHaveAccessibleDescription(expected)
      unmount()
      render(<PrivacyContext.Provider value={{ hidden: true, toggle: () => {} }}><Harness initial="12500000" unit="RUB" /></PrivacyContext.Provider>)
      expect(screen.getByLabelText('Sum (RUB)')).not.toHaveAccessibleDescription()
      expect(screen.queryByText(expected)).toBeNull()
    })
  })

  it('without a unit the hint is a compact number; a small amount has none', () => {
    render(<Harness initial="12500000" />)
    expect(screen.getByLabelText('Sum')).toHaveAccessibleDescription(fmtCompact(12500000))
    expect(fmtCompact(12500000)).toBe('12.5M')
    fireEvent.change(screen.getByLabelText('Sum'), { target: { value: '9,999' } })
    expect(screen.getByLabelText('Sum')).not.toHaveAccessibleDescription()
  })

  it('on a touchscreen a signed amount has a ± button that flips the sign', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)', addEventListener: () => {}, removeEventListener: () => {} }))
    render(<Harness initial="18450" signed />)
    const input = screen.getByLabelText('Sum')
    expect(input).toHaveAttribute('inputmode', 'decimal')
    fireEvent.click(screen.getByRole('button', { name: 'Change the sign' }))
    expect(raw()).toBe('-18450')
    expect(input).toHaveValue('−18,450')
    fireEvent.click(screen.getByRole('button', { name: 'Change the sign' }))
    expect(raw()).toBe('18450')
  })

  it('with a mouse a signed amount has no ± button and a keyboard with a minus', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
    render(<Harness initial="18450" signed />)
    expect(screen.queryByRole('button', { name: 'Change the sign' })).toBeNull()
    expect(screen.getByLabelText('Sum')).not.toHaveAttribute('inputmode')
    fireEvent.change(screen.getByLabelText('Sum'), { target: { value: '-18,450' } })
    expect(raw()).toBe('-18450')
  })

  it('an unsigned amount drops a typed minus', () => {
    render(<Harness initial="18450" />)
    fireEvent.change(screen.getByLabelText('Sum'), { target: { value: '-18,450' } })
    expect(raw()).toBe('18450')
    expect(screen.getByLabelText('Sum')).toHaveAttribute('inputmode', 'decimal')
  })
})

describe('NumberInput', () => {
  it('inside a Field with a hint, an amount and a number keep the hint beside their own description', () => {
    render(<>
      <Field label="Sum" hint="From the statement"><AmountInput label="Sum" value="25000" onChange={() => {}} /></Field>
      <Field label="Rate" hint="From the contract"><NumberInput label="Rate" value="7" onChange={() => {}} decimals={3} hint="Yearly" /></Field>
    </>)
    expect(screen.getByRole('textbox', { name: 'Sum' })).toHaveAccessibleDescription(`${fmtCompact(25000)} From the statement`)
    expect(screen.getByRole('textbox', { name: 'Rate' })).toHaveAccessibleDescription('Yearly From the contract')
  })

  it('keeps its decimals, reads no thousands without guessThousands and draws a prefix before the number', () => {
    const Harness = () => {
      const [v, setV] = useState('')
      return <><NumberInput label="Rate" prefix="1 USD =" decimals={4} value={v} onChange={setV} /><output data-testid="raw">{v}</output></>
    }
    const { container } = render(<Harness />)
    const input = screen.getByLabelText('Rate')
    fireEvent.change(input, { target: { value: '6.125' } })
    expect(screen.getByTestId('raw')).toHaveTextContent('6.125')
    typeText(input, '89', { append: true })
    expect(screen.getByTestId('raw')).toHaveTextContent('6.1258')
    expect(container.querySelector('.input-unit__prefix')).toHaveTextContent('1 USD =')
    expect(container.querySelector('.input-unit__prefix')).toHaveAttribute('aria-hidden', 'true')
  })

  it('measures the prefix again when its size changes (the web font arrives after the first paint)', () => {
    let width = 40
    const span = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => width })
    let resized = () => {}
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { resized = cb } observe() {} disconnect() {} })
    try {
      const { container } = render(<NumberInput label="Rate" prefix="1 USD =" decimals={4} value="" onChange={() => {}} />)
      const wrapper = container.querySelector('.input-unit') as HTMLElement
      expect(wrapper.style.getPropertyValue('--input-prefix-w')).toBe('40px')
      width = 56
      act(() => resized())
      expect(wrapper.style.getPropertyValue('--input-prefix-w')).toBe('56px')
    } finally {
      if (span) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', span)
    }
  })
})

describe('TermInput', () => {
  function Harness({ initial, onChange }: { initial: string; onChange: (months: string) => void }) {
    const [value, setValue] = useState(initial)
    return (
      <Field label="Term" group>
        <TermInput label="Term" value={value} onChange={m => { setValue(m); onChange(m) }} />
      </Field>
    )
  }
  const input = () => screen.getByRole('textbox', { name: 'Term' })

  it('opens in years for whole years or no term, in months otherwise', () => {
    const { unmount } = render(<Harness initial="" onChange={() => {}} />)
    expect(screen.getByRole('radio', { name: 'Years' })).toBeChecked()
    unmount()
    render(<Harness initial="15" onChange={() => {}} />)
    expect(screen.getByRole('radio', { name: 'Months' })).toBeChecked()
    expect(input()).toHaveValue('15')
    expect(screen.getByText('1 year 3 mo')).toBeInTheDocument()
  })

  it('shows years with two decimals, which give the same months back', () => {
    const onChange = vi.fn()
    render(<Harness initial="15" onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Years' }))
    expect(input()).toHaveValue('1.25')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a 13-month term switched to years stays 13 untouched and when the shown years are typed again', () => {
    const onChange = vi.fn()
    render(<Harness initial="13" onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Years' }))
    expect(input()).toHaveValue('1.08')
    expect(screen.getByText('13 mo')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(input(), { target: { value: '1.1' } })
    fireEvent.change(input(), { target: { value: '1.08' } })
    expect(onChange).toHaveBeenLastCalledWith('13')
    expect(input()).toHaveValue('1.08')
  })

  it('is a group named by the Field caption, the switch inside it', () => {
    render(<Harness initial="240" onChange={() => {}} />)
    const group = screen.getByRole('group', { name: 'Term' })
    expect(within(group).getByRole('radiogroup', { name: 'Years or months' })).toBeInTheDocument()
    expect(within(group).getByRole('textbox', { name: 'Term' })).toBeInTheDocument()
  })
})

describe('DateInput', () => {
  const Harness = ({ initial = '', onChange }: { initial?: string; onChange?: (v: string) => void }) => {
    const [v, setV] = useState(initial)
    return <><DateInput label="Date" value={v} onChange={iso => { onChange?.(iso); setV(iso) }} /><output data-testid="raw">{v}</output></>
  }
  const raw = () => screen.getByTestId('raw').textContent
  afterEach(() => { delete (HTMLInputElement.prototype as { showPicker?: unknown }).showPicker })

  it('masks typed digits in the language\'s order and says the long date with its weekday', async () => {
    await withLanguage('ru-RU', () => {
      render(<Harness />)
      const input = screen.getByRole('textbox', { name: 'Date' })
      expect(input).toHaveAccessibleDescription(ru('data.common.datePattern', { pattern: ['d', 'm', 'y'].map(p => ru(`data.common.datePart.${p}`)).join('.') }))
      typeText(input, '15032014', { append: true })
      expect(input).toHaveValue('15.03.2014')
      expect(raw()).toBe('2014-03-15')
      expect(input).toHaveAccessibleDescription(fmtDayLong('2014-03-15'))
      expect(fmtDayLong('2014-03-15')).toMatch(/2014/)
    })
  })

  it('a day the month lacks gives no date, and once the field is left it says so', async () => {
    await withLanguage('ru-RU', () => {
      const onChange = vi.fn()
      render(<Harness onChange={onChange} />)
      const input = screen.getByRole('textbox', { name: 'Date' })
      typeText(input, '30022014', { append: true })
      expect(input).toHaveValue('30.02.2014')
      expect(raw()).toBe(UNREAD_DATE)
      expect(onChange).not.toHaveBeenCalledWith(expect.stringMatching(/\d/))
      expect(screen.queryByRole('alert')).toBeNull()
      fireEvent.blur(input)
      expect(screen.getByRole('alert')).toHaveTextContent(ru('data.common.noSuchDate'))
      expect(input).toHaveAttribute('aria-invalid', 'true')
    })
  })

  it('a date left unfinished gives no date, and once the field is left it says how to finish it', async () => {
    await withLanguage('ru-RU', () => {
      render(<Harness initial="2014-03-15" />)
      const input = screen.getByRole('textbox', { name: 'Date' })
      fireEvent.change(input, { target: { value: '' } })
      expect(raw()).toBe('')
      typeText(input, '15.03', { append: true })
      // not '': an empty date would erase the stored one; a form holding this is not saved
      expect(raw()).toBe(UNREAD_DATE)
      expect(screen.queryByRole('alert')).toBeNull()
      fireEvent.blur(input)
      const pattern = ['d', 'm', 'y'].map(p => ru(`data.common.datePart.${p}`)).join('.')
      expect(screen.getByRole('alert')).toHaveTextContent(ru('data.common.dateIncomplete', { pattern }))
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(raw()).toBe(UNREAD_DATE)
    })
  })

  it('after the first leaving, typing again hides "finish the date" until the field is left again', async () => {
    await withLanguage('ru-RU', () => {
      render(<Harness />)
      const input = screen.getByRole('textbox', { name: 'Date' })
      typeText(input, '15', { append: true })
      fireEvent.blur(input)
      expect(screen.getByRole('alert')).toBeInTheDocument()
      fireEvent.focus(input)
      typeText(input, '03', { append: true })
      expect(screen.queryByRole('alert')).toBeNull()
      fireEvent.blur(input)
      expect(screen.getByRole('alert')).toHaveTextContent(ru('data.common.dateIncomplete', { pattern: ['d', 'm', 'y'].map(p => ru(`data.common.datePart.${p}`)).join('.') }))
    })
  })

  it('Enter on an unfinished date is not a submit: the field says how to finish it', async () => {
    await withLanguage('ru-RU', () => {
      render(<Harness />)
      const input = screen.getByRole('textbox', { name: 'Date' })
      typeText(input, '15.03', { append: true })
      expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false)
      expect(screen.getByRole('alert')).toHaveTextContent(ru('data.common.dateIncomplete', { pattern: ['d', 'm', 'y'].map(p => ru(`data.common.datePart.${p}`)).join('.') }))
      fireEvent.change(input, { target: { value: '15.03.2014' } })
      expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true)
    })
  })

  it('Backspace right after a separator removes the digit before it; Delete right before one, the digit after it', async () => {
    await withLanguage('ru-RU', () => {
      render(<Harness initial="2014-12-15" />)
      const input = screen.getByRole('textbox', { name: 'Date' }) as HTMLInputElement
      expect(input).toHaveValue('15.12.2014')
      // the caret after the second dot, Backspace: the mask would put the dot back, so the 2 before it goes
      fireEvent.input(input, { target: { value: '15.122014', selectionStart: 5, selectionEnd: 5 }, inputType: 'deleteContentBackward' })
      expect(input).toHaveValue('15.12.014')
      expect(raw()).toBe(UNREAD_DATE)
      fireEvent.change(input, { target: { value: '2014-12-15' } })
      // the caret before the first dot, Delete: the 1 after it goes
      fireEvent.input(input, { target: { value: '1512.2014', selectionStart: 2, selectionEnd: 2 }, inputType: 'deleteContentForward' })
      expect(input).toHaveValue('15.02.2014')
      expect(raw()).toBe('2014-02-15')
    })
  })

  it('Backspace on a separator the mask added at the end removes only it', async () => {
    await withLanguage('ru-RU', () => {
      render(<Harness />)
      const input = screen.getByRole('textbox', { name: 'Date' })
      typeText(input, '1503', { append: true })
      expect(input).toHaveValue('15.03.')
      fireEvent.input(input, { target: { value: '15.03' }, inputType: 'deleteContentBackward' })
      expect(input).toHaveValue('15.03')
    })
  })

  it('an empty date left alone says nothing', () => {
    render(<Harness />)
    const input = screen.getByRole('textbox', { name: 'Date' })
    fireEvent.blur(input)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(input).not.toHaveAttribute('aria-invalid')
  })

  it('pads a one-digit day and month and completes a two-digit year on leaving', async () => {
    await withLanguage('ru-RU', () => {
      render(<Harness />)
      const input = screen.getByRole('textbox', { name: 'Date' })
      typeText(input, '5.3.14', { append: true })
      expect(input).toHaveValue('05.03.14')
      // the two-digit year is read at once: Enter right after it saves 5 March 2014
      expect(raw()).toBe('2014-03-05')
      expect(input).toHaveAccessibleDescription(fmtDayLong('2014-03-05'))
      fireEvent.blur(input)
      expect(input).toHaveValue('05.03.2014')
      expect(raw()).toBe('2014-03-05')
    })
  })

  it('shows a stored date in the language\'s order without emitting', async () => {
    await withLanguage('ru-RU', () => {
      const onChange = vi.fn()
      render(<Harness initial="2026-10-01" onChange={onChange} />)
      expect(screen.getByRole('textbox', { name: 'Date' })).toHaveValue('01.10.2026')
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  it('in en-US the pattern is month first, and a pasted ISO date reads', () => {
    render(<Harness />)
    const input = screen.getByRole('textbox', { name: 'Date' })
    expect(input).toHaveAccessibleDescription('Digits only: MM/DD/YYYY')
    fireEvent.change(input, { target: { value: '2029-10-15' } })
    expect(input).toHaveValue('10/15/2029')
    expect(raw()).toBe('2029-10-15')
  })

  it('has no calendar button where the browser cannot open its picker', () => {
    render(<Harness />)
    expect(screen.queryByRole('button', { name: 'Open the calendar' })).toBeNull()
  })

  it('the calendar button opens the native picker, and a picked day fills the field', () => {
    const showPicker = vi.fn()
    Object.defineProperty(HTMLInputElement.prototype, 'showPicker', { configurable: true, writable: true, value: showPicker })
    const { container } = render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open the calendar' }))
    expect(showPicker).toHaveBeenCalledTimes(1)
    const picker = container.querySelector('input[type="date"]') as HTMLInputElement
    expect(picker).toHaveAttribute('aria-hidden', 'true')
    fireEvent.change(picker, { target: { value: '2031-02-10' } })
    expect(screen.getByRole('textbox', { name: 'Date' })).toHaveValue('02/10/2031')
    expect(raw()).toBe('2031-02-10')
  })

  it('a picker that throws takes its button away', () => {
    Object.defineProperty(HTMLInputElement.prototype, 'showPicker', { configurable: true, writable: true, value: () => { throw new Error('NotAllowedError') } })
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open the calendar' }))
    expect(screen.queryByRole('button', { name: 'Open the calendar' })).toBeNull()
  })

  it('inside a Field it is named by the caption and keeps the Field\'s hint', () => {
    render(<Field label="Issue date" hint="From the contract"><DateInput label="Issue date" value="" onChange={() => {}} /></Field>)
    const input = screen.getByRole('textbox', { name: 'Issue date' })
    expect(input).toHaveAccessibleDescription(/Digits only: MM\/DD\/YYYY.*From the contract|From the contract.*Digits only/)
  })
})

describe('MonthInput', () => {
  const Harness = ({ initial = '', chips, finished }: { initial?: string; chips?: number[]; finished?: boolean }) => {
    const [v, setV] = useState(initial)
    return <><MonthInput label="Target date" value={v} onChange={setV} chips={chips} finished={finished} /><output data-testid="raw">{v}</output></>
  }
  const raw = () => screen.getByTestId('raw').textContent
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-23T12:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  it('shows a stored date as its month and keeps the stored day while the month is the same', async () => {
    await withLanguage('ru-RU', () => {
      render(<Harness initial="2030-12-15" />)
      const input = screen.getByRole('textbox', { name: 'Target date' })
      expect(input).toHaveValue('12.2030')
      fireEvent.change(input, { target: { value: '' } })
      typeText(input, '122030', { append: true })
      expect(input).toHaveValue('12.2030')
      expect(raw()).toBe('2030-12-15')
      fireEvent.change(input, { target: { value: '' } })
      typeText(input, '062031', { append: true })
      expect(input).toHaveValue('06.2031')
      expect(raw()).toBe('2031-06-30')
    })
  })

  it('says how far the month is, this month, or that it has passed', async () => {
    await withLanguage('ru-RU', () => {
      render(<Harness initial="2031-12-31" />)
      const input = screen.getByRole('textbox', { name: 'Target date' })
      expect(input).toHaveAccessibleDescription(ru('data.common.untilMonth', { value: `${ru('units.years', { count: 5, value: '5' })} ${ru('units.months', { count: 2, value: '2' })}` }))
      fireEvent.change(input, { target: { value: '10.2026' } })
      expect(input).toHaveAccessibleDescription(ru('data.common.thisMonth'))
      fireEvent.change(input, { target: { value: '09.2026' } })
      expect(screen.getByText(ru('data.common.monthPassed'))).toHaveClass('field__error')
    })
  })

  it('a field of finished months takes a passed month quietly and says this month or a later one has not finished', async () => {
    await withLanguage('ru-RU', () => {
      render(<Harness initial="2026-09-30" finished />)
      const input = screen.getByRole('textbox', { name: 'Target date' })
      expect(input).not.toHaveAccessibleDescription()
      expect(screen.queryByText(ru('data.common.monthPassed'))).toBeNull()
      fireEvent.change(input, { target: { value: '10.2026' } })
      expect(screen.getByText(ru('data.common.monthNotFinished'))).toHaveClass('field__error')
      fireEvent.change(input, { target: { value: '01.2027' } })
      expect(screen.getByText(ru('data.common.monthNotFinished'))).toHaveClass('field__error')
    })
  })

  it('a chip sets the last day of the month that many years from today', () => {
    render(<Harness chips={[1, 5, 10]} />)
    expect(screen.getByRole('button', { name: 'In 1 year' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'In 5 years' }))
    expect(raw()).toBe('2031-10-31')
    expect(screen.getByRole('textbox', { name: 'Target date' })).toHaveValue('10/2031')
  })

  it('a month left unfinished is said once the field is left', () => {
    render(<Harness initial="2030-12-15" />)
    const input = screen.getByRole('textbox', { name: 'Target date' })
    fireEvent.change(input, { target: { value: '' } })
    typeText(input, '03', { append: true })
    expect(raw()).toBe(UNREAD_DATE)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false)
    expect(screen.getByRole('alert')).toHaveTextContent('Finish the date: MM/YYYY')
  })

  it('a two-digit year is read as it is typed', () => {
    render(<Harness />)
    const input = screen.getByRole('textbox', { name: 'Target date' })
    typeText(input, '0631', { append: true })
    expect(input).toHaveValue('06/31')
    expect(raw()).toBe('2031-06-30')
  })

  it('a month that does not exist is said once the field is left', () => {
    render(<Harness />)
    const input = screen.getByRole('textbox', { name: 'Target date' })
    expect(input).toHaveAccessibleDescription('Digits only: MM/YYYY')
    typeText(input, '132030', { append: true })
    fireEvent.blur(input)
    expect(screen.getByRole('alert')).toHaveTextContent('There is no such month')
    expect(raw()).toBe(UNREAD_DATE)
  })
})

describe('PageAction', () => {
  it('renders into the header slot, and nothing without one', () => {
    const slot = document.createElement('div')
    document.body.append(slot)
    const { container, rerender } = render(<PageActionSlot.Provider value={null}><PageAction><button>+ Account</button></PageAction></PageActionSlot.Provider>)
    expect(container).toBeEmptyDOMElement()
    expect(slot).toBeEmptyDOMElement()
    rerender(<PageActionSlot.Provider value={slot}><PageAction><button>+ Account</button></PageAction></PageActionSlot.Provider>)
    expect(slot.querySelector('button')).toHaveTextContent('+ Account')
    slot.remove()
  })
})

describe('FormDialog', () => {
  it.each(['button', 'escape', 'backdrop', 'native close'])('consults beforeCancel for %s and retains input after refusal', async route => {
    const beforeCancel = vi.fn(async () => false)
    const onCancel = vi.fn()
    render(<FormDialog title="Editor" submitLabel="Save" onSubmit={() => false} onCancel={onCancel} beforeCancel={beforeCancel}><input aria-label="Draft" defaultValue="unsent" /></FormDialog>)
    const dialog = screen.getByRole('dialog', { name: 'Editor' }) as HTMLDialogElement
    if (route === 'button') fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    else if (route === 'escape') fireEvent(dialog, new Event('cancel', { cancelable: true }))
    else if (route === 'backdrop') fireEvent.click(dialog)
    else act(() => dialog.close())
    await waitFor(() => expect(beforeCancel).toHaveBeenCalledTimes(1))
    expect(onCancel).not.toHaveBeenCalled()
    expect(dialog).toHaveAttribute('open')
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('unsent')
  })
  /** Enter in a field, as a browser does it: the form is submitted unless the keydown was stopped */
  const pressEnter = (input: HTMLElement) => {
    if (fireEvent.keyDown(input, { key: 'Enter' })) fireEvent.submit(input.closest('form')!)
  }
  function DatedForm({ onSubmit }: { onSubmit: (date: string) => boolean }) {
    const [date, setDate] = useState('')
    return (
      <FormDialog title="New payment" submitLabel="Save" onSubmit={() => onSubmit(date)} onCancel={() => {}}>
        <Field label="Date"><DateInput label="Date" value={date} onChange={setDate} /></Field>
      </FormDialog>
    )
  }

  it('Enter right after "5.3.14" saves 5 March 2014', async () => {
    await withLanguage('ru-RU', async () => {
      const onSubmit = vi.fn(() => true)
      render(<DatedForm onSubmit={onSubmit} />)
      const input = screen.getByRole('textbox', { name: 'Date' })
      typeText(input, '5.3.14', { append: true })
      pressEnter(input)
      await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('2014-03-05'))
    })
  })

  it('Enter on "15.03" saves nothing and says how to finish the date', async () => {
    await withLanguage('ru-RU', () => {
      const onSubmit = vi.fn(() => true)
      render(<DatedForm onSubmit={onSubmit} />)
      const input = screen.getByRole('textbox', { name: 'Date' })
      typeText(input, '15.03', { append: true })
      pressEnter(input)
      expect(onSubmit).not.toHaveBeenCalled()
      expect(screen.getByRole('alert')).toHaveTextContent(ru('data.common.dateIncomplete', { pattern: ['d', 'm', 'y'].map(p => ru(`data.common.datePart.${p}`)).join('.') }))
    })
  })

  it('stays open through a second Escape while a save is pending, and closes once it is saved', async () => {
    let release!: (saved: boolean) => void
    const onSubmit = vi.fn(() => new Promise<boolean>(r => { release = r }))
    const onCancel = vi.fn()
    render(<FormDialog title="New goal" submitLabel="Save" onSubmit={onSubmit} onCancel={onCancel}><input className="admin-input" aria-label="Name" /></FormDialog>)
    const dialog = screen.getByRole('dialog', { name: 'New goal' }) as HTMLDialogElement
    fireEvent.submit(dialog.querySelector('form')!)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled())
    // the first Escape is a cancel the page may refuse
    expect(dialog.dispatchEvent(new Event('cancel', { cancelable: true }))).toBe(false)
    // a second one without a click in between is not cancelable: the browser closes the window anyway
    dialog.dispatchEvent(new Event('cancel'))
    act(() => dialog.close())
    expect(onCancel).not.toHaveBeenCalled()
    expect(dialog).toHaveAttribute('open')
    await act(async () => release(true))
    expect(dialog).not.toHaveAttribute('open')
    expect(onCancel).not.toHaveBeenCalled()
  })
})
