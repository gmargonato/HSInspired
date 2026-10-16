import { CENTER, placement } from '../layout'

/** Source world units; design-pixel conversion is the board projection adapter. */
export const FIREBALL_LAYOUT = {
  worldPixels: 1400 / 13.5932827,
  flightSeconds: 0.4,
  step: 1 / 120,
  coreDiameter: 0.6,
  coreHideAfterImpact: 0.05,
  emissionAfterImpact: 0,
  birth: {
    waitSeconds: 1,
    growthSeconds: 0.3,
    glowScale: 2.2,
    resolution: { width: 170, height: 170 },
    plane: placement({ x: 0, y: 0 }, { width: 3, height: 3 }, { anchor: CENTER }),
    cameraZ: 0,
    alphaExponent: 15,
    intensity: 1.5,
    bloom: { intensity: 1, threshold: 0.1, blur: 0.4, resolutionRatio: 0.75 }
  },
  flash: { startScale: 0.5, endScale: 7, scaleSeconds: 0.75, fadeSeconds: 0.6 },
  missile: {
    resolution: { width: 111, height: 380 },
    plane: placement({ x: 0, y: 3 }, { width: 2.5, height: 8.5 }, { anchor: CENTER }),
    cameraZ: -3,
    alphaExponent: 15,
    intensity: 2,
    bloom: { intensity: 1.15, threshold: 0.07, blur: 0.1, resolutionRatio: 0.9 }
  },
  impact: {
    resolution: { width: 180, height: 180 },
    plane: placement({ x: 0, y: 0 }, { width: 5, height: 5 }, { anchor: CENTER }),
    cameraZ: 0,
    alphaExponent: 15,
    intensity: 1.5,
    bloom: { intensity: 1, threshold: 0.1, blur: 0.4, resolutionRatio: 0.75 }
  }
} as const
