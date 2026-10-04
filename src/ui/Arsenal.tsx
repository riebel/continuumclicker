import { Crosshair, Flame, Orbit, Radio, Rocket, Snowflake, Zap } from 'lucide-react'
import { WEAPON_MAX_LEVEL, WEAPON_SYSTEMS, WEAPONS, type WeaponDef } from '../game/content'
import { weaponCost } from '../game/engine'
import { formatNumber } from '../game/format'
import { useActions, useGame } from '../game/store'
import { cn } from './cn'

export const WEAPON_ICONS = {
  pulse: Crosshair,
  plasma: Flame,
  railgun: Zap,
  tesla: Radio,
  cryo: Snowflake,
  swarm: Rocket,
  singularity: Orbit,
}

function WeaponCard({ weapon }: { weapon: WeaponDef }) {
  const level = useGame((s) => s.game.weapons[weapon.id])
  const cost = weaponCost(weapon, level)
  const affordable = useGame((s) => s.game.energy >= cost)
  const { buyWeapon } = useActions()
  const maxed = weapon.id === 'pulse' || level >= WEAPON_MAX_LEVEL
  const Icon = WEAPON_ICONS[weapon.id]
  const system = WEAPON_SYSTEMS[weapon.id]

  return (
    <li
      className={cn(
        'border-l-2 px-4 py-3 transition-colors',
        level > 0 ? 'bg-white/8' : 'border-transparent',
      )}
      style={level > 0 ? { borderColor: weapon.color } : undefined}
    >
      <div className="flex items-center gap-2">
        <Icon className="size-5 shrink-0" style={{ color: weapon.color }} aria-hidden="true" />
        <span className="flex-1 font-semibold">{weapon.name}</span>
        <span className="text-xs text-white/50">{level > 0 ? `L${level}` : 'Locked'}</span>
      </div>
      <p
        className="mt-1 text-xs font-bold tracking-wider uppercase"
        style={{ color: weapon.color }}
      >
        {weapon.tag}
      </p>
      <p className="mt-1 text-sm leading-snug text-white/55">{weapon.effect}</p>
      <p className="mt-1 text-xs text-white/45">
        {system.mount} · {system.cadence === 1 ? 'Every volley' : `Every ${system.cadence} volleys`}
      </p>
      <div className="mt-2 flex gap-2 text-xs font-semibold">
        {level > 0 && <span className="self-center text-white/55">Installed · auto fire</span>}
        {!maxed && (
          <button
            type="button"
            aria-disabled={!affordable}
            onClick={() => affordable && buyWeapon(weapon.id)}
            className={cn(
              'min-h-8 flex-1 rounded-lg border px-2',
              affordable
                ? 'cursor-pointer border-energy/30 text-energy hover:bg-energy/10'
                : 'cursor-not-allowed border-white/10 text-white/35',
            )}
          >
            {level === 0 ? 'Install' : 'Upgrade'} · {formatNumber(cost, { notation: 'short' })}
            <span className="sr-only"> energy, {weapon.name}</span>
          </button>
        )}
        {maxed && weapon.id !== 'pulse' && (
          <span className="self-center text-white/40">Fully upgraded</span>
        )}
      </div>
    </li>
  )
}

export function Arsenal() {
  return (
    <ul className="divide-y divide-panel-line">
      {WEAPONS.map((weapon) => (
        <WeaponCard key={weapon.id} weapon={weapon} />
      ))}
    </ul>
  )
}
