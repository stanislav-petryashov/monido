import { epAmountInvalid, epPayload, followPayment, formulaPayment, normaliseLoanData, paymentFollows, rateCheck } from '../../src/pages/admin/loans/loanForm'

describe('normaliseLoanData', () => {
  it('accepts a decimal comma in numeric fields and leaves text alone', () => {
    const out = normaliseLoanData({ name: 'Mortgage, Quillmark Bank', rate: '7,25' })
    expect(out.name).toBe('Mortgage, Quillmark Bank')
    expect(out.rate).toBe('7.25')
  })

  it('sends the payment day as a day 1–31, and "not set" as none (null)', () => {
    expect(normaliseLoanData({ payment_day: '31' }).payment_day).toBe('31')
    expect(normaliseLoanData({ payment_day: '1' }).payment_day).toBe('1')
    expect(normaliseLoanData({ payment_day: '' })).toEqual({ payment_day: null })
  })

  it('leaves out a stored payment day outside 1–31 the picker cannot hold: it was not touched and stays as stored', () => {
    expect(normaliseLoanData({ name: 'Old loan', payment_day: '32' })).toEqual({ name: 'Old loan' })
    expect(normaliseLoanData({ name: 'Old loan', payment_day: '0' })).toEqual({ name: 'Old loan' })
  })
})

describe('epPayload', () => {
  it('sends empty optional numbers as null, not empty strings', () => {
    const out = epPayload({ payment_date: '2031-03-21', amount: '6400', strategy: 'reduce_payment', new_payment: '', principal_credit: '' })
    expect(out.new_payment).toBeNull()
    expect(out.principal_credit).toBeNull()
  })

  it('keeps the bank payment for reduce_payment and drops a stale one for reduce_term', () => {
    expect(epPayload({ strategy: 'reduce_payment', new_payment: '1850' }).new_payment).toBe(1850)
    expect(epPayload({ strategy: 'reduce_term', new_payment: '1850' }).new_payment).toBeNull()
  })

  it('reads the amounts with a decimal comma as well as a dot, and leaves out an amount the edit did not touch', () => {
    const out = epPayload({ amount: '6400,5', strategy: 'reduce_payment', new_payment: '1850.25', principal_credit: '6 000' })
    expect(out).toMatchObject({ amount: 6400.5, new_payment: 1850.25, principal_credit: 6000 })
    expect('amount' in epPayload({ strategy: 'reduce_term' })).toBe(false)
  })
})

describe('epAmountInvalid', () => {
  it('refuses a form whose amount, credited principal or new payment cannot be read', () => {
    expect(epAmountInvalid({ amount: '1.000', strategy: 'reduce_term' })).toBe(true)
    expect(epAmountInvalid({ amount: '1000', principal_credit: '12a', strategy: 'reduce_term' })).toBe(true)
    expect(epAmountInvalid({ amount: '1000', new_payment: '1,000', strategy: 'reduce_payment' })).toBe(true)
  })

  it('ignores a stale new payment the strategy does not use, and empty optional fields', () => {
    expect(epAmountInvalid({ amount: '1000', new_payment: '1,000', strategy: 'reduce_term' })).toBe(false)
    expect(epAmountInvalid({ amount: '6 400,5', new_payment: '', principal_credit: '', strategy: 'reduce_payment' })).toBe(false)
  })
})

describe('rateCheck', () => {
  it('takes a rate under 1% for a fraction and suggests it in percent', () => {
    expect(rateCheck(0.12)).toEqual({ kind: 'fraction', suggested: 12 })
    expect(rateCheck(0.0725)).toEqual({ kind: 'fraction', suggested: 7.25 })
  })

  it('flags a rate over 60% a year', () => {
    expect(rateCheck(125)).toEqual({ kind: 'high' })
  })

  it('says nothing about an ordinary rate, a zero one or none', () => {
    for (const rate of [12.5, 0, 1, 60, null]) expect(rateCheck(rate)).toBeNull()
  })
})

describe('followPayment', () => {
  const loan = { principal: '3000000', rate: '12', term_months: '240' }
  const formula = formulaPayment(loan)!

  it('a payment that is the formula follows a change of the term', () => {
    const before = { ...loan, monthly_payment: formula }
    const after = followPayment(before, { ...before, term_months: '120' })
    expect(after.monthly_payment).toBe(formulaPayment({ ...loan, term_months: '120' }))
    expect(after.monthly_payment).not.toBe(formula)
  })

  it('a typed payment stays when the principal changes', () => {
    const before = { ...loan, monthly_payment: '33500' }
    expect(followPayment(before, { ...before, principal: '2500000' }).monthly_payment).toBe('33500')
  })

  it('an empty payment is filled by the formula', () => {
    const before = { principal: '3000000', rate: '12' }
    expect(followPayment(before, { ...before, term_months: '240' }).monthly_payment).toBe(formula)
  })

  it('without a formula and with no payment there is nothing to fill', () => {
    const before = { rate: '12' }
    expect(followPayment(before, { ...before, term_months: '240' })).toEqual({ rate: '12', term_months: '240', monthly_payment: '' })
  })

  it('a following payment keeps following when the term is cleared and typed again', () => {
    let d: Record<string, string> = { ...loan, monthly_payment: formula }
    const edit = (field: string, value: string) => { d = followPayment(d, { ...d, [field]: value }) }
    edit('term_months', '')
    expect(d.monthly_payment).toBe('')
    edit('term_months', '1')
    edit('term_months', '12')
    expect(d.monthly_payment).toBe(formulaPayment({ ...loan, term_months: '12' }))
    edit('principal', '')
    edit('principal', '2500000')
    expect(d.monthly_payment).toBe(formulaPayment({ ...loan, principal: '2500000', term_months: '12' }))
  })

  it('a stored bank payment survives the same clearing and retyping', () => {
    let d: Record<string, string> = { ...loan, monthly_payment: '33500' }
    const edit = (field: string, value: string) => { d = followPayment(d, { ...d, [field]: value }) }
    edit('term_months', '')
    edit('term_months', '1')
    edit('term_months', '12')
    expect(d.monthly_payment).toBe('33500')
  })
})

describe('paymentFollows', () => {
  const loan = { principal: '3000000', rate: '12', term_months: '240' }

  it('is true for the formula payment within a cent, false for a typed one or none', () => {
    const formula = Number(formulaPayment(loan))
    expect(paymentFollows({ ...loan, monthly_payment: String(formula) })).toBe(true)
    expect(paymentFollows({ ...loan, monthly_payment: String(formula + 0.01) })).toBe(true)
    expect(paymentFollows({ ...loan, monthly_payment: '33500' })).toBe(false)
    expect(paymentFollows({ ...loan, monthly_payment: '' })).toBe(false)
    expect(paymentFollows({ rate: '12', monthly_payment: '33500' })).toBe(false)
  })
})
