import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { sectorFor } from './game/sector'
import { gameStore } from './game/store'
import { asteroidOnScreen } from './scene/target'

// jsdom has no WebGL; the 3D scene is covered by the browser checks.
vi.mock('./scene/ShipScene', () => ({ default: () => null }))

const setEnergy = (energy: number) => gameStore.setState((s) => ({ game: { ...s.game, energy } }))

describe('App', () => {
  beforeEach(() => gameStore.getState().actions.reset())

  it('mines the asteroid when the stage is clicked', async () => {
    const user = userEvent.setup()
    render(<App />)
    const stage = screen.getByRole('button', { name: /fire the mining laser/i })

    await user.click(stage)
    await user.click(stage)

    expect(gameStore.getState().game.clicks).toBe(2)
    expect(gameStore.getState().game.energy).toBeGreaterThanOrEqual(2)
    expect(gameStore.getState().game.asteroid.hp).toBe(2)
  })

  it('keeps firing while the button is held', async () => {
    vi.useFakeTimers()
    try {
      render(<App />)
      const stage = screen.getByRole('button', { name: /fire the mining laser/i })
      fireEvent.pointerDown(stage, { button: 0, pointerId: 1 })
      vi.advanceTimersByTime(1000)
      fireEvent.pointerUp(stage, { button: 0, pointerId: 1 })
      vi.advanceTimersByTime(1000)
      expect(gameStore.getState().game.clicks).toBe(5)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the same firing surface through moving targets and multiple destructions', async () => {
    const user = userEvent.setup()
    render(<App />)
    const stage = screen.getByRole('button', { name: /fire the mining laser/i })
    try {
      asteroidOnScreen.visible = true
      for (let i = 0; i < 16; i++) {
        asteroidOnScreen.x = 300 + (i % 5) * 70
        asteroidOnScreen.y = 180 + (i % 3) * 50
        await user.click(stage)
        expect(screen.getByRole('button', { name: /fire the mining laser/i })).toBe(stage)
      }
      expect(gameStore.getState().game.clicks).toBe(16)
      expect(gameStore.getState().game.asteroidsMined).toBeGreaterThanOrEqual(2)
    } finally {
      asteroidOnScreen.visible = false
    }
  })

  it('anchors the target HUD to the viewport even inside a transformed, contained stage', () => {
    const { container } = render(
      <div style={{ transform: 'translateX(-50%)', containerType: 'size' }}>
        <App />
      </div>,
    )
    const hud = screen.getByTestId('asteroid-status')
    expect(hud.parentElement).toBe(document.body)
    expect(container.contains(hud)).toBe(false)
    expect(container.contains(screen.getByRole('button', { name: /fire the mining laser/i }))).toBe(
      true,
    )
  })

  it('collects a crystal lock from the normal firing surface without chasing a bonus target', async () => {
    const user = userEvent.setup()
    render(<App />)
    act(() => gameStore.setState({ vein: { id: 1, angle: 2, closesAt: Date.now() + 2500 } }))
    expect(screen.getByText('Crystal lock · next hit critical')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /fire the mining laser/i }))
    expect(gameStore.getState().lastShot?.critical).toBe(true)
    expect(gameStore.getState().vein).toBeNull()
    expect(gameStore.getState().game.clicks).toBe(1)
  })

  it('is playable with the keyboard', async () => {
    const user = userEvent.setup()
    render(<App />)
    screen.getByRole('button', { name: /fire the mining laser/i }).focus()

    await user.keyboard('{Enter}')

    expect(gameStore.getState().game.clicks).toBe(1)
  })

  it('catches a comet', async () => {
    const user = userEvent.setup()
    render(<App />)
    const now = Date.now()
    act(() => gameStore.setState({ comet: { id: 1, appearedAt: now, leavesAt: now + 13_000 } }))

    await user.click(await screen.findByRole('button', { name: /catch the comet/i }))

    expect(gameStore.getState().game.cometsCaught).toBe(1)
    expect(gameStore.getState().game.clicks).toBe(0) // The laser did not fire.
    expect(screen.queryByRole('button', { name: /catch the comet/i })).not.toBeInTheDocument()
  })

  it('strikes a crystal vein for a critical hit', async () => {
    const user = userEvent.setup()
    render(<App />)
    act(() => gameStore.setState({ vein: { id: 1, angle: 0, closesAt: Date.now() + 2500 } }))

    await user.click(await screen.findByRole('button', { name: /strike the crystal vein/i }))

    expect(gameStore.getState().lastShot?.critical).toBe(true)
    expect(gameStore.getState().game.clicks).toBe(1)
  })

  it('upgrades the mining laser', async () => {
    const user = userEvent.setup()
    render(<App />)
    setEnergy(60)

    await user.click(await screen.findByRole('button', { name: /laser amplifier/i }))

    expect(gameStore.getState().game.lasers['laser-amplifier']).toBe(1)
    expect(screen.getByText(/2\.0\/hit/)).toBeInTheDocument()
  })

  it('buys an upgrade only when it is affordable', async () => {
    const user = userEvent.setup()
    render(<App />)
    const engine = screen.getByRole('button', { name: /avidyne engine/i })
    expect(engine).toHaveAttribute('aria-disabled', 'true')

    await user.click(engine)
    expect(gameStore.getState().game.owned['avidyne-engine']).toBe(0)

    setEnergy(20)
    await user.click(await screen.findByRole('button', { name: /avidyne engine/i }))
    expect(gameStore.getState().game.owned['avidyne-engine']).toBe(1)
    expect(await screen.findByText('1×')).toBeInTheDocument()
    expect(screen.getAllByText('Ship module 1 of 5, next at 5 owned')).toHaveLength(1)
  })

  it('installs additional weapons and fires them automatically alongside the pulse', async () => {
    const user = userEvent.setup()
    render(<App />)
    setEnergy(5000)
    await user.click(screen.getByRole('button', { name: /Arsenal 7/i }))
    await user.click(screen.getByRole('button', { name: /Install.*Plasma devastator/i }))
    await user.click(screen.getByRole('button', { name: /Install.*Railgun/i }))
    expect(gameStore.getState().game.weapons.plasma).toBe(1)
    expect(screen.queryByLabelText('Active weapon')).not.toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: 'Plasma devastator, level 1, installed' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: 'Titan railgun, level 1, installed' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /fire the mining laser/i }))
    await user.click(screen.getByRole('button', { name: /fire the mining laser/i }))
    expect(gameStore.getState().lastShot?.salvo?.map((s) => s.weapon)).toEqual([
      'plasma',
      'railgun',
      'pulse',
    ])
    expect(gameStore.getState().game.weapons).toMatchObject({ pulse: 1, plasma: 1, railgun: 1 })
  })

  it('engages a speed level', async () => {
    const user = userEvent.setup()
    render(<App />)
    setEnergy(100)

    const helm = screen.getByRole('region', { name: 'Helm' })
    await user.click(within(helm).getByRole('button', { name: /⅛ impulse/ }))

    expect(within(helm).getByRole('button', { name: /⅛ impulse/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(helm).getByRole('button', { name: /full stop/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('sets course on the sector map', async () => {
    const user = userEvent.setup()
    render(<App />)
    act(() =>
      gameStore.setState((s) => ({
        game: { ...s.game, owned: { ...s.game.owned, 'driver-coil': 20 } },
      })),
    )

    await user.click(screen.getByRole('button', { name: 'Sector map' }))
    const map = screen.getByRole('dialog', { name: 'Sector map' })
    const target = sectorFor(gameStore.getState().game.sectorSeed).systems.find((s) => s.ring === 0)
    if (!target) throw new Error('the innermost ring is never empty')
    await user.click(within(map).getByRole('button', { name: target.name }))
    await user.click(within(map).getByRole('button', { name: /set course/i }))

    const { game } = gameStore.getState()
    expect(game.course?.to).toBe(target.id)
    expect(game.speedLevel).toBeGreaterThan(0) // Engines engaged automatically.
    expect(await screen.findByText(new RegExp(`En route to ${target.name}`))).toBeInTheDocument()
  })

  it('resets progress after confirmation', async () => {
    const user = userEvent.setup()
    render(<App />)
    setEnergy(1234)

    await user.click(screen.getByRole('button', { name: 'Menu' }))
    await user.click(screen.getByRole('button', { name: /reset progress/i }))
    await user.click(screen.getByRole('button', { name: 'Reset' }))

    expect(gameStore.getState().game.energy).toBe(0)
  })
})
