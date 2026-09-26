import { describe, expect, it } from 'vitest'
import { formatAstronomical, formatDuration, formatNumber } from './format'

describe('formatNumber', () => {
  it.each([
    [0, 0, '0'],
    [1234, 0, '1,234'],
    [999_999, 0, '999,999'],
    // Regression: the 2014 version floored the integer part but rounded the fraction.
    [0.96, 1, '1.0'],
    [1.96, 1, '2.0'],
    [12.97, 1, '13.0'],
    [-1.5, 1, '-1.5'],
    [-0.01, 1, '0.0'],
  ])('formats %d with %d decimals as %s', (value, decimals, expected) => {
    expect(formatNumber(value, { decimals })).toBe(expected)
  })

  it.each([
    [1_000_000, '1 million'],
    [1_234_567, '1.235 million'],
    [999_999_999.9, '1 billion'],
    [-2.5e9, '-2.5 billion'],
    [4.2e33, '4.2 decillion'],
  ])('names large number %d as %s', (value, expected) => {
    expect(formatNumber(value)).toBe(expected)
  })

  it('supports short names', () => {
    expect(formatNumber(3.5e12, { notation: 'short' })).toBe('3.5T')
  })

  it('falls back to scientific notation past decillions instead of NaN', () => {
    expect(formatNumber(1.5e36)).toBe('1.500e36')
  })

  it('handles non-finite values', () => {
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('∞')
    expect(formatNumber(Number.NaN)).toBe('–')
  })
})

describe('formatDuration', () => {
  it.each([
    [5, '5 s'],
    [90, '1 min'],
    [3 * 3600 + 12 * 60, '3 h 12 min'],
    [2 * 86_400 + 3600 + 60, '2 d 1 h'],
  ])('formats %d seconds as %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected)
  })
})

describe('formatAstronomical', () => {
  it('uses astronomical units for short distances', () => {
    expect(formatAstronomical(0)).toBe('0.00 AU')
    expect(formatAstronomical(399_508_000)).toBe('2.67 AU')
  })

  it('switches to light-years', () => {
    expect(formatAstronomical(9_460_730_472_580.8 * 4.2)).toBe('4.20 light-years')
    expect(formatAstronomical(9_460_730_472_580.8 * 2500)).toBe('2,500 light-years')
  })
})
