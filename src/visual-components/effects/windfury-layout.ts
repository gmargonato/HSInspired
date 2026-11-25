/** Projection into an existing 2D portrait. Native meshes remain in Unity units.
 * Camera, illumination and the portrait depth plane require native-frame calibration. */
export const WINDFURY_PROJECTION = {
  diameterUnits: 1.8,
  cameraY: -20,
  // Bound activation curls relative to their host's authored idle envelope.
  burstRadiusFactor: 1.35,
  edgeFeatherPixels: 2,
  lighting: [1, 1, 1]
} as const
