import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HoverPreviewController } from './hover-preview-controller'

describe('HoverPreviewController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('activates only after the configured dwell time', () => {
    const events: string[] = []
    const controller = new HoverPreviewController({
      delayMs: 600,
      key: (target: string) => target,
      onEnter: (target) => events.push(`enter:${target}`),
      onActivate: (target) => events.push(`activate:${target}`),
      onLeave: (target) => events.push(`leave:${target}`)
    })

    controller.enter('minion')
    vi.advanceTimersByTime(599)
    expect(events).toEqual(['enter:minion'])

    vi.advanceTimersByTime(1)
    expect(events).toEqual(['enter:minion', 'activate:minion'])
  })

  it('cancels a stale target when the pointer switches', () => {
    const events: string[] = []
    const controller = new HoverPreviewController({
      delayMs: 600,
      key: (target: string) => target,
      onEnter: (target) => events.push(`enter:${target}`),
      onActivate: (target) => events.push(`activate:${target}`),
      onLeave: (target) => events.push(`leave:${target}`)
    })

    controller.enter('minion')
    vi.advanceTimersByTime(150)
    controller.enter('weapon')
    vi.advanceTimersByTime(600)

    expect(events).toEqual([
      'enter:minion',
      'leave:minion',
      'enter:weapon',
      'activate:weapon'
    ])
  })

  it('ignores late leave events from a previous target', () => {
    const events: string[] = []
    const controller = new HoverPreviewController({
      delayMs: 600,
      key: (target: string) => target,
      onEnter: (target) => events.push(`enter:${target}`),
      onActivate: (target) => events.push(`activate:${target}`),
      onLeave: (target) => events.push(`leave:${target}`)
    })

    controller.enter('minion')
    controller.enter('weapon')
    controller.leave('minion')
    vi.advanceTimersByTime(600)

    expect(events).toEqual([
      'enter:minion',
      'leave:minion',
      'enter:weapon',
      'activate:weapon'
    ])
  })

  it('clears the active target and pending timer when disposed', () => {
    const events: string[] = []
    const controller = new HoverPreviewController({
      delayMs: 600,
      key: (target: string) => target,
      onEnter: (target) => events.push(`enter:${target}`),
      onActivate: (target) => events.push(`activate:${target}`),
      onLeave: (target) => events.push(`leave:${target}`)
    })

    controller.enter('quest')
    controller.dispose()
    vi.advanceTimersByTime(600)

    expect(controller.currentKey()).toBeNull()
    expect(events).toEqual(['enter:quest', 'leave:quest'])
  })
})
