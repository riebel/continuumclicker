import { drain, production, speedKmh, speedLevelOf } from '../game/engine'
import { formatAstronomical, formatDuration, formatNumber } from '../game/format'
import { useGame } from '../game/store'
import { cn } from './cn'

export function EnergyReadout() {
  const energy = useGame((s) => s.game.energy)
  const produced = useGame((s) => production(s.game))
  const drained = useGame((s) => drain(s.game))
  const net = produced - drained

  return (
    <header className="glow text-center">
      <h1 className="sr-only">Continuum Clicker</h1>
      <p className="text-4xl font-bold tabular-nums sm:text-5xl">
        {formatNumber(energy, { decimals: 1 })}
        <span className="ml-2 text-xl font-semibold text-energy sm:text-2xl">energy</span>
      </p>
      <p className="mt-1 text-base tabular-nums sm:text-lg">
        <span className="text-ok">+{formatNumber(produced, { decimals: 1 })}/s</span>
        <span className="text-white/60"> reactors</span>
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
    </header>
  )
}

export function FlightReadout() {
  const kmh = useGame((s) => speedKmh(s.game))
  const c = useGame((s) => speedLevelOf(s.game).c)
  const distance = useGame((s) => s.game.distance)

  return (
    <footer className="glow grid grid-cols-2 gap-4 text-center tabular-nums">
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
    </footer>
  )
}
