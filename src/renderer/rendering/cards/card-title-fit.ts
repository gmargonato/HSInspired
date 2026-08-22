export interface CardTitleFitInput {
  readonly maxFontSize: number
  readonly minFontSize: number
  readonly maxWidth: number
  readonly measureWidth: (fontSize: number) => number
}

export interface CardTitleFitResult {
  readonly fontSize: number
  readonly scale: number
}

/**
 * Finds the largest readable integer font size that fits a title, then returns
 * a uniform scale fallback for titles that still exceed the width at the
 * minimum size.
 */
export function resolveCardTitleFit({
  maxFontSize,
  minFontSize,
  maxWidth,
  measureWidth
}: CardTitleFitInput): CardTitleFitResult {
  const normalizedMaxFontSize = Math.max(1, Math.floor(maxFontSize))
  const normalizedMinFontSize = Math.max(
    1,
    Math.min(normalizedMaxFontSize, Math.floor(minFontSize))
  )
  const normalizedMaxWidth = Math.max(1, maxWidth)

  let lower = normalizedMinFontSize
  let upper = normalizedMaxFontSize
  let fittingFontSize: number | null = null

  while (lower <= upper) {
    const candidate = Math.floor((lower + upper) / 2)
    if (measureWidth(candidate) <= normalizedMaxWidth) {
      fittingFontSize = candidate
      lower = candidate + 1
    } else {
      upper = candidate - 1
    }
  }

  const fontSize = fittingFontSize ?? normalizedMinFontSize
  const measuredWidth = measureWidth(fontSize)
  const scale =
    measuredWidth > normalizedMaxWidth ? normalizedMaxWidth / measuredWidth : 1

  return { fontSize, scale }
}
