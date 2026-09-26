import { ASTRONOMICAL_UNIT_KM, LIGHT_YEAR_KM } from './content'

const LONG_NAMES = [
  'million',
  'billion',
  'trillion',
  'quadrillion',
  'quintillion',
  'sextillion',
  'septillion',
  'octillion',
  'nonillion',
  'decillion',
] as const

const SHORT_NAMES = ['M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'] as const

const formatters = new Map<number, Intl.NumberFormat>()

function fixed(value: number, decimals: number): string {
  let formatter = formatters.get(decimals)
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
    formatters.set(decimals, formatter)
  }
  return formatter.format(value)
}

const mantissaFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 })

export interface FormatOptions {
  /** Fraction digits for values below one million. */
  decimals?: number
  /** `long`: "1.5 million", `short`: "1.5M". */
  notation?: 'long' | 'short'
}

/**
 * Human friendly numbers: grouped digits below one million, named powers of a thousand up to
 * decillions and scientific notation beyond that.
 */
export function formatNumber(
  value: number,
  { decimals = 0, notation = 'long' }: FormatOptions = {},
) {
  if (Number.isNaN(value)) return '–'
  if (!Number.isFinite(value)) return value < 0 ? '-∞' : '∞'

  const abs = Math.abs(value)
  if (abs < 1e6) {
    // Avoid printing "-0" for tiny negative values.
    const text = fixed(value, decimals)
    return /^-0(\.0*)?$/.test(text) ? text.slice(1) : text
  }

  let group = Math.floor(Math.log10(abs) / 3)
  let mantissa = Math.round((abs / 10 ** (group * 3)) * 1000) / 1000
  if (mantissa >= 1000) {
    mantissa /= 1000
    group += 1
  }

  const names = notation === 'long' ? LONG_NAMES : SHORT_NAMES
  const name = names[group - 2]
  const sign = value < 0 ? '-' : ''
  if (!name) return `${sign}${abs.toExponential(3).replace('e+', 'e')}`
  return `${sign}${mantissaFormat.format(mantissa)}${notation === 'long' ? ' ' : ''}${name}`
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const days = Math.floor(s / 86_400)
  const hours = Math.floor((s % 86_400) / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const parts = [
    days && `${days} d`,
    hours && `${hours} h`,
    minutes && `${minutes} min`,
    s < 60 && `${s} s`,
  ].filter(Boolean)
  return parts.slice(0, 2).join(' ')
}

/** Distance in astronomical units, switching to light-years once they become meaningful. */
export function formatAstronomical(km: number): string {
  const lightYears = km / LIGHT_YEAR_KM
  if (lightYears >= 0.01) {
    return `${formatNumber(lightYears, { decimals: lightYears < 100 ? 2 : 0 })} light-years`
  }
  return `${formatNumber(km / ASTRONOMICAL_UNIT_KM, { decimals: 2 })} AU`
}
