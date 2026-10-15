import {
  CARD_BODY_BOUNDS,
  CARD_CANVAS
} from '../../../visual-components/cards/card-layout'

/** Blue tint shared by every card-play aura, including legendary variants. */
export const CARD_PLAY_AURA_TINT = 0x229fff

/** Burst surrounds the card body and fades before its aura and particles. */
export const CARD_PLAY_BURST = {
  widthMultiplier: 1.45,
  heightMultiplier: 1.15,
  centerY: (CARD_BODY_BOUNDS.y + CARD_BODY_BOUNDS.height / 2) / CARD_CANVAS.height,
  initialAlpha: 0.35,
  peakAlpha: 1,
  brightenDuration: 0.06,
  fadeDuration: 0.2
} as const

const CAST_PARTICLES = {
  count: 96,
  delay: 0,
  stagger: 0.12,
  duration: 0.85,
  sizeMin: 0.035,
  sizeMax: 0.08,
  travelMin: 0.4,
  travelMax: 1.1,
  tint: CARD_PLAY_AURA_TINT
} as const

// The visible card body occupies about 280 x 384 inside each 512 x 512 aura.
// Include the surrounding black padding when fitting the glow to the card.
const AURA_IMAGE_FIT = {
  widthMultiplier: 512 / 280,
  heightMultiplier: (CARD_BODY_BOUNDS.height / CARD_CANVAS.height) * (512 / 384),
  centerY: (CARD_BODY_BOUNDS.y + CARD_BODY_BOUNDS.height / 2) / CARD_CANVAS.height
} as const

/** Card-relative geometry and seconds for play profiles. */
export const CARD_PLAY_LAYOUT = {
  minion: {
    cardScale: 0.27,
    chargedCardScale: 0.36,
    snapDuration: 0.18,
    chargeDuration: 0.3,
    settleDuration: 0.38,
    legendaryShake: { amplitude: 14, pulses: 4, duration: 0.24 },
    fallbackStartScaleMultiplier: 1.3,
    fallbackStartYOffset: -30,
    aura: {
      ...AURA_IMAGE_FIT,
      initialAlpha: 0.65,
      peakAlpha: 1,
      fadeDuration: 0.7
    },
    chargeParticles: {
      count: 54,
      stagger: 0.15,
      duration: 0.3,
      sizeMin: 3,
      sizeMax: 8,
      riseMin: 25,
      riseMax: 65,
      drift: 16,
      tint: CARD_PLAY_AURA_TINT
    },
    settleParticles: {
      count: 84,
      stagger: 0.32,
      duration: 0.48,
      sizeMin: 4,
      sizeMax: 12,
      riseMin: 35,
      riseMax: 95,
      drift: 22,
      tint: CARD_PLAY_AURA_TINT
    }
  },
  weapon: {
    cardScale: 0.27,
    chargedCardScale: 0.36,
    snapDuration: 0.18,
    chargeDuration: 0.3,
    settleDuration: 0.38,
    fallbackStartScaleMultiplier: 1.3,
    fallbackStartYOffset: -30,
    aura: {
      ...AURA_IMAGE_FIT,
      initialAlpha: 0.65,
      peakAlpha: 1,
      fadeDuration: 0.7
    },
    chargeParticles: {
      count: 54,
      stagger: 0.15,
      duration: 0.3,
      sizeMin: 3,
      sizeMax: 8,
      riseMin: 25,
      riseMax: 65,
      drift: 16,
      tint: CARD_PLAY_AURA_TINT
    },
    settleParticles: {
      count: 84,
      stagger: 0.32,
      duration: 0.48,
      sizeMin: 4,
      sizeMax: 12,
      riseMin: 35,
      riseMax: 95,
      drift: 22,
      tint: CARD_PLAY_AURA_TINT
    }
  },
  spell: {
    aura: {
      ...AURA_IMAGE_FIT,
      initialAlpha: 0.7,
      peakAlpha: 1,
      brightenDuration: 0.12,
      holdDuration: 0.24,
      fadeDuration: 0.6,
      expansion: 1.02
    },
    particles: CAST_PARTICLES
  },
  hero: {
    aura: {
      ...AURA_IMAGE_FIT,
      initialAlpha: 0.7,
      peakAlpha: 1,
      brightenDuration: 0.12,
      holdDuration: 0.24,
      fadeDuration: 0.6,
      expansion: 1.02
    },
    particles: CAST_PARTICLES
  }
} as const
