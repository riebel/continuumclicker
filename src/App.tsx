import { Gauge, Zap } from 'lucide-react'
import { useRef, useState } from 'react'
import { useGame } from './game/store'
import { BossHud } from './ui/BossHud'
import { cn } from './ui/cn'
import { EnergyReadout, FlightReadout } from './ui/Hud'
import { Menu } from './ui/Menu'
import { Notices } from './ui/Notices'
import { SectorMapButton } from './ui/SectorMap'
import { ShipStage, supportsWebGL } from './ui/ShipStage'
import { ShipStatus } from './ui/ShipStatus'
import { SpeedPanel } from './ui/SpeedPanel'
import { type SceneState, Stage } from './ui/Stage'
import { UpgradePanel } from './ui/UpgradePanel'
import { useGameLoop } from './ui/useGameLoop'

type Tab = 'upgrades' | 'helm'

const TABS = [
  { id: 'upgrades', label: 'Upgrades', icon: Zap },
  { id: 'helm', label: 'Helm', icon: Gauge },
] as const

export function App() {
  useGameLoop()
  const bossPresent = useGame((s) => s.boss !== null)
  // On small screens only one panel fits; on large screens both are always visible.
  const [tab, setTab] = useState<Tab>('upgrades')
  const shipRef = useRef<HTMLButtonElement>(null)
  const [scene, setScene] = useState<SceneState>(() =>
    supportsWebGL() ? 'loading' : 'unavailable',
  )

  return (
    <>
      {scene !== 'unavailable' && (
        <ShipStage
          anchor={shipRef}
          onReady={() => setScene('ready')}
          onUnavailable={() => setScene('unavailable')}
        />
      )}
      <main className="relative z-10 flex h-dvh flex-col gap-3 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:grid lg:grid-cols-[minmax(17rem,22rem)_1fr_minmax(17rem,22rem)] lg:grid-rows-[minmax(0,1fr)] lg:gap-6 lg:p-6">
        <div
          className={cn(
            'flex min-h-0 items-start',
            tab !== 'upgrades' && 'max-lg:hidden',
            bossPresent && 'max-lg:max-h-[15dvh]',
          )}
        >
          <UpgradePanel />
        </div>

        <section className="relative flex min-h-0 flex-1 flex-col items-center justify-between gap-2 max-lg:order-first">
          <div className="absolute top-0 right-0 z-10 flex flex-col gap-2 lg:flex-row">
            <SectorMapButton />
            <Menu />
          </div>
          <EnergyReadout />
          <div className="flex min-h-0 w-full flex-1 items-center justify-center [container-type:size]">
            <Stage ref={shipRef} scene={scene} />
          </div>
          {bossPresent ? <BossHud /> : <ShipStatus />}
          <div className={bossPresent ? 'max-lg:hidden' : undefined}>
            <FlightReadout />
          </div>
        </section>

        <div
          className={cn(
            'flex min-h-0 items-start',
            tab !== 'helm' && 'max-lg:hidden',
            bossPresent && 'max-lg:max-h-[15dvh]',
          )}
        >
          <SpeedPanel />
        </div>

        <nav aria-label="Panels" className="panel grid grid-cols-2 p-1 lg:hidden">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                'flex cursor-pointer items-center justify-center gap-2 rounded-xl py-2 font-semibold transition-colors',
                tab === id ? 'bg-white/15 text-white' : 'text-white/60',
              )}
            >
              <Icon aria-hidden="true" className="size-4" />
              {label}
            </button>
          ))}
        </nav>
      </main>
      <Notices />
    </>
  )
}
