import { CARD_PLAY_LAYOUT } from './card-play-layout'

/** Seconds and relative sizes for cards created at an effect source. */
export const DECK_ADDITION_LAYOUT = {
  scale: CARD_PLAY_LAYOUT.minion.cardScale,
  initialScale: 0.1,
  growDuration: 0.25,
  holdDuration: 0.1,
  stagger: 0.12
} as const
