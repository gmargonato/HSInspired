import { PerspectiveMesh, Texture } from 'pixi.js'

export type HingeSide = 'left' | 'right'

/** Creates a top-view door whose local origin is its hinge. */
export function createHingedDoorMesh(
  texture: Texture,
  side: HingeSide,
  topLeft: { x: number; y: number }
): PerspectiveMesh {
  const width = texture.width
  const height = texture.height
  const hingeOnLeft = side === 'left'

  const mesh = new PerspectiveMesh({
    texture,
    verticesX: 10,
    verticesY: 10,
    x0: hingeOnLeft ? 0 : -width,
    y0: 0,
    x1: hingeOnLeft ? width : 0,
    y1: 0,
    x2: hingeOnLeft ? width : 0,
    y2: height,
    x3: hingeOnLeft ? 0 : -width,
    y3: height
  })

  mesh.position.set(topLeft.x + (hingeOnLeft ? 0 : width), topLeft.y)
  return mesh
}

/** Updates a hinged door using the shared cosine/sine perspective motion. */
export function updateHingedDoor(
  mesh: PerspectiveMesh,
  side: HingeSide,
  progress: number,
  perspectiveDepth: number,
  minWidth = 1
): void {
  const clampedProgress = Math.max(0, Math.min(1, progress))
  const angle = clampedProgress * (Math.PI / 2)
  const visibleWidth = Math.max(minWidth, mesh.texture.width * Math.cos(angle))
  const depth = Math.sin(angle) * perspectiveDepth
  const height = mesh.texture.height
  const hingeOnLeft = side === 'left'
  const freeEdgeX = hingeOnLeft ? visibleWidth : -visibleWidth

  if (hingeOnLeft) {
    mesh.setCorners(0, 0, freeEdgeX, -depth, freeEdgeX, height + depth, 0, height)
  } else {
    mesh.setCorners(freeEdgeX, -depth, 0, 0, 0, height, freeEdgeX, height + depth)
  }
}

/** Animates a hinged door through a caller-owned animation scope. */
export function animateHingedDoor(
  createTimeline: (vars: gsap.TimelineVars) => gsap.core.Timeline,
  mesh: PerspectiveMesh,
  side: HingeSide,
  duration: number,
  perspectiveDepth: number,
  minWidth = 1
): Promise<void> {
  return new Promise<void>((resolve) => {
    const state = { progress: 0 }
    const timeline = createTimeline({
      onComplete: resolve,
      onInterrupt: resolve
    })

    timeline.to(
      state,
      {
        progress: 1,
        duration,
        ease: 'power2.in',
        onUpdate: () =>
          updateHingedDoor(mesh, side, state.progress, perspectiveDepth, minWidth)
      },
      0
    )
  })
}
