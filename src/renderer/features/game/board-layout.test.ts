import { describe, expect, it } from 'vitest'
import {
  isInDropZone,
  layoutBoardRow,
  resolveBoardInsertionIndex,
  type BoardRowConfig
} from './board-layout'

const config: BoardRowConfig = {
  centerX: 960,
  baselineY: 655,
  maxSpan: 500,
  maxStep: 130,
  minionScale: 0.85
}

describe('board layout', () => {
  it('centers every row symmetrically and keeps y/scale constant', () => {
    for (let count = 1; count <= 7; count += 1) {
      const row = layoutBoardRow(count, config)
      expect(row).toHaveLength(count)
      expect(row[0]?.x).toBeCloseTo(2 * config.centerX - (row.at(-1)?.x ?? 0))
      expect(new Set(row.map((transform) => transform.y))).toEqual(new Set([655]))
      expect(new Set(row.map((transform) => transform.scale))).toEqual(new Set([0.85]))
    }
  })

  it('uses the preferred step until the row reaches maxSpan, then compresses', () => {
    const fitting = layoutBoardRow(4, config)
    expect(fitting[1] && fitting[2] ? fitting[2].x - fitting[1].x : 0).toBe(130)

    const compressed = layoutBoardRow(7, config)
    expect(
      compressed[1] && compressed[2] ? compressed[2].x - compressed[1].x : 0
    ).toBeCloseTo(config.maxSpan / 6)
  })

  it('resolves outer and between-minion insertion gaps deterministically', () => {
    expect(resolveBoardInsertionIndex(-1000, 3, config)).toBe(0)
    expect(resolveBoardInsertionIndex(2000, 3, config)).toBe(3)
    const row = layoutBoardRow(3, config)
    const first = row[0]
    const second = row[1]
    if (!first || !second) throw new Error('Expected a three-minion row.')
    expect(resolveBoardInsertionIndex((first.x + second.x) / 2, 3, config)).toBe(1)
    expect(resolveBoardInsertionIndex(960, 0, config)).toBe(0)
    expect(resolveBoardInsertionIndex(959, 1, config)).toBe(0)
    expect(resolveBoardInsertionIndex(961, 1, config)).toBe(1)
  })

  it('checks inclusive drop-zone edges and rejects points outside each side', () => {
    const zone = { x: 100, y: 200, width: 300, height: 150 }
    expect(isInDropZone({ x: 100, y: 200 }, zone)).toBe(true)
    expect(isInDropZone({ x: 400, y: 350 }, zone)).toBe(true)
    expect(isInDropZone({ x: 99, y: 250 }, zone)).toBe(false)
    expect(isInDropZone({ x: 401, y: 250 }, zone)).toBe(false)
    expect(isInDropZone({ x: 250, y: 199 }, zone)).toBe(false)
    expect(isInDropZone({ x: 250, y: 351 }, zone)).toBe(false)
  })
})
