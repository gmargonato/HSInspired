import { Filter, Texture } from 'pixi.js'

// fwidth is core in GLSL ES 3.00 (the viewer uses WebGL2).
const vertex = `#version 300 es
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vCardUv;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

void main(void)
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    gl_Position = vec4(position, 0.0, 1.0);
    vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
    vCardUv = aPosition;
}
`

const fragment = `#version 300 es
in vec2 vTextureCoord;
in vec2 vCardUv;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uNoise;
uniform sampler2D uBurnTexture;
uniform float uIntegrity;
uniform float uBurnSize;

void main(void)
{
    vec4 source = texture(uTexture, vTextureCoord);
    // Card UVs are independent of Pixi's pooled filter texture dimensions.
    // Mirror the detail sample to avoid seams without changing shared samplers.
    vec2 detailUv = 1.0 - abs(mod(vCardUv * 4.0 + vec2(0.37, 0.61), 2.0) - 1.0);
    float broad = texture(uNoise, vCardUv).r;
    float detail = texture(uNoise, detailUv).r;
    float noise = mix(broad, detail, 0.18);

    if (uIntegrity <= 0.0) {
        finalColor = vec4(0.0);
        return;
    }
    if (uIntegrity >= 1.0) {
        finalColor = source;
        return;
    }

    // Retain the saved 1..1.5 size control, but use an additive band whose
    // noise-space width does not shrink with integrity. Sweep beyond zero
    // so the last fire patches disappear before progress reaches its endpoint.
    float width = (uBurnSize - 1.0) * 0.5;
    float threshold = mix(-width, 1.0, uIntegrity);
    float feather = max(fwidth(noise) * 0.5, 0.0001);
    float baseMask = 1.0 - smoothstep(threshold - feather, threshold + feather, noise);
    float burnMask = 1.0 - smoothstep(threshold + width - feather, threshold + width + feather, noise);
    float burnPosition = clamp((noise - threshold) / max(width, 0.0001), 0.0, 1.0);

    // The generated 1D texture is the Godot GradientTexture1D equivalent.
    vec4 burnColor = texture(uBurnTexture, vec2(burnPosition, 0.5)) * source.a;

    // Keep the source alpha shape so the generated fire cannot appear outside
    // the transparent parts of the card image.
    // Disjoint coverage weights preserve premultiplied alpha at both edges.
    finalColor = source * baseMask + burnColor * max(burnMask - baseMask, 0.0);
}
`

/** One-shot card dissolve. The caller owns progress and the shared noise texture. */
export class Burn {
  readonly filter: Filter
  private readonly gradient: Texture
  private disposed = false

  constructor(noise: Texture) {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 1
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Unable to create the burn gradient')
    const gradient = context.createLinearGradient(0, 0, canvas.width, 0)
    gradient.addColorStop(0, '#fff6a0')
    gradient.addColorStop(0.5, '#ff9d21')
    gradient.addColorStop(1, '#b51f0d')
    context.fillStyle = gradient
    context.fillRect(0, 0, canvas.width, 1)
    this.gradient = Texture.from(canvas)
    this.gradient.source.scaleMode = 'linear'
    this.filter = Filter.from({
      gl: { vertex, fragment, name: 'burn' },
      padding: 0,
      antialias: 'on',
      clipToViewport: false,
      resources: {
        uNoise: noise.source,
        uBurnTexture: this.gradient.source,
        burnUniforms: {
          uIntegrity: { value: 1, type: 'f32' },
          uBurnSize: { value: 1.3, type: 'f32' }
        }
      }
    })
  }

  setProgress(progress: number): void {
    if (this.disposed) return
    this.filter.resources.burnUniforms.uniforms.uIntegrity =
      1 - Math.max(0, Math.min(1, progress))
  }

  destroy(): void {
    if (this.disposed) return
    this.disposed = true
    this.filter.destroy()
    this.gradient.destroy(true)
  }
}
