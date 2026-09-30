/** Presentation-neutral choice descriptors supplied by the match input contract. */
export interface CardChoiceDescriptor {
  readonly choice: number
  readonly label: string
}

export interface CardChoiceInput {
  readonly legalChoices: readonly number[]
  readonly choiceLabels?: readonly string[]
}

/** Keeps renderer choice labels aligned with the domain's zero-based choice ids. */
export function describeCardChoices(
  input: CardChoiceInput
): readonly CardChoiceDescriptor[] {
  return input.legalChoices.map((choice, index) => ({
    choice,
    label: input.choiceLabels?.[index]?.trim() || `Choice ${choice + 1}`
  }))
}
