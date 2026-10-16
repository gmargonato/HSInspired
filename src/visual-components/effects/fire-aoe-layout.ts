import { CENTER, placement } from '../layout'

export type FireAoeCoverage = 'full' | 'opponent' | 'friendly'

/** Particle settings/meshes live in fire-aoe-authored.json; these are FSM curves and the 2D adapter. */
export const FIRE_AOE_LAYOUT = {
  resolution: 256,
  // Feather the filled board toward the moving rim without changing flame geometry.
  boardGlowOverlap: { near: [1.08, 1.18], far: [1.12, 1.3] },
  // Only the enemy board's inner glow extends 90px on its 235px footprint.
  // Particle projection and the outer flame plane retain the original coverage.
  boardGlowDepthScale: { full: 1, opponent: 325 / 235, friendly: 1 },
  simulationHz: 120,
  worldSpan: 16.24226379,
  plane: placement({ x: 0, y: 0 }, { width: 256, height: 256 }, { anchor: CENTER }),
  // Sizes multiply the requested area size. Half-board masks occupy half of a
  // full texture; retain the other half so their fade across the seam survives.
  boardMasks: {
    full: placement({ x: 0, y: 0 }, { width: 1, height: 1 }, { anchor: CENTER }),
    opponent: placement(
      { x: 0, y: 0 },
      { width: 1, height: 2 },
      { anchor: { x: 0.5, y: 0.25 } }
    ),
    friendly: placement(
      { x: 0, y: 0 },
      { width: 1, height: 2 },
      { anchor: { x: 0.5, y: 0.75 } }
    )
  },
  presets: {
    full: { action: 0.7, width: 13.5932827, depth: 6.60501194, centerZ: -0.25778151 },
    opponent: {
      action: 0.6,
      width: 13.59103775,
      depth: 2.99378633,
      centerZ: 1.5478313
    },
    friendly: {
      action: 0.6,
      width: 13.59134865,
      depth: 3.65167713,
      centerZ: -1.73444891
    }
  },
  dimFade: 2.5,
  embers: { emissionDuration: 0.5, lifetime: 0.5 },
  // World-to-screen projection adapts the source to this game's authored board placements.
  // Billboard height uses uniform horizontal world scale, independently of floor projection.
  billboardRise: 1,
  impact: { delay: [0.05, 0.35], worldPixels: 1400 / 13.5932827 },
  // Visual tuning for our board projection; retain the unmodified source profiles in JSON.
  smoke: {
    board: { density: 0.45, emissionDuration: 0.65, lifetime: 0.4, speed: 0.3 },
    impact: { density: 0.5, emissionDuration: 0.2, lifetime: 0.5, speed: 0.15 }
  },
  curves: {
    alphaIn: [
      [0, 0, 1.42857146, 1.42857146],
      [0.7, 1, 1.42857146, -1.53846156]
    ],
    alphaOut: [
      [0, 1, 0, 0],
      [0.75, 1, 0, -1.53846156],
      [1.4, 0, -1.53846156, -2.22222233]
    ],
    intensityOut: [
      [0, 2, 0, 0],
      [1, 2, 0, -0.03713027],
      [1.5, 0, -5.78991413, -2.22222233]
    ],
    glowIn: [
      [0.25, 0, 0, 0],
      [0.7, 1.4, 8.24265385, 8.24265385]
    ],
    glowOut: [
      [0.5, 1, 0.01140269, 0.01140269],
      [1, 0, 0, 0]
    ]
  }
} as const
