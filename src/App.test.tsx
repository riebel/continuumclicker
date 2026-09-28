import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { gameStore } from './game/store'

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
