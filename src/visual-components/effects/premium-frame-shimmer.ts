import { Filter, type Sprite, type Texture } from 'pixi.js'
import { gsap } from '../animation/animations'

/** UV tiles per frame and UV travel per second; positive Y travels down. */
export const PREMIUM_FRAME_SHIMMER = {
  intensity: 0.75,
  tilesX: 1.5,
  tilesY: 2,
  velocityX: -0.035,
  velocityY: 0.035
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
  // Approximate a gold specular map from the unpremultiplied base frame.
  // Require yellow chroma and balanced red/green to reject silver and rusty brown.
  float gold = smoothstep(0.10, 0.28, min(frame.r, frame.g) - frame.b);
  float yellow = smoothstep(0.55, 0.80, frame.g / max(frame.r, 0.0001));
  // Gate on perceived brightness rather than the strongest RGB channel, so a
  // reddish dark panel cannot qualify on its red channel alone. Fade smoothly
  // into lit gold while leaving deep shadows free of moving illumination.
  float luminance = dot(frame, vec3(0.2126, 0.7152, 0.0722));
  float brightness = smoothstep(0.42, 0.72, luminance);
  vec3 specular = vec3(1.0, 0.78, 0.3) * gold * yellow * brightness;
  float clouds = texture(uClouds, vFrameUv * uTiles - uOffset).r;
  vec3 result = clamp(frame + clouds * specular * uIntensity, 0.0, 1.0);
  finalColor = vec4(result * source.a, source.a);
}`

/** Frame-only additive illumination; owns its filter, never the shared texture. */
export class PremiumFrameShimmer {
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
      gl: { vertex, fragment, name: 'premium-frame-shimmer' },
      padding: 0,
      resolution: 'inherit',
      clipToViewport: false,
      resources: {
        uClouds: clouds.source,
        shimmerUniforms: {
          uOffset: { value: this.offset, type: 'vec2<f32>' },
          uTiles: {
            value: new Float32Array([
              PREMIUM_FRAME_SHIMMER.tilesX,
              PREMIUM_FRAME_SHIMMER.tilesY
            ]),
            type: 'vec2<f32>'
          },
          uIntensity: { value: PREMIUM_FRAME_SHIMMER.intensity, type: 'f32' }
        }
      }
    })
  }

  private readonly tick = (_time: number, deltaMS: number): void => {
    if (document.hidden || !this.isVisible()) return
    const seconds = Math.min(deltaMS, 100) / 1000
    this.offset[0] = (this.offset[0] + seconds * PREMIUM_FRAME_SHIMMER.velocityX) % 1
    this.offset[1] = (this.offset[1] + seconds * PREMIUM_FRAME_SHIMMER.velocityY) % 1
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
