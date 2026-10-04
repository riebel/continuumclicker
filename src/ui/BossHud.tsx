import { Radio, Shield, Swords } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { BOSS_RULES, BOSS_TYPES, bossExposed, bossPhase } from '../game/bosses'
import { formatNumber } from '../game/format'
import { useActions, useGame } from '../game/store'
import { bossOnScreen } from '../scene/target'
import { cn } from './cn'

/** The combat HUD stays anchored to the stage; the weak-point lock follows the native model. */
export function BossHud() {
  const boss = useGame((s) => s.boss)
  const { retreatBoss } = useActions()
  const lock = useRef<HTMLDivElement>(null)
  const present = boss !== null
  useEffect(() => {
    if (!present) return
    let frame = requestAnimationFrame(function follow() {
      if (lock.current) {
        const { x, y, radius, visible } = bossOnScreen
        lock.current.style.display = visible ? 'block' : 'none'
        lock.current.style.transform = `translate(${x}px, ${y}px)`
        lock.current.style.width = `${Math.max(24, radius * 2.5)}px`
        lock.current.style.height = `${Math.max(24, radius * 2.5)}px`
      }
      frame = requestAnimationFrame(follow)
    })
    return () => cancelAnimationFrame(frame)
  }, [present])
  if (!boss) return null
  const definition = BOSS_TYPES[boss.kind]
  const warning = boss.stage === 'warning'
  const fighting = boss.stage === 'combat'
  const charging = fighting && boss.attackIn <= 2.3
  const exposed = bossExposed(boss)
  const Icon = warning ? Radio : Swords
  return (
    <>
      <div
        data-testid="boss-hud"
        className="relative z-20 w-full max-w-[26rem] shrink-0 rounded-xl border border-white/15 bg-space/85 p-3 text-white shadow-xl backdrop-blur-md"
        style={{ borderColor: `${definition.color}55` }}
      >
        <div className="flex items-center gap-2">
          <Icon
            className="size-4 shrink-0"
            style={{ color: definition.color }}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{definition.name}</p>
            <p className="text-[9px] tracking-[.15em] text-white/50 uppercase">
              {definition.class} · Threat {boss.rank}
            </p>
          </div>
          {(warning || fighting) && (
            <button
              type="button"
              onClick={retreatBoss}
              className="min-h-9 cursor-pointer rounded-lg border border-white/20 px-2 text-[10px] font-semibold text-white/65 hover:bg-white/10"
            >
              Disengage
            </button>
          )}
        </div>
        {warning ? (
          <p className="mt-2 text-xs" style={{ color: definition.color }}>
            Interception in {Math.ceil(BOSS_RULES.warningSeconds - boss.age)}s · Weapons acquiring
          </p>
        ) : fighting ? (
          <>
            <div className="mt-2 flex items-center justify-between text-[10px] text-white/65">
              <span>
                Phase {bossPhase(boss)} / 3 ·{' '}
                {boss.kind === 'dreadnought' ? 'Velocity matched' : 'Rift tether'}
              </span>
              <span>
                {formatNumber(Math.ceil(boss.hp))} / {formatNumber(boss.maxHp)}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="Boss hull integrity"
              aria-valuemin={0}
              aria-valuemax={boss.maxHp}
              aria-valuenow={Math.ceil(boss.hp)}
              className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-white/10"
            >
              <div
                className="h-full transition-[width] duration-150"
                style={{ width: `${(boss.hp / boss.maxHp) * 100}%`, background: definition.color }}
              />
              <span className="absolute top-0 bottom-0 left-[32%] border-l border-space" />
              <span className="absolute top-0 bottom-0 left-[68%] border-l border-space" />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-[10px]">
              <span className="flex items-center gap-1 text-sky-200/80">
                <Shield className="size-3" aria-hidden="true" /> Shields {boss.shield}%
              </span>
              <span className={charging ? 'font-bold text-red-300' : 'text-white/55'}>
                {boss.combatAge > 80
                  ? `Disengage in ${Math.ceil(BOSS_RULES.combatLimit - boss.combatAge)}s`
                  : boss.chilled > 0
                    ? 'Target slowed'
                    : charging
                      ? `${definition.attack} charging`
                      : `${definition.attack} · ${Math.ceil(boss.attackIn)}s`}
              </span>
            </div>
          </>
        ) : (
          <p
            role="status"
            className="mt-2 text-xs font-semibold"
            style={{ color: definition.color }}
          >
            {boss.stage === 'victory'
              ? `Bounty secured · +${formatNumber(boss.reward)} energy`
              : 'Contact evaded · mining resumed'}
          </p>
        )}
      </div>
      {createPortal(
        <div
          ref={lock}
          className={cn(
            'pointer-events-none fixed top-0 left-0 z-20 hidden',
            exposed ? 'text-energy' : 'text-white/55',
          )}
          aria-hidden="true"
        >
          <div className="absolute inset-0 -translate-1/2">
            <span className="absolute top-0 left-0 size-2 border-t border-l" />
            <span className="absolute top-0 right-0 size-2 border-t border-r" />
            <span className="absolute bottom-0 left-0 size-2 border-b border-l" />
            <span className="absolute bottom-0 right-0 size-2 border-b border-r" />
            <span className="absolute top-full left-1/2 mt-1 w-max -translate-x-1/2 text-[8px] font-bold tracking-widest uppercase">
              {exposed ? 'Weak point exposed' : 'Weapons locked'}
            </span>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
