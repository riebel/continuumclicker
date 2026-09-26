import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from './App'
import { gameStore } from './game/store'

const setEnergy = (energy: number) => gameStore.setState((s) => ({ game: { ...s.game, energy } }))

describe('App', () => {
  beforeEach(() => gameStore.getState().actions.reset())

  it('generates energy when the ship is clicked', async () => {
    const user = userEvent.setup()
    render(<App />)
    const ship = screen.getByRole('button', { name: /feed the reactors/i })

    await user.click(ship)
    await user.click(ship)

    expect(gameStore.getState().game.clicks).toBe(2)
    expect(gameStore.getState().game.energy).toBeGreaterThanOrEqual(2)
  })

  it('is playable with the keyboard', async () => {
    const user = userEvent.setup()
    render(<App />)
    screen.getByRole('button', { name: /feed the reactors/i }).focus()

    await user.keyboard('{Enter}')

    expect(gameStore.getState().game.clicks).toBe(1)
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
