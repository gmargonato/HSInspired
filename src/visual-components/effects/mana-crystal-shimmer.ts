import { Filter, type Sprite, type Texture } from 'pixi.js'
import { gsap } from '../animation/animations'

/** UV tiles per frame and UV travel per second; positive Y travels down. */
export const MANA_CRYSTAL_SHIMMER = {
  intensity: 0.5,
  tilesX: 1,
  tilesY: 1,
  velocityX: -0.105,
  velocityY: 0.105
} as const

const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vFrameUv;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vTextureCoord = aPosition * uOutputFrame.zw * uInputSize.zw;
  vFrameUv = aPosition;
}`

const fragment = `
in vec2 vTextureCoord;
in vec2 vFrameUv;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uClouds;
uniform vec2 uOffset;
uniform vec2 uTiles;
uniform float uIntensity;
void main(void) {
  vec4 source = texture(uTexture, vTextureCoord);
  vec3 frame = source.rgb / max(source.a, 0.0001);
  // Blue facets catch the light; dark outlines and neutral highlights stay crisp.
  float blue = smoothstep(0.04, 0.22, frame.b - frame.r);
  float brightness = smoothstep(0.08, 0.35, dot(frame, vec3(0.2126, 0.7152, 0.0722)));
  float clouds = texture(uClouds, vFrameUv * uTiles - uOffset).r;
  // Middle gray is neutral. Vary reflected light around the original color
  // instead of adding a constant blue glow that washes out the moving pattern.
  float reflection = (clouds * 2.0 - 1.0) * blue * brightness * uIntensity;
  vec3 result = clamp(frame * (1.0 + reflection), 0.0, 1.0);
  finalColor = vec4(result * source.a, source.a);
}`

/** Mana-icon-only moving reflections; owns its filter, never the shared texture. */
export class ManaCrystalShimmer {
  private readonly filter: Filter
  private enabled = false
  private readonly offset = new Float32Array(2)

  constructor(
    private readonly frame: Sprite,
    clouds: Texture,
    private readonly isVisible: () => boolean,
    private readonly onUpdate: () => void
  ) {
    clouds.source.style.addressMode = 'repeat'
    this.filter = Filter.from({
      gl: { vertex, fragment, name: 'mana-crystal-shimmer' },
      padding: 0,
      resolution: 'inherit',
      clipToViewport: false,
      resources: {
        uClouds: clouds.source,
        shimmerUniforms: {
          uOffset: { value: this.offset, type: 'vec2<f32>' },
          uTiles: {
            value: new Float32Array([
              MANA_CRYSTAL_SHIMMER.tilesX,
              MANA_CRYSTAL_SHIMMER.tilesY
            ]),
            type: 'vec2<f32>'
          },
          uIntensity: { value: MANA_CRYSTAL_SHIMMER.intensity, type: 'f32' }
        }
      }
    })
  }

  private readonly tick = (_time: number, deltaMS: number): void => {
    if (document.hidden || !this.isVisible()) return
    const seconds = Math.min(deltaMS, 100) / 1000
    this.offset[0] = (this.offset[0] + seconds * MANA_CRYSTAL_SHIMMER.velocityX) % 1
    this.offset[1] = (this.offset[1] + seconds * MANA_CRYSTAL_SHIMMER.velocityY) % 1
    this.onUpdate()
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return
    this.enabled = enabled
    if (enabled) {
      this.frame.filters = [...(this.frame.filters ?? []), this.filter]
      gsap.ticker.add(this.tick)
    } else {
      gsap.ticker.remove(this.tick)
      this.frame.filters = (this.frame.filters ?? []).filter(
        (filter) => filter !== this.filter
      )
    }
  }

  destroy(): void {
    this.setEnabled(false)
    this.filter.destroy()
  }
}
