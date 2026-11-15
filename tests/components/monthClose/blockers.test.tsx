import { fireEvent, screen, within } from '@testing-library/react'
import { fmtMonth } from '../../../src/lib/formatters'
import { ru, withLanguage } from '../../helpers/i18n'
import { resetAuth } from '../../../src/lib/authState'
import { account, barFigure, base, closable, obstacleLines, renderScreen, stubState } from '../../helpers/monthClose'

afterEach(() => { resetAuth() })

describe('Month-close wizard', () => {
  it('says what still stands in the way of closing, account by account', async () => {
    const rows = [{ ...base.rows[0], balance: 1, active: 0, passive: 0, expense: -5 }, base.rows[1]]
    stubState({ ...base, rows })
    renderScreen()
    const list = await screen.findByRole('list', { name: 'What prevents closing the month' })
    expect(obstacleLines(list)).toContain('“Quillmark Bank”: negative value: expenses')
    expect(within(list).queryByText(/“Deposit”/)).toBeNull()
    expect(barFigure()).toBe('1 of 2accounts filled')
    // an untouched row has no mark of its own: the progress card counts it
    const deposit = screen.getByText('Deposit', { selector: '.close-table__account' }).closest('tr')!
    expect(within(deposit).queryByText('not filled')).toBeNull()
    expect(screen.getByLabelText('Expense: Quillmark Bank')).toHaveAttribute('aria-invalid', 'true')
  })

  it('the obstacles are a warning card, the account’s name a link that puts the cursor in its fields', async () => {
    stubState({ ...base, rows: [{ ...base.rows[0], balance: 1, active: 0, passive: 0, expense: -5 }, base.rows[1]] })
    renderScreen()
    const list = await screen.findByRole('list', { name: 'What prevents closing the month' })
    const card = list.closest('div')!
    expect(card).toHaveClass('alert', 'alert--warning')
    expect(within(card).getByRole('heading', { name: 'What prevents closing the month' })).toBeInTheDocument()
    const field = screen.getByLabelText('Balance: Quillmark Bank')
    const [link] = within(list).getAllByRole('link', { name: '“Quillmark Bank”' })
    expect(link).toHaveAttribute('href', `#${field.id}`)
    fireEvent.click(link)
    expect(field).toHaveFocus()
  })

  it('one line says how many accounts are not filled in', async () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F']
    stubState({ ...base, rows: names.map(account), problems: names.map(n => ({ key: JSON.stringify([n, 'Robin']), name: n, member: 'Robin', problem: { code: 'missing' as const, fields: ['balance' as const] } })) })
    renderScreen()
    await screen.findByLabelText('Balance: A')
    expect(barFigure()).toBe('0 of 6accounts filled')
    expect(obstacleLines(screen.getByRole('list', { name: 'What prevents closing the month' }))).toEqual(['Not started: A, B, C, D, E, F'])
    expect(screen.queryAllByText('not filled')).toHaveLength(0)
  })

  it('marks a row only when it is partly filled: “not filled” under each empty field', async () => {
    const rows = [{ ...base.rows[0], balance: 1, active: 0 }, base.rows[1]]
    const problems = [
      { key: '["Quillmark Bank","Robin"]', name: 'Quillmark Bank', member: 'Robin', problem: { code: 'missing' as const, fields: ['passive' as const, 'expense' as const] } },
      base.problems[1],
    ]
    stubState({ ...base, rows, problems })
    renderScreen()
    const field = (label: string) => screen.getByLabelText(label).closest('td')!
    await screen.findByLabelText('Balance: Quillmark Bank')
    for (const label of ['Passive income: Quillmark Bank', 'Expense: Quillmark Bank']) {
      expect(within(field(label)).getByText('not filled')).toHaveClass('close-table__unfilled')
      expect(screen.getByLabelText(label)).toHaveAccessibleDescription('not filled')
    }
    for (const label of ['Balance: Quillmark Bank', 'Active income: Quillmark Bank']) expect(within(field(label)).queryByText('not filled')).toBeNull()
    // the name cell no longer lists what is missing
    expect(within(screen.getByText('Quillmark Bank', { selector: '.close-table__account' }).closest('td')!).queryByText(/not filled/i)).toBeNull()
    expect(within(screen.getByText('Deposit', { selector: '.close-table__account' }).closest('tr')!).queryByText('not filled')).toBeNull()
    expect(barFigure()).toBe('0 of 2accounts filled')
  })

  it('the disabled close names invalid values, not missing ones, when everything is filled in', async () => {
    const rows = base.rows.map(r => ({ ...r, balance: 1, active: 0, passive: 0, expense: -5 }))
    stubState({ ...base, rows })
    renderScreen()
    const button = await screen.findByRole('button', { name: 'Close June 2031' })
    expect(closable(button)).toBe(false)
    // the reason, then the obstacles card it points at
    expect(button).toHaveAccessibleDescription(/^Fix the invalid values to close June 2031/)
    expect(button.getAttribute('aria-describedby')?.split(' ')).toContain(document.querySelector('.close-problems')?.id)
    expect(barFigure()).toBe('2 of 2accounts filled')
  })

  it('the disabled close says why', async () => {
    stubState(base)
    renderScreen()
    const button = await screen.findByRole('button', { name: 'Close June 2031' })
    expect(closable(button)).toBe(false)
    // nothing but empty fields: the reason, then one "Not started" line, each name a link to its fields
    expect(button).toHaveAccessibleDescription(/^Fill in every account to close June 2031/)
    const list = screen.getByRole('list', { name: 'What prevents closing the month' })
    expect(obstacleLines(list)).toEqual(['Not started: Quillmark Bank, Deposit'])
    for (const name of ['Quillmark Bank', 'Deposit']) {
      expect(within(list).getByRole('link', { name })).toHaveAttribute('href', `#${screen.getByLabelText(`Balance: ${name}`).id}`)
    }
  })

  it('a started row says what it lacks, an untouched one is only named as not started', async () => {
    stubState({ ...base, rows: [{ ...base.rows[0], balance: 1, passive: 0 }, base.rows[1]] })
    renderScreen()
    const list = await screen.findByRole('list', { name: 'What prevents closing the month' })
    expect(obstacleLines(list)).toEqual(['“Quillmark Bank”: not filled in: active income, expenses', 'Not started: Deposit'])
    expect(within(list).getByRole('link', { name: '“Quillmark Bank”' })).toHaveAttribute('href', `#${screen.getByLabelText('Balance: Quillmark Bank').id}`)
    expect(within(list).getByRole('link', { name: 'Deposit' })).toHaveAttribute('href', `#${screen.getByLabelText('Balance: Deposit').id}`)
  })

  it('the previous balance sits in the meta line under the account name', async () => {
    stubState(base)
    renderScreen()
    const hint = await screen.findByText('RUB · Bank · in May: 5,800')
    const cell = hint.closest('td')!
    expect(within(cell).getByText('Quillmark Bank')).toBeInTheDocument()
    expect(within(cell).queryByLabelText('Balance: Quillmark Bank')).toBeNull()
  })
})

describe('Month-close wizard in Russian', () => {
  it('the count line agrees with the total in Russian too', async () => {
    // the noun under the figure is keyed on the total: one form after 1 and 21, another after 2 and 5
    const noun = (total: number) => ru('data.close.filledLabel', { count: total }).split(' ')[0]
    expect(noun(1)).toBe(noun(21))
    expect(noun(2)).toBe(noun(5))
    expect(noun(1)).not.toBe(noun(5))
  })

  it('follows the language: button, queue, fields and the count line', async () => {
    await withLanguage('ru-RU', async () => {
      stubState(base)
      renderScreen()
      expect(closable(await screen.findByRole('button', { name: ru('data.close.closeMonth', { month: fmtMonth('2031-06') }) }))).toBe(false)
      expect(screen.getByRole('list', { name: ru('data.close.queue') })).toBeInTheDocument()
      expect(screen.getByLabelText(`${ru('data.field.balance')}: Quillmark Bank`)).toHaveValue('')
      expect(barFigure()).toBe(ru('data.close.filledFigure', { count: '2', filled: '0' }) + ru('data.close.filledLabel', { count: 2 }))
      expect(screen.getByText(ru('data.close.hintFlows'))).toBeInTheDocument()
    })
  })

  it('names what blocks closing with the Russian quotes and field words', async () => {
    await withLanguage('ru-RU', async () => {
      const field = ru('monthClose.field.expense')
      stubState({ ...base, rows: [{ ...base.rows[0], balance: 1, active: 0, passive: 0, expense: -5 }, base.rows[1]] })
      renderScreen()
      const list = await screen.findByRole('list', { name: ru('data.close.obstacles') })
      const quoted = ru('data.close.quoted', { name: 'Quillmark Bank' })
      expect(quoted).not.toBe('“Quillmark Bank”')
      expect(obstacleLines(list)).toContain(`${quoted}: ${ru('monthClose.problem.negative', { fields: field })}`)
      // no field is marked as not filled (Quillmark Bank is filled, the untouched Deposit is counted in the progress card only)
      expect(screen.queryByText(ru('data.close.fieldMissing'))).toBeNull()
      expect(barFigure()).toBe(ru('data.close.filledFigure', { count: '2', filled: '1' }) + ru('data.close.filledLabel', { count: 2 }))
    })
  })

  it('says “not filled” in Russian under each empty field of a started row', async () => {
    await withLanguage('ru-RU', async () => {
      const problems = [
        { key: '["Quillmark Bank","Robin"]', name: 'Quillmark Bank', member: 'Robin', problem: { code: 'missing' as const, fields: ['passive' as const, 'expense' as const] } },
        base.problems[1],
      ]
      stubState({ ...base, rows: [{ ...base.rows[0], balance: 1, active: 0 }, base.rows[1]], problems })
      renderScreen()
      await screen.findByLabelText(`${ru('data.field.balance')}: Quillmark Bank`)
      expect(screen.getAllByText(ru('data.close.fieldMissing'))).toHaveLength(2)
    })
  })

  it('picks the plural form of the stray-rows note and of the old months', async () => {
    await withLanguage('ru-RU', async () => {
      stubState({ ...base, strayRows: 2, incomplete: [{ month: '2031-03', missing: 5 }] })
      renderScreen()
      expect(await screen.findByText(ru('data.close.stray', { count: 2 }))).toBeInTheDocument()
      expect(screen.getByText(ru('data.close.oldMissing', { month: fmtMonth('2031-03'), count: 5 }))).toBeInTheDocument()
    })
    const forms = [1, 2, 5].map(count => ru('data.close.stray', { count }))
    expect(new Set(forms).size).toBe(3)
  })
})
