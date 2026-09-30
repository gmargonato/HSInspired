/** Card-relative geometry and seconds; shared by future local play profiles. */
export const CARD_PLAY_LAYOUT = {
  minion: {
    cardScale: 0.27,
    chargedCardScale: 0.36,
    snapDuration: 0.18,
    chargeDuration: 0.3,
    settleDuration: 0.38,
    fallbackStartScaleMultiplier: 1.3,
    fallbackStartYOffset: -30,
    aura: {
      widthMultiplier: 698 / 620,
      heightMultiplier: 927 / 905,
      initialAlpha: 0.08,
      peakAlpha: 1,
      fadeDuration: 0.32
    },
    chargeParticles: {
      count: 36,
      stagger: 0.15,
      duration: 0.3,
      sizeMin: 3,
      sizeMax: 8,
      riseMin: 25,
      riseMax: 65,
      drift: 16,
      tint: 0x8eeaff
    },
    settleParticles: {
      count: 56,
      stagger: 0.32,
      duration: 0.48,
      sizeMin: 4,
      sizeMax: 12,
      riseMin: 35,
      riseMax: 95,
      drift: 22,
      tint: 0xc4f4ff
    }
  },
  spell: {
    aura: {
      widthMultiplier: 1.12,
      heightMultiplier: 1.08,
      initialAlpha: 0.35,
      peakAlpha: 1,
      brightenDuration: 0.12,
      holdDuration: 0.09,
      fadeDuration: 0.28,
      expansion: 1.06
    },
    particles: {
      count: 64,
      delay: 0.16,
      stagger: 0.12,
      duration: 0.85,
      sizeMin: 0.035,
      sizeMax: 0.08,
      travelMin: 0.4,
      travelMax: 1.1,
      tint: 0xb8eaff
    }
  }
} as const
