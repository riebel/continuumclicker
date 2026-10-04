import { useState } from 'react'
import {
  LASER_UPGRADES,
  type LaserUpgradeDef,
  type LaserUpgradeId,
  MILESTONE_MULTIPLIER,
  UPGRADES,
  type UpgradeDef,
  type UpgradeId,
  VISUAL_TIER_THRESHOLDS,
} from '../game/content'
import {
  critChance,
  critMultiplier,
  hitEnergy,
  laserCost,
  milestoneMultiplier,
  nextMilestoneAt,
  nextVisualTierAt,
  upgradeCost,
  upgradeProduction,
  visualTier,
} from '../game/engine'
import { formatNumber } from '../game/format'
import { useActions, useGame } from '../game/store'
import { Arsenal } from './Arsenal'
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
  const multiplier = milestoneMultiplier(owned)
  const nextMilestone = nextMilestoneAt(owned)
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
            {multiplier > 1 && (
              <span
                className="ml-1.5 text-sm text-energy tabular-nums"
                title={`Output ×${multiplier} from milestones`}
              >
                ×{multiplier}
              </span>
            )}
          </span>
          <span className="shrink-0 text-sm tabular-nums">
            {formatNumber(cost, { notation: 'short' })}
            <span className="sr-only"> energy</span>
          </span>
        </span>
        <span className="relative flex items-center justify-between gap-3 text-sm text-white/55">
          <span>
            +{formatNumber(upgrade.eps * multiplier, { decimals: 1 })}/s each
            {owned > 0 &&
              ` · ${formatNumber(upgradeProduction(upgrade, owned), { decimals: 1 })}/s total`}
            {nextMilestone && ` · ×${MILESTONE_MULTIPLIER} at ${nextMilestone}`}
          </span>
          <ModulePips owned={owned} />
        </span>
      </button>
    </li>
  )
}

function LaserRow({ upgrade }: { upgrade: LaserUpgradeDef & { id: LaserUpgradeId } }) {
  const { buyLaser } = useActions()
  const level = useGame((s) => s.game.lasers[upgrade.id])
  const maxed = upgrade.maxLevel !== undefined && level >= upgrade.maxLevel
  const cost = laserCost(upgrade, level)
  const progress = useGame((s) =>
    maxed ? 1 : Math.floor(Math.min(1, s.game.energy / cost) * 100) / 100,
  )
  const affordable = !maxed && progress >= 1

  return (
    <li>
      <button
        type="button"
        aria-disabled={!affordable}
        onClick={() => affordable && buyLaser(upgrade.id)}
        className={cn(
          'group relative w-full overflow-hidden px-4 py-2.5 text-left transition-colors',
          affordable ? 'cursor-pointer hover:bg-white/10' : 'cursor-not-allowed text-white/45',
          maxed && 'text-white/70',
        )}
      >
        {!maxed && (
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 bg-white/5 transition-[width] duration-300"
            style={{ width: `${progress * 100}%` }}
          />
        )}
        <span className="relative flex items-baseline justify-between gap-3">
          <span className="font-semibold">
            <span className="mr-1.5 inline-block min-w-7 text-burst tabular-nums">L{level}</span>
            {upgrade.name}
          </span>
          <span className="shrink-0 text-sm tabular-nums">
            {maxed ? (
              'Max'
            ) : (
              <>
                {formatNumber(cost, { notation: 'short' })}
                <span className="sr-only"> energy</span>
              </>
            )}
          </span>
        </span>
        <span className="relative block text-sm text-white/55">{upgrade.effect}</span>
      </button>
    </li>
  )
}

/** Current laser stats: what a regular hit is worth and how often it crits. */
function LaserStats() {
  const hit = useGame((s) => hitEnergy(s.game))
  const chance = useGame((s) => critChance(s.game))
  const multiplier = useGame((s) => critMultiplier(s.game))
  return (
    <span className="text-xs font-semibold tracking-normal text-white/60 normal-case tabular-nums">
      {formatNumber(hit, { decimals: 1 })}/hit · {formatNumber(chance * 100)}% crit ×
      {formatNumber(multiplier, { decimals: 1 })}
    </span>
  )
}

const heading =
  'sticky top-0 z-10 flex items-baseline justify-between gap-3 border-y border-panel-line bg-space/85 px-4 py-3 text-sm font-bold tracking-widest uppercase backdrop-blur first:border-t-0'

export function UpgradePanel() {
  const [panel, setPanel] = useState<'reactors' | 'arsenal'>('reactors')
  return (
    <section
      aria-label="Upgrades"
      className="panel flex min-h-0 w-full flex-col overflow-hidden max-lg:max-h-[38dvh] lg:max-h-full"
    >
      <nav
        aria-label="Upgrade systems"
        className="grid shrink-0 grid-cols-2 gap-1 border-b border-panel-line p-1.5"
      >
        <button
          type="button"
          aria-pressed={panel === 'reactors'}
          onClick={() => setPanel('reactors')}
          className={cn(
            'cursor-pointer rounded-xl py-2 text-sm font-semibold transition-colors',
            panel === 'reactors' ? 'bg-white/12 text-energy' : 'text-white/50 hover:bg-white/5',
          )}
        >
          Reactors
        </button>
        <button
          type="button"
          aria-pressed={panel === 'arsenal'}
          onClick={() => setPanel('arsenal')}
          className={cn(
            'cursor-pointer rounded-xl py-2 text-sm font-semibold transition-colors',
            panel === 'arsenal' ? 'bg-white/12 text-crystal' : 'text-white/50 hover:bg-white/5',
          )}
        >
          Arsenal <span className="ml-1 rounded bg-crystal/10 px-1.5 text-xs text-crystal">7</span>
        </button>
      </nav>
      <div className="scrollbar-thin min-h-0 overflow-y-auto">
        <h2 className={heading}>
          Mining laser
          <LaserStats />
        </h2>
        <ul className="divide-y divide-panel-line">
          {LASER_UPGRADES.map((upgrade) => (
            <LaserRow key={upgrade.id} upgrade={upgrade} />
          ))}
        </ul>
        {panel === 'arsenal' ? (
          <>
            <h2 className={heading}>
              Weapon arsenal{' '}
              <span className="text-xs font-normal tracking-normal text-white/45 normal-case">
                Equip one system
              </span>
            </h2>
            <Arsenal />
          </>
        ) : (
          <>
            <h2 className={heading}>Reactors</h2>
            <ul className="divide-y divide-panel-line">
              {UPGRADES.map((upgrade) => (
                <UpgradeRow key={upgrade.id} upgrade={upgrade} />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}
