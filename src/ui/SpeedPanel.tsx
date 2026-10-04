import { SPEED_LEVELS, type SpeedLevelDef } from '../game/content'
import { type SpeedLevelStatus, speedLevelStatus } from '../game/engine'
import { formatNumber } from '../game/format'
import { useActions, useGame } from '../game/store'
import { cn } from './cn'

const STATUS_LABEL: Record<SpeedLevelStatus, string> = {
  engaged: 'Engaged',
  sustainable: 'Sustainable',
  burst: 'Drains reserves',
  locked: 'Not enough energy',
}

/** Green at the first level to red at the last one. */
function levelHue(index: number) {
  return 145 - (index / (SPEED_LEVELS.length - 1)) * 145
}

function SpeedRow({ level, index }: { level: SpeedLevelDef; index: number }) {
  const { engage } = useActions()
  const status = useGame((s) => speedLevelStatus(s.game, index))
  const current = useGame((s) => s.game.speedLevel)
  const lit = index > 0 && index <= current

  return (
    <li>
      <button
        type="button"
        aria-pressed={status === 'engaged'}
        aria-disabled={status === 'locked'}
        title={STATUS_LABEL[status]}
        onClick={() => status !== 'locked' && engage(index)}
        className={cn(
          'relative w-full px-4 py-2 pl-5 text-left transition-colors',
          status === 'engaged' && 'bg-white/12',
          status === 'sustainable' && 'cursor-pointer hover:bg-white/10',
          status === 'burst' && 'cursor-pointer text-burst hover:bg-white/10',
          status === 'locked' && 'cursor-not-allowed text-white/40',
        )}
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-1 left-1.5 w-1 rounded-full transition-colors duration-500"
          style={{ backgroundColor: lit ? `oklch(0.78 0.19 ${levelHue(index)})` : 'transparent' }}
        />
        <span className="flex items-baseline justify-between gap-3">
          <span className={cn('font-semibold', status === 'engaged' && 'text-energy')}>
            {level.name}
          </span>
          <span className="shrink-0 text-sm tabular-nums">
            {level.drain > 0 ? `−${formatNumber(level.drain, { notation: 'short' })}/s` : 'free'}
          </span>
        </span>
        <span className="block text-sm text-white/55">
          {formatNumber(level.c, { decimals: level.c < 1 ? 4 : 0 })} c
          <span className="sr-only">, {STATUS_LABEL[status]}</span>
          {status === 'burst' && <span className="text-burst/80"> · drains reserves</span>}
        </span>
      </button>
    </li>
  )
}

export function SpeedPanel() {
  return (
    <section
      aria-labelledby="speed-title"
      className="panel flex min-h-0 w-full flex-col max-lg:max-h-[28dvh] lg:max-h-full"
    >
      <h2
        id="speed-title"
        className="border-b border-panel-line px-4 py-3 text-sm font-bold tracking-widest uppercase"
      >
        Helm
      </h2>
      <ul className="scrollbar-thin min-h-0 divide-y divide-panel-line overflow-y-auto">
        {SPEED_LEVELS.map((level, index) => (
          <SpeedRow key={level.id} level={level} index={index} />
        ))}
      </ul>
    </section>
  )
}
