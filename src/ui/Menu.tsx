import { CodeXml, RotateCcw, Save, Settings, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { formatAstronomical, formatNumber } from '../game/format'
import { useActions, useGame } from '../game/store'

const REPOSITORY_URL = 'https://github.com/riebel/continuumclicker'

function Stats() {
  const clicks = useGame((s) => s.game.clicks)
  const mined = useGame((s) => s.game.asteroidsMined)
  const comets = useGame((s) => s.game.cometsCaught)
  const lifetime = useGame((s) => s.game.lifetimeEnergy)
  const distance = useGame((s) => s.game.distance)
  const rows = [
    ['Laser shots', formatNumber(clicks)],
    ['Asteroids mined', formatNumber(mined)],
    ['Comets caught', formatNumber(comets)],
    ['Energy generated', formatNumber(lifetime)],
    ['Distance', `${formatNumber(distance)} km`],
    ['Deep-space distance', formatAstronomical(distance)],
  ]
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 tabular-nums">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-white/60">{label}</dt>
          <dd className="text-right font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Menu() {
  const dialog = useRef<HTMLDialogElement>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const actions = useActions()

  const close = () => dialog.current?.close()

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setConfirmReset(false)
          dialog.current?.showModal()
        }}
        className="panel cursor-pointer p-2.5 text-white/80 transition-colors hover:text-white"
      >
        <Settings aria-hidden="true" className="size-5" />
        <span className="sr-only">Menu</span>
      </button>

      <dialog
        ref={dialog}
        aria-labelledby="menu-title"
        closedby="any"
        className="panel m-auto w-[min(92vw,24rem)] bg-space/95 p-6 text-white shadow-2xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="menu-title" className="text-xl font-bold">
            Captain's log
          </h2>
          <button
            type="button"
            onClick={close}
            className="-m-1 cursor-pointer rounded-md p-1 text-white/60 hover:text-white"
          >
            <X aria-hidden="true" className="size-5" />
            <span className="sr-only">Close</span>
          </button>
        </div>

        <Stats />

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => {
              actions.save({ announce: true })
              close()
            }}
            className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 font-semibold hover:bg-white/15"
          >
            <Save aria-hidden="true" className="size-4" /> Save now
          </button>

          {confirmReset ? (
            <div className="rounded-xl border border-danger/40 p-3">
              <p className="mb-3 text-sm">
                Erase all progress and start over? This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="flex-1 cursor-pointer rounded-lg bg-white/10 px-3 py-2 font-semibold hover:bg-white/15"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    actions.reset()
                    close()
                  }}
                  className="flex-1 cursor-pointer rounded-lg bg-danger px-3 py-2 font-semibold text-space hover:bg-danger/90"
                >
                  Reset
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="flex cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold text-danger hover:bg-danger/10"
            >
              <RotateCcw aria-hidden="true" className="size-4" /> Reset progress
            </button>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-white/50">
          Progress is saved automatically in this browser.
          <br />
          <a
            href={REPOSITORY_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 underline-offset-4 hover:text-white hover:underline"
          >
            <CodeXml aria-hidden="true" className="size-4" /> Source on GitHub
          </a>
        </p>
      </dialog>
    </>
  )
}
