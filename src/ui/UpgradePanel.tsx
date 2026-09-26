import { UPGRADES, type UpgradeDef, type UpgradeId, VISUAL_TIER_THRESHOLDS } from '../game/content'
import { nextVisualTierAt, upgradeCost, visualTier } from '../game/engine'
import { formatNumber } from '../game/format'
import { useActions, useGame } from '../game/store'
import { cn } from './cn'

/** Five pips: how many of this upgrade's ship modules are installed. */
function ModulePips({ owned }: { owned: number }) {
  const tier = visualTier(owned)
  const next = nextVisualTierAt(owned)
  const label = `Ship module ${tier} of ${VISUAL_TIER_THRESHOLDS.length}${next ? `, next at ${next} owned` : ''}`
  return (
    <span className="flex shrink-0 items-center gap-1" title={label}>
      <span className="sr-only">{label}</span>
      {VISUAL_TIER_THRESHOLDS.map((threshold, i) => (
        <span
          key={threshold}
          aria-hidden="true"
          className={cn(
            'size-1.5 rounded-full transition-colors duration-500',
            i < tier ? 'bg-energy shadow-[0_0_6px_var(--color-energy)]' : 'bg-white/15',
          )}
        />
      ))}
    </span>
  )
}

function UpgradeRow({ upgrade }: { upgrade: UpgradeDef & { id: UpgradeId } }) {
  const { buy } = useActions()
  const owned = useGame((s) => s.game.owned[upgrade.id])
  const cost = upgradeCost(upgrade, owned)
  // Rounded so the row only re-renders when the progress bar visibly moves.
  const progress = useGame((s) => Math.floor(Math.min(1, s.game.energy / cost) * 100) / 100)
  const affordable = progress >= 1

  return (
    <li>
      <button
        type="button"
        aria-disabled={!affordable}
        onClick={() => affordable && buy(upgrade.id)}
        className={cn(
          'group relative w-full overflow-hidden px-4 py-2.5 text-left transition-colors',
          affordable ? 'cursor-pointer hover:bg-white/10' : 'cursor-not-allowed text-white/45',
        )}
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 bg-white/5 transition-[width] duration-300"
          style={{ width: `${progress * 100}%` }}
        />
        <span className="relative flex items-baseline justify-between gap-3">
          <span className="font-semibold">
            <span className="mr-1.5 inline-block min-w-7 text-energy tabular-nums">{owned}×</span>
            {upgrade.name}
          </span>
          <span className="shrink-0 text-sm tabular-nums">
            {formatNumber(cost, { notation: 'short' })}
            <span className="sr-only"> energy</span>
          </span>
        </span>
        <span className="relative flex items-center justify-between gap-3 text-sm text-white/55">
          <span>
            +{formatNumber(upgrade.eps, { decimals: 1 })}/s each
            {owned > 0 && ` · ${formatNumber(upgrade.eps * owned, { decimals: 1 })}/s total`}
          </span>
          <ModulePips owned={owned} />
        </span>
      </button>
    </li>
  )
}

export function UpgradePanel() {
  return (
    <section
      aria-labelledby="upgrades-title"
      className="panel flex min-h-0 w-full flex-col max-lg:max-h-[38dvh] lg:max-h-full"
    >
      <h2
        id="upgrades-title"
        className="border-b border-panel-line px-4 py-3 text-sm font-bold tracking-widest uppercase"
      >
        Reactor upgrades
      </h2>
      <ul className="scrollbar-thin min-h-0 divide-y divide-panel-line overflow-y-auto">
        {UPGRADES.map((upgrade) => (
          <UpgradeRow key={upgrade.id} upgrade={upgrade} />
        ))}
      </ul>
    </section>
  )
}
