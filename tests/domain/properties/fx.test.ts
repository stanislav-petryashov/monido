// Properties of src/domain/fx.ts: conversion through the per-USD cross rate and the domain's one rounding.
import fc from 'fast-check'
import { describe, it } from 'vitest'
import { convert, convertRounded, round2 } from '../../../src/domain/fx'
import { CURRENCIES, RATELESS, cents, currency, rates, runs } from '../../helpers/arbitraries'

const RUNS = runs(200)
const amount = cents(-10_000_000, 10_000_000)
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))

describe('convert', () => {
  it('a currency into itself needs no rate and keeps the amount', () => {
    fc.assert(fc.property(amount, fc.constantFrom(...CURRENCIES, RATELESS), (v, c) => convert(v, c, c, {}) === v), RUNS)
  })

  it('there and back gives the amount back', () => {
    fc.assert(fc.property(amount, currency(), currency(), rates(), (v, a, b, r) => close(convert(convert(v, a, b, r)!, b, a, r)!, v)), RUNS)
  })

  it('through a third currency is the same as directly', () => {
    fc.assert(fc.property(amount, currency(), currency(), currency(), rates(), (v, a, b, c, r) =>
      close(convert(convert(v, a, b, r)!, b, c, r)!, convert(v, a, c, r)!)), RUNS)
  })

  it('a known pair always gives a finite number', () => {
    fc.assert(fc.property(amount, currency(), currency(), rates(), (v, a, b, r) => Number.isFinite(convert(v, a, b, r))), RUNS)
  })

  it('a side without a usable rate gives null, never a number (domain rule 1)', () => {
    const bad = fc.constantFrom(undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY)
    fc.assert(fc.property(amount, currency().filter(c => c !== 'USD'), currency(), rates(), bad, fc.boolean(), (v, missing, other, r, rate, from) => {
      const table = { ...r, [missing]: rate as number }
      if (rate === undefined) delete (table as Record<string, number>)[missing]
      if (other === missing) return true
      return (from ? convert(v, missing, other, table) : convert(v, other, missing, table)) === null
        && convertRounded(v, from ? missing : other, from ? other : missing, table) === null
    }), RUNS)
  })
})

describe('round2', () => {
  const real = fc.double({ min: -1e9, max: 1e9, noNaN: true })

  it('lands on the cent within half a cent, and rounding again changes nothing', () => {
    fc.assert(fc.property(real, x => {
      const r = round2(x)
      return Math.abs(r - x) <= 0.005 + 1e-6 && round2(r) === r && Number(r.toFixed(2)) === r
    }), RUNS)
  })

  it('is symmetric (a half away from zero on both sides) and never −0', () => {
    fc.assert(fc.property(real, x => round2(-x) === -round2(x)), RUNS)
    fc.assert(fc.property(real, x => !Object.is(round2(x), -0)), RUNS)
  })

  it('keeps an amount already in cents', () => {
    fc.assert(fc.property(amount, v => round2(v) === v), RUNS)
  })

  it('convertRounded is convert rounded to the cent', () => {
    fc.assert(fc.property(amount, currency(), currency(), rates(), (v, a, b, r) => convertRounded(v, a, b, r) === round2(convert(v, a, b, r)!)), RUNS)
  })
})

