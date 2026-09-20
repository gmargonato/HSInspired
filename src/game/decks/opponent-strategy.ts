/** Brief consumed by the AI opponent prompt (original deck plan, overridden by live state). */
export interface OpponentStrategyBrief {
  readonly strategy: string
  readonly theme: string
  readonly text: string
}
