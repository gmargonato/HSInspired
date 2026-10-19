/** Source mesh ratios; the banner's text is already baked into our composite PNG. */
export const GHOST_LAYOUT = {
  banner: {
    body: { x: 0.5, y: 0.515, width: 1, height: 0.63 },
    glow: { width: 0.9713413 / 0.8764918, height: 0.267545 / 0.1726017 },
    uv: [
      0.00754, 0.2666016, 0.9926758, 0.2666016, 0.9926758, 0.5375977, 0.00754, 0.5375977
    ],
    // Shape-only scaling: particle size/velocity are in world units while the
    // emission box follows the banner hierarchy's scale.
    worldWidth: 2 * 0.8764918 * 1.630027 * 1.75,
    emitterScale: 0.4884436 * 1.630027 * 1.75
  },
  button: {
    body: { x: 0.5, y: 0.5, width: 1, height: 1 },
    glow: {
      width: (0.9780396 * 1.111181) / 0.5947638,
      height: (0.4940579 * 1.111181) / 0.3214136
    },
    uv: [
      0.8570661, 0.0737475, 0.8570661, 0.344132, 0.9913748, 0.344132, 0.9913748,
      0.0737475
    ],
    worldWidth: 2 * 0.5947638 * 1.214584 * 1.147148,
    emitterScale: 1.214584 * 1.147148
  }
} as const

export type GhostProfile = keyof typeof GHOST_LAYOUT
/** ButtonFloaty_Echo / AllyInHandScryLines, played at speed 2 on Death. */
export const GHOST_BUTTON_ECHO = {
  width: 0.7856637 / 0.5947638,
  height: 0.396879 / 0.3214136,
  uv: [
    0.1360919, 0.0295621, 0.8639081, 0.0295621, 0.8639081, 0.3910917, 0.1360919,
    0.3910917
  ],
  tint: [0.16761245, 0.3155933, 0.6784314, 0],
  alpha: [
    [0, 0, 1.5058824, 1.5058824],
    [1 / 3, 0.5019608, 0, 0],
    [1, 0.5019608, 0, 0]
  ]
} as const
export const GHOST_TIMING = {
  fade: 0.3,
  burstDelay: 0.2,
  duration: 1.7,
  bannerDuration: 0.5
} as const
