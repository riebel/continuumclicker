import { SHIP_FORMS, WEAPONS } from '../game/content'
import { shipForm, shipModuleTiers } from '../game/engine'
import { useActions, useGame } from '../game/store'

export function ShipStatus() {
  const formIndex = useGame((s) => shipForm(s.game))
  const tiers = useGame((s) => shipModuleTiers(s.game))
  const active = useGame((s) => s.game.activeWeapon)
  const weapons = useGame((s) => s.game.weapons)
  const charge = useGame((s) => s.game.weaponCharge)
  const frozen = useGame((s) => s.game.frozen)
  const { selectWeapon } = useActions()
  const form = SHIP_FORMS[formIndex] ?? SHIP_FORMS[0]
  const next = SHIP_FORMS[formIndex + 1]
  const weapon = WEAPONS.find((w) => w.id === active) ?? WEAPONS[0]
  const chargeLabel =
    active === 'plasma'
      ? `Overcharge ${charge % 3}/3`
      : active === 'singularity'
        ? `Collapse ${charge % 4}/4`
        : active === 'cryo'
          ? frozen
            ? 'Shatter ready'
            : 'Freeze ready'
          : weapon.tag

  return (
    <div className="panel w-full max-w-sm px-3 py-2">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-bold tracking-widest text-crystal uppercase">
          {form.name} <span className="text-white/35">MK {formIndex + 1}</span>
        </span>
        <span className="text-white/45">
          {next ? `${tiers}/${next.tiers} refit stages` : 'Evolution complete'}
        </span>
      </div>
      <div className="mt-1 flex gap-1" aria-hidden="true">
        {SHIP_FORMS.slice(1).map((f) => (
          <span
            key={f.name}
            className={`h-1 flex-1 rounded-full ${tiers >= f.tiers ? 'bg-crystal' : 'bg-white/10'}`}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <select
          aria-label="Active weapon"
          value={active}
          onChange={(event) => {
            const found = WEAPONS.find((w) => w.id === event.target.value)
            if (found) selectWeapon(found.id)
          }}
          className="min-w-0 cursor-pointer rounded bg-space px-1 py-1 text-sm font-semibold"
          style={{ color: weapon.color }}
        >
          {WEAPONS.map((w) => (
            <option key={w.id} value={w.id} disabled={!weapons[w.id]}>
              {w.name}
              {!weapons[w.id] ? ' · locked' : ''}
            </option>
          ))}
        </select>
        <span className="shrink-0 text-xs text-white/55">{chargeLabel}</span>
      </div>
      <p className="mt-1 text-xs text-white/40">
        {next ? `Next: ${next.name} · ${next.detail}` : form.detail}
      </p>
    </div>
  )
}
