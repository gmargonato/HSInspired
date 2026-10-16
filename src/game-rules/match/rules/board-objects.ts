import type { BoardMinion } from '../opening-match-types'

/** Permanent objects share board geometry, but never ordinary minion interactions. */
export function isPermanentBoardObject(
  entity: Pick<BoardMinion, 'boardObject'> | null | undefined
): boolean {
  return (
    entity?.boardObject === 'nether-portal' || entity?.boardObject === 'underfel-rift'
  )
}

/** Semantic minion count; capacity and adjacency must use the unfiltered board. */
export function countBoardMinions(board: readonly BoardMinion[]): number {
  return board.filter((entity) => !isPermanentBoardObject(entity)).length
}
