import { MapIcon, Navigation, X } from 'lucide-react'
import { useRef, useState } from 'react'
import {
  ASTRONOMICAL_UNIT_KM,
  LIGHT_YEAR_KM,
  MODULE_SLOTS,
  MODULES,
  type ModuleId,
  SPEED_LEVELS,
  type SystemKind,
  VISITS,
} from '../game/content'
import {
  fastestSustainable,
  type GameState,
  isScanned,
  position,
  production,
  travelSeconds,
} from '../game/engine'
import { formatDistance, formatDuration, formatNumber } from '../game/format'
import { distanceBetween, findSystem, type StarSystem, sectorFor } from '../game/sector'
import { useActions, useGame } from '../game/store'
import { cn } from './cn'

// The map is logarithmic: a moon a million km away and a star light-years away both fit.
const MIN_LOG = 5
const MAX_LOG = Math.log10(6e13)
const INNER = 7
const OUTER = 92

function mapRadius(km: number): number {
  if (km <= 0) return 0
  const t = (Math.log10(Math.max(km, 10 ** MIN_LOG)) - MIN_LOG) / (MAX_LOG - MIN_LOG)
  return INNER + Math.min(1, t) * (OUTER - INNER)
}

function toMap({ x, y }: { x: number; y: number }) {
  const r = mapRadius(Math.hypot(x, y))
  const angle = Math.atan2(y, x)
  return { x: Math.cos(angle) * r, y: -Math.sin(angle) * r }
}

const GUIDES = [
  [1e6, '1M km'],
  [ASTRONOMICAL_UNIT_KM, '1 AU'],
  [10 * ASTRONOMICAL_UNIT_KM, '10 AU'],
  [100 * ASTRONOMICAL_UNIT_KM, '100 AU'],
  [LIGHT_YEAR_KM, '1 light-year'],
] as const

const KINDS: Record<SystemKind, { label: string; about: string; color: string }> = {
  home: { label: 'Home base', about: 'Continuum Station, where it all began.', color: '#ffffff' },
  belt: {
    label: 'Asteroid belt',
    about: `While docked, hits are worth ×${VISITS.beltHitMultiplier} and crystal asteroids are ×${VISITS.beltCrystalChance} as common.`,
    color: '#f5c542',
  },
  world: {
    label: 'Inhabited world',
    about: 'Traders here sell rare ship modules.',
    color: '#6ee7a8',
  },
  derelict: {
    label: 'Derelict station',
    about: 'Salvage crews can strip it for energy on the first visit.',
    color: '#a8a29e',
  },
  anomaly: {
    label: 'Anomaly',
    about: 'The readings make no sense. Only a visit will tell.',
    color: '#c084fc',
  },
}

const moduleName = (id: ModuleId) => MODULES.find((m) => m.id === id)?.name ?? id

/** Travel time to a system at the fastest speed the reactors can hold. */
function tripLabel(game: GameState, system: StarSystem): string {
  const level = fastestSustainable(game)
  const seconds = travelSeconds(game, system, level)
  if (!Number.isFinite(seconds)) return 'Reactors cannot sustain any speed yet'
  return `${formatDuration(Math.max(1, seconds))} at ${SPEED_LEVELS[level]?.name ?? ''}`
}

function Marker({
  system,
  scanned,
  selected,
  here,
  onSelect,
}: {
  system: StarSystem
  scanned: boolean
  selected: boolean
  here: boolean
  onSelect(): void
}) {
  const { x, y } = toMap(system)
  const color = scanned ? KINDS[system.kind].color : '#94a3b8'
  const size = system.kind === 'home' ? 2.6 : 2.2
  return (
    // biome-ignore lint/a11y/useSemanticElements: an SVG group cannot be a <button>
    <g
      role="button"
      tabIndex={0}
      aria-label={scanned ? system.name : 'Unknown signal'}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
      className="cursor-pointer outline-none [&:focus-visible>circle:first-child]:stroke-energy"
      transform={`translate(${x} ${y})`}
    >
      <circle
        r={6}
        fill="transparent"
        stroke={selected ? '#f5c542' : 'transparent'}
        strokeWidth={0.5}
      />
      {here && (
        <circle r={4} fill="none" stroke="#ffffff" strokeWidth={0.4} strokeDasharray="1 1" />
      )}
      {scanned ? (
        system.kind === 'belt' ? (
          <rect
            x={-size}
            y={-size}
            width={size * 2}
            height={size * 2}
            fill={color}
            transform="rotate(45)"
          />
        ) : system.kind === 'derelict' ? (
          <rect x={-size} y={-size} width={size * 2} height={size * 2} fill={color} />
        ) : system.kind === 'home' ? (
          <circle r={size} fill="none" stroke={color} strokeWidth={0.8} />
        ) : (
          <circle r={size} fill={color} />
        )
      ) : (
        <circle r={1.2} fill={color} opacity={0.6} />
      )}
      <text
        y={-4.2}
        textAnchor="middle"
        fontSize={4.4}
        fontWeight={600}
        fill={scanned ? '#e2e8f0' : '#94a3b8'}
        className="pointer-events-none select-none"
      >
        {scanned ? system.name : '?'}
      </text>
    </g>
  )
}

function Details({ system }: { system: StarSystem }) {
  const actions = useActions()
  const game = useGame((s) => s.game)
  const scanned = isScanned(game, system)
  const here = game.location === system.id
  const heading = game.course?.to === system.id
  const visited = game.visited.includes(system.id)
  const distance = distanceBetween(position(game), system)
  const reward = Math.max(VISITS.firstVisitMinimum, production(game) * VISITS.firstVisitSeconds)

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-lg font-bold">{scanned ? system.name : 'Unknown signal'}</h3>
        <p className="text-sm text-white/60">
          {scanned
            ? `${KINDS[system.kind].label} · ${KINDS[system.kind].about}`
            : 'Too far for the scanners. Faster engines extend their range.'}
        </p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm tabular-nums">
        <dt className="text-white/60">Distance</dt>
        <dd>{here ? 'You are here' : formatDistance(distance)}</dd>
        {!here && (
          <>
            <dt className="text-white/60">Trip</dt>
            <dd>{tripLabel(game, system)}</dd>
          </>
        )}
        <dt className="text-white/60">Status</dt>
        <dd>
          {visited
            ? 'Visited'
            : `Not visited yet · first visit +${formatNumber(reward, { notation: 'short' })} energy`}
        </dd>
        {scanned && !visited && system.kind === 'derelict' && (
          <>
            <dt className="text-white/60">Scan</dt>
            <dd>{system.find ? 'Module signature detected' : 'Scrap and power cells'}</dd>
          </>
        )}
      </dl>

      {scanned && system.offers.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-bold tracking-widest text-white/60 uppercase">
            Traders
          </h4>
          <ul className="flex flex-col gap-1">
            {system.offers.map((offer) => {
              const owned = game.modules.includes(offer.module)
              const affordable = here && !owned && game.energy >= offer.price
              return (
                <li key={offer.module} className="rounded-lg bg-white/5 p-2 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{moduleName(offer.module)}</span>
                    <span className="tabular-nums">
                      {formatNumber(offer.price, { notation: 'short' })}
                    </span>
                  </div>
                  <p className="text-white/60">
                    {MODULES.find((m) => m.id === offer.module)?.effect}
                  </p>
                  <button
                    type="button"
                    aria-disabled={!affordable}
                    onClick={() => affordable && actions.buyModule(offer.module)}
                    className={cn(
                      'mt-1 w-full rounded-md px-2 py-1 font-semibold',
                      affordable
                        ? 'cursor-pointer bg-ok/20 text-ok hover:bg-ok/30'
                        : 'cursor-not-allowed bg-white/5 text-white/40',
                    )}
                  >
                    {owned
                      ? 'Owned'
                      : here
                        ? `Buy ${moduleName(offer.module)}`
                        : 'Dock here to trade'}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <button
        type="button"
        aria-disabled={here || heading}
        onClick={() => !here && !heading && actions.setCourse(system.id)}
        className={cn(
          'flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold',
          here || heading
            ? 'cursor-default bg-white/5 text-white/50'
            : 'cursor-pointer bg-energy text-space hover:bg-energy/90',
        )}
      >
        <Navigation aria-hidden="true" className="size-4" />
        {here ? 'Docked here' : heading ? 'On course' : 'Set course'}
      </button>
    </div>
  )
}

function ModuleBay() {
  const actions = useActions()
  const owned = useGame((s) => s.game.modules)
  const equipped = useGame((s) => s.game.equipped)

  return (
    <div>
      <h3 className="mb-1 text-xs font-bold tracking-widest text-white/60 uppercase">
        Module bay · {equipped.length}/{MODULE_SLOTS} fitted
      </h3>
      {owned.length === 0 ? (
        <p className="text-sm text-white/50">
          Rare modules turn up at inhabited worlds, derelicts and anomalies.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {owned.map((id) => {
            const fitted = equipped.includes(id)
            const full = !fitted && equipped.length >= MODULE_SLOTS
            return (
              <li key={id} className="flex items-center gap-2 rounded-lg bg-white/5 p-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{moduleName(id)}</p>
                  <p className="text-white/60">{MODULES.find((m) => m.id === id)?.effect}</p>
                </div>
                <button
                  type="button"
                  aria-pressed={fitted}
                  aria-disabled={full}
                  onClick={() => (fitted ? actions.unequip(id) : !full && actions.equip(id))}
                  className={cn(
                    'shrink-0 rounded-md px-2.5 py-1 font-semibold',
                    fitted
                      ? 'cursor-pointer bg-energy/20 text-energy hover:bg-energy/30'
                      : full
                        ? 'cursor-not-allowed bg-white/5 text-white/40'
                        : 'cursor-pointer bg-white/10 hover:bg-white/15',
                  )}
                >
                  {fitted ? 'Fitted' : 'Fit'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function SectorMap() {
  const game = useGame((s) => s.game)
  const sector = sectorFor(game.sectorSeed)
  const [selectedId, setSelectedId] = useState(() => game.course?.to ?? game.location ?? 'home')
  const selected = findSystem(sector, selectedId) ?? sector.systems[0]
  const ship = toMap(position(game))
  const target = findSystem(sector, game.course?.to ?? null)

  return (
    <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(0,1fr)_20rem]">
      <svg
        viewBox="-100 -100 200 200"
        className="aspect-square max-h-full w-full self-center justify-self-center"
      >
        <title>Sector map</title>
        {GUIDES.map(([km, label]) => (
          <g key={label}>
            <circle
              r={mapRadius(km)}
              fill="none"
              stroke="rgb(200 200 255 / 0.12)"
              strokeWidth={0.3}
            />
            <text
              x={mapRadius(km) * Math.cos(Math.PI / 4) + 1}
              y={mapRadius(km) * Math.sin(Math.PI / 4) + 1}
              fontSize={3.2}
              fill="rgb(200 200 255 / 0.4)"
              className="select-none"
            >
              {label}
            </text>
          </g>
        ))}
        {target && (
          <line
            x1={ship.x}
            y1={ship.y}
            x2={toMap(target).x}
            y2={toMap(target).y}
            stroke="#f5c542"
            strokeWidth={0.5}
            strokeDasharray="1.5 1"
          />
        )}
        {sector.systems.map((system) => (
          <Marker
            key={system.id}
            system={system}
            scanned={isScanned(game, system)}
            selected={system.id === selected?.id}
            here={game.location === system.id}
            onSelect={() => setSelectedId(system.id)}
          />
        ))}
        {!game.location && (
          <g transform={`translate(${ship.x} ${ship.y})`} aria-label="Your ship">
            <circle r={1.6} fill="#f5c542" />
            <circle r={3} fill="none" stroke="#f5c542" strokeWidth={0.3} opacity={0.6} />
          </g>
        )}
      </svg>

      <div className="scrollbar-thin flex min-h-0 flex-col gap-5 overflow-y-auto pr-1">
        {selected && <Details system={selected} />}
        <ModuleBay />
      </div>
    </div>
  )
}

export function SectorMapButton() {
  const dialog = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          dialog.current?.showModal()
        }}
        className="panel cursor-pointer p-2.5 text-white/80 transition-colors hover:text-white"
      >
        <MapIcon aria-hidden="true" className="size-5" />
        <span className="sr-only">Sector map</span>
      </button>

      <dialog
        ref={dialog}
        aria-labelledby="map-title"
        closedby="any"
        onClose={() => setOpen(false)}
        className="panel m-auto h-[min(94dvh,46rem)] w-[min(96vw,68rem)] max-w-none bg-space/95 p-4 text-white shadow-2xl open:flex open:flex-col sm:p-6"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="map-title" className="text-xl font-bold">
            Sector map
          </h2>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="-m-1 cursor-pointer rounded-md p-1 text-white/60 hover:text-white"
          >
            <X aria-hidden="true" className="size-5" />
            <span className="sr-only">Close</span>
          </button>
        </div>
        {/* Only mounted while open: the map follows the ship every frame. */}
        {open && <SectorMap />}
      </dialog>
    </>
  )
}
