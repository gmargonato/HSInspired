import { CARD_PLAY_LAYOUT } from './card-play-layout'

/** Reverse-play stages reuse the authored forward-play dimensions and timing. */
export const CARD_DEPARTURE_LAYOUT = {
  liftDuration: CARD_PLAY_LAYOUT.minion.settleDuration,
  materializeDuration: CARD_PLAY_LAYOUT.minion.chargeDuration,
  copyStagger: 0.12,
  destroy: {
    flashDuration: 0.08,
    fadeDuration: 0.3,
    scaleMultiplier: 0.35
  }
} as const
