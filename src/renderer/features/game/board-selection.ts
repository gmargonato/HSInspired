/** Selects one of the available match boards for a newly created game view. */
export function selectRandomBoardTexture<T>(
  boards: readonly T[],
  random: () => number = Math.random
): T {
  if (boards.length === 0) throw new Error('At least one board texture is required.')
  return boards[Math.floor(random() * boards.length)]!
}
