import { SHIP_FORMS, WEAPONS } from '../game/content'
import { shipForm, shipModuleTiers } from '../game/engine'
import { useGame } from '../game/store'
import { WEAPON_ICONS } from './Arsenal'

export function ShipStatus() {
  const formIndex = useGame((s) => shipForm(s.game))
  const tiers = useGame((s) => shipModuleTiers(s.game))
  const weapons = useGame((s) => s.game.weapons)
  const form = SHIP_FORMS[formIndex] ?? SHIP_FORMS[0]
  const next = SHIP_FORMS[formIndex + 1]
  const installed = WEAPONS.filter((w) => weapons[w.id] > 0)

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
        <fieldset className="flex flex-wrap gap-2" aria-label="Installed weapons">
          {installed.map((w) => {
            const Icon = WEAPON_ICONS[w.id]
            return (
              <span
                role="img"
                key={w.id}
                title={`${w.name} · L${weapons[w.id]} · auto fire`}
                aria-label={`${w.name}, level ${weapons[w.id]}, installed`}
                className="flex items-center gap-0.5 text-[10px]"
                style={{ color: w.color }}
              >
                <Icon className="size-4" aria-hidden="true" />
                {weapons[w.id]}
              </span>
            )
          })}
        </fieldset>
        <span className="shrink-0 text-xs text-white/55">Auto fire</span>
      </div>
      <p className="mt-1 text-xs text-white/40">
        {next ? `Next: ${next.name} · ${next.detail}` : form.detail}
      </p>
    </div>
  )
}
