import { describe, expect, it } from 'vitest'
import {
  createCardAddFlightPath,
  resolveCardAddFlightPoint,
  resolveCardAddScrollOffset
} from './card-add-flight'

describe('collection card add flight', () => {
  it('starts and ends at the requested positions with an upward arch', () => {
    const path = createCardAddFlightPath({ x: 400, y: 700 }, { x: 1550, y: 300 })

    expect(resolveCardAddFlightPoint(path, 0)).toEqual({ x: 400, y: 700 })
    expect(resolveCardAddFlightPoint(path, 1)).toEqual({ x: 1550, y: 300 })
    expect(path.control.y).toBeLessThan(300)
  })

  it('clamps progress to the path endpoints', () => {
    const path = createCardAddFlightPath({ x: 10, y: 20 }, { x: 30, y: 40 })

    expect(resolveCardAddFlightPoint(path, -1)).toEqual({ x: 10, y: 20 })
    expect(resolveCardAddFlightPoint(path, 2)).toEqual({ x: 30, y: 40 })
  })

  it('only scrolls enough to expose a clipped destination row', () => {
    const common = {
      viewportTop: 132,
      viewportHeight: 100,
      contentOffset: 0,
      maxScroll: 200,
      rowHeight: 33
    }

    expect(resolveCardAddScrollOffset({ ...common, rowTop: 150 })).toBe(0)
    expect(resolveCardAddScrollOffset({ ...common, rowTop: 230 })).toBe(-31)
    expect(
      resolveCardAddScrollOffset({ ...common, contentOffset: -80, rowTop: 170 })
    ).toBe(-38)
  })
})
