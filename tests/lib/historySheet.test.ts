import { describe, expect, it } from 'vitest'
import { historyTemplate, parseHistorySheet } from '../../src/lib/historySheet'

describe('parseHistorySheet', () => {
  it('a wide sheet pasted from a spreadsheet: tabs, a row per month, a column per account, blanks', () => {
    const r = parseHistorySheet('Month\tLumiora Bank\tBroker\n2024-01\t1 200,50\t\n2024-02\t1 300,00\t500\n')
    expect(r.problems).toEqual([])
    expect(r.decimal).toBe(',')
    expect(r.sheet).toEqual({
      shape: 'wide', accounts: ['Lumiora Bank', 'Broker'], currencies: [null, null],
      months: [{ month: '2024-01', values: [1200.5, null] }, { month: '2024-02', values: [1300, 500] }],
    })
  })

  it('a CSV with quotes, thousands groups and a dot decimal; dates as month ends, day first or month first', () => {
    const r = parseHistorySheet('Date,"Bank, main",Savings\n31/01/2024,"1,234.50",$10\n29/02/2024,"2,000.00",(5)\n')
    expect(r.sheet?.accounts).toEqual(['Bank, main', 'Savings'])
    expect(r.sheet?.months).toEqual([{ month: '2024-01', values: [1234.5, 10] }, { month: '2024-02', values: [2000, -5] }])
    expect(parseHistorySheet('Date;A\n01/31/2024;1\n02/29/2024;2').sheet?.months.map(m => m.month)).toEqual(['2024-01', '2024-02'])
    expect(parseHistorySheet('Date;A\n31.01.2024;1\n01.2024;2').sheet?.months.map(m => m.month)).toEqual(['2024-01', '2024-01'])
  })

  it('a long sheet: month, account, balance and the currency; accounts in order of first use', () => {
    const r = parseHistorySheet('Date,Account,Balance,Currency\n2024-01-31,Bank,100,usd\n2024-01-31,Broker,50,EUR\n2024-02-29,Bank,110,USD\n')
    expect(r.problems).toEqual([])
    expect(r.sheet).toEqual({
      shape: 'long', accounts: ['Bank', 'Broker'], currencies: ['USD', 'EUR'],
      months: [{ month: '2024-01', values: [100, 50] }, { month: '2024-02', values: [110, null] }],
    })
  })

  it('never guesses an ambiguous decimal mark: 1,234 alone is asked about, then read as told', () => {
    const r = parseHistorySheet('Month;A\n2024-01;1,234\n2024-02;5,678')
    expect(r.decimal).toBe('ambiguous')
    expect(r.sheet?.months[0].values).toEqual([null])
    expect(parseHistorySheet('Month;A\n2024-01;1,234', ',').sheet?.months[0].values).toEqual([1.234])
    expect(parseHistorySheet('Month;A\n2024-01;1,234', '.').sheet?.months[0].values).toEqual([1234])
  })

  it('names what it cannot read: the row and the cell', () => {
    expect(parseHistorySheet('').problems).toEqual([{ code: 'empty' }])
    expect(parseHistorySheet('Month\n2024-01').problems).toEqual([{ code: 'no_columns' }])
    expect(parseHistorySheet('Month,A\nsoon,1\n2024-02,lots').problems).toEqual([
      { code: 'bad_date', row: 2, text: 'soon' }, { code: 'bad_number', row: 3, text: 'lots' },
    ])
    expect(parseHistorySheet('Date,Account,Balance\n2024-01,Bank,1\n2024-01,Bank,2').problems).toEqual([{ code: 'duplicate', row: 3, month: '2024-01', account: 'Bank' }])
    expect(parseHistorySheet('Date,Account,Balance,Currency\n2024-01,Bank,1,USD\n2024-02,Bank,2,EUR').problems).toEqual([{ code: 'currency_varies', account: 'Bank' }])
  })
})

describe('historyTemplate', () => {
  it('lists the months ending at the given one, the accounts as columns, quoted when needed, and reads back', () => {
    const csv = historyTemplate('Month', ['Bank', 'Savings, joint'], '2024-02', 3)
    expect(csv).toBe('Month,Bank,"Savings, joint"\n2023-12,,\n2024-01,,\n2024-02,,\n')
    expect(parseHistorySheet(csv).sheet?.months.map(m => m.month)).toEqual(['2023-12', '2024-01', '2024-02'])
  })
})
