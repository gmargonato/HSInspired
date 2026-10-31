/** Atlas padding contains the complete mesh, cost gem and source flip motion. */
export const MATCH_CONTROLS_3D_LAYOUT = {
  tilePixels: 512,
  displayPixels: 256,
  slots: 4,
  pixelsPerUnit: 100,
  endTurnWidth: 157,
  heroPowerWidth: 150,
  cameraHeight: 20,
  endTurnTiltDegrees: 10,
  lighting: {
    endTurn: {
      ambient: 1.65,
      key: { color: 0xfff0dc, intensity: 1.7, position: [-3, 8, 4] },
      fill: { color: 0xb4c9ff, intensity: 0.65, position: [4, 3, -5] },
      frameShininess: 24,
      frameSpecular: 0x555555
    },
    heroPower: {
      ambient: 1.4,
      key: { color: 0xfff6ea, intensity: 1.15, position: [-3, 8, 4] },
      fill: { color: 0xffffff, intensity: 0.45, position: [4, 3, -5] },
      frameShininess: 12,
      frameSpecular: 0x181818
    }
  }
} as const
