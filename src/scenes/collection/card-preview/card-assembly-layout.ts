/** Entry offsets in authored card coordinates; final slots come from CardView. */
export const CARD_ASSEMBLY = {
  flipHalfDuration: 0.2,
  travelDuration: 0.32,
  settleDuration: 0.08,
  initialScale: 1.4,
  landingScale: 0.97,
  rotationOvershoot: 3,
  particles: {
    capacity: 100,
    spacing: 8,
    lifetimeMin: 0.2,
    lifetimeMax: 0.35,
    burstCount: 10,
    tint: 0xb7f5ff
  },
  shakeDuration: 0.16,
  stages: [
    [{ paths: ['card.stats.mana'], x: -220, y: -220, rotation: -35, impact: 6 }],
    [
      { paths: ['card.stats.attack'], x: -240, y: 200, rotation: -45, impact: 10 },
      { paths: ['card.stats.health'], x: 240, y: 200, rotation: 45, impact: 10 },
      { paths: ['card.stats.durability'], x: 240, y: 200, rotation: 45, impact: 10 }
    ],
    [
      {
        paths: ['card.name-banner', 'card.name'],
        x: 260,
        y: -180,
        rotation: 20,
        impact: 7
      }
    ],
    [{ paths: ['card.rarity'], x: 260, y: 100, rotation: 60, impact: 9 }]
  ]
} as const
