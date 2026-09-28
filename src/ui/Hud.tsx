import {
  type BuffKind,
  drain,
  droneIncome,
  production,
  speedKmh,
  speedLevelOf,
} from '../game/engine'
import { formatAstronomical, formatDuration, formatNumber } from '../game/format'
import { findSystem, sectorFor } from '../game/sector'
import { useGame } from '../game/store'
import { cn } from './cn'

export function EnergyReadout() {
  const energy = useGame((s) => s.game.energy)
  const produced = useGame((s) => production(s.game))
  const drones = useGame((s) => droneIncome(s.game))
  const drained = useGame((s) => drain(s.game))
  const net = produced + drones - drained

  return (
    <header className="glow px-12 text-center lg:px-0">
      <h1 className="sr-only">Continuum Clicker</h1>
      <p className="text-4xl font-bold tabular-nums sm:text-5xl">
        {formatNumber(energy, { decimals: 1 })}
        <span className="ml-2 text-xl font-semibold text-energy sm:text-2xl">energy</span>
      </p>
      <p className="mt-1 text-base tabular-nums sm:text-lg">
        <span className="text-ok">+{formatNumber(produced, { decimals: 1 })}/s</span>
        <span className="text-white/60"> reactors</span>
        {drones > 0 && (
          <>
            <span className="text-white/40"> · </span>
            <span className="text-ok">+{formatNumber(drones, { decimals: 1 })}/s</span>
            <span className="text-white/60"> drones</span>
          </>
        )}
        {drained > 0 && (
          <>
            <span className="text-white/40"> · </span>
            <span className="text-burst">−{formatNumber(drained, { decimals: 1 })}/s</span>
            <span className="text-white/60"> drive</span>
            <span className="text-white/40"> · </span>
            <span className={cn('font-semibold', net < 0 ? 'text-danger' : 'text-white')}>
              {net >= 0 ? '+' : ''}
              {formatNumber(net, { decimals: 1 })}/s net
            </span>
          </>
        )}
      </p>
      {net < 0 && (
        <p className="mt-1 text-sm font-semibold text-danger">
          Reserves last {formatDuration(energy / -net)}
        </p>
      )}
      <ActiveBuffs />
    </header>
  )
}

const BUFF_LABELS: Record<BuffKind, { name: string; effect: string }> = {
  overdrive: { name: 'Overdrive', effect: 'reactors' },
  'laser-frenzy': { name: 'Laser frenzy', effect: 'hits' },
}

/** Comet buffs that are running, with their time left. */
function ActiveBuffs() {
  // Whole seconds, so the chips re-render once a second rather than every frame.
  const key = useGame((s) =>
    s.game.buffs
      .map((b) => `${b.kind}:${b.multiplier}:${Math.ceil(b.remaining)}:${b.duration}`)
      .join(','),
  )
  if (!key) return null
  const buffs = key.split(',').map((entry) => {
    const [kind, multiplier, remaining, duration] = entry.split(':')
    return {
      kind: kind as BuffKind,
      multiplier: Number(multiplier),
      remaining: Number(remaining),
      duration: Number(duration),
    }
  })

  return (
    <ul aria-label="Active boosts" className="mt-2 flex flex-wrap justify-center gap-2">
      {buffs.map((buff) => (
        <li
          key={buff.kind}
          className="relative overflow-hidden rounded-full border border-sky-300/40 bg-sky-400/10 px-3 py-0.5 text-sm font-semibold text-sky-100"
        >
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 bg-sky-300/20 transition-[width] duration-1000 ease-linear"
            style={{ width: `${(buff.remaining / buff.duration) * 100}%` }}
          />
          <span className="relative tabular-nums">
            {BUFF_LABELS[buff.kind].name} · {BUFF_LABELS[buff.kind].effect} ×{buff.multiplier} ·{' '}
            {formatDuration(buff.remaining)}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Where the ship is docked, or where it is heading and when it gets there. */
function Whereabouts() {
  const text = useGame(({ game }) => {
    const sector = sectorFor(game.sectorSeed)
    if (!game.course) {
      const docked = findSystem(sector, game.location)
      const bonus = docked?.kind === 'belt' ? ' · mining bonus' : ''
      return `Docked at ${docked?.name ?? 'nowhere'}${bonus}`
    }
    const target = findSystem(sector, game.course.to)
    const kmh = speedKmh(game)
    const left = game.course.length - game.course.travelled
    const eta =
      kmh > 0 ? ` · ${formatDuration(Math.max(1, (left * 3600) / kmh))}` : ' · engines stopped'
    return `En route to ${target?.name ?? 'unknown'}${eta}`
  })
  return <p className="col-span-2 text-sm text-white/70">{text}</p>
}

export function FlightReadout() {
  const kmh = useGame((s) => speedKmh(s.game))
  const c = useGame((s) => speedLevelOf(s.game).c)
  const distance = useGame((s) => s.game.distance)

  return (
    <footer className="glow grid grid-cols-2 gap-x-4 gap-y-1 text-center tabular-nums">
      <div>
        <p className="text-xs font-semibold tracking-widest text-white/50 uppercase">Speed</p>
        <p className="text-xl font-bold sm:text-2xl">{formatNumber(kmh)} km/h</p>
        <p className="text-sm text-white/60">
          {formatNumber(c, { decimals: c > 0 && c < 1 ? 4 : 0 })} c
        </p>
      </div>
      <div>
        <p className="text-xs font-semibold tracking-widest text-white/50 uppercase">Distance</p>
        <p className="text-xl font-bold sm:text-2xl">{formatNumber(distance)} km</p>
        <p className="text-sm text-white/60">{formatAstronomical(distance)}</p>
      </div>
      <Whereabouts />
    </footer>
  )
}
