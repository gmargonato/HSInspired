import { Filter, type Texture } from 'pixi.js'
import {
  FIRE_VFX_VERTEX_SHADER,
  FIRE_VFX_NOISE_GLSL,
  hexColorToRgb
} from './fire-vfx-shader-common'

export interface AoeVfxPalette {
  readonly flameColor: string
  readonly coreColor: string
}

export type AoeVfxShape = 'radial' | 'wide'

export interface AoeVfxTuning {
  readonly intensity: number
  readonly noiseScale: number
  readonly flowSpeed: number
  readonly turbulence: number
  readonly radius: number
  readonly edgeSoftness: number
  readonly shape: AoeVfxShape
  /** Compact character hit: bright center and red peripheral flames. */
  readonly impact?: boolean
}

interface AoeVfxUniformValues {
  uTime: number
  uProgress: number
  uIntensity: number
  uNoiseScale: number
  uFlowSpeed: number
  uTurbulence: number
  uRadius: number
  uEdgeSoftness: number
  uShape: number
  uImpact: number
  uFlameColor: Float32Array
  uCoreColor: Float32Array
}

const fragment = `#version 300 es
in vec2 vTextureCoord;
in vec2 vVfxUv;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uNoise;
uniform vec4 uOutputFrame;
uniform float uTime, uProgress, uIntensity, uNoiseScale, uFlowSpeed, uTurbulence;
uniform float uRadius, uEdgeSoftness, uShape, uImpact;
uniform vec3 uFlameColor, uCoreColor;
${FIRE_VFX_NOISE_GLSL}
// Broad, soft billows rather than high-frequency cutout noise.
float explosionNoise(vec2 p) {
  return fireNoise(p) * 0.65 + fireNoise(p * 2.03 + 13.1) * 0.25
       + fireNoise(p * 4.07 - 7.3) * 0.10;
}
void main() {
  vec2 uv = vVfxUv;
  vec2 p = (uv - 0.5) * 2.0;
  float progress = clamp(uProgress, 0.0, 1.0);
  float t = uTime * uFlowSpeed;
  float aspect = uOutputFrame.z / max(uOutputFrame.w, 1.0);
  vec2 physical = p * vec2(aspect, 1.0);
  vec2 flow = physical * uNoiseScale * 0.65 + vec2(0.0, -t * 0.85);
  vec2 roll = vec2(explosionNoise(flow + 5.2), explosionNoise(flow - 11.7)) - 0.5;
  float broad = explosionNoise(flow + roll * 1.4 * uTurbulence);
  float billow = explosionNoise(flow * 1.45 + roll * 1.1 - vec2(t * 0.2, 0.0));
  float tongues = fireFbm(flow * vec2(3.1, 1.9) + roll * 3.0 + vec2(0.0, -t * 1.2));
  float grain = texture(uNoise, fract(flow * 0.07)).r;
  // Rounded rectangle with softer corners than a superellipse of order four.
  float wide = pow(pow(abs(p.x), 2.8) + pow(abs(p.y), 2.8), 1.0 / 2.8);
  float distance = mix(length(p), wide, uShape);
  float expansion = uRadius * (0.10 + 0.70 * (1.0 - pow(1.0 - progress, 5.0)));
  float displacement = ((broad - 0.5) * 0.43 + (billow - 0.5) * 0.14
                     + (tongues - 0.5) * 0.24) * uTurbulence;
  float edge = distance + displacement - expansion;
  float softness = max(0.02, uEdgeSoftness);
  float rimWidth = 0.115 + broad * 0.13;
  float crest = exp(-pow(edge / rimWidth, 2.0));
  float mantle = 1.0 - smoothstep(0.04, 0.20 + softness, edge);
  float interior = 1.0 - smoothstep(-0.28, 0.04, edge);
  float hotPockets = smoothstep(0.26, 0.70, billow * 0.55 + tongues * 0.45);
  float flames = crest * (0.40 + hotPockets * 0.60);
  float haze = interior * (0.16 + broad * 0.15);
  float ignition = exp(-dot(physical, physical) * 5.0)
                * (1.0 - smoothstep(0.08, 0.25, progress));
  float heat = clamp(crest * (0.28 + hotPockets * 0.90) + ignition * 0.8, 0.0, 1.0);
  float impactCore = exp(-dot(p, p) * 2.7) * uImpact;
  heat = mix(heat, 0.65 + hotPockets * 0.35, impactCore);
  heat = pow(heat, 1.45);
  // Orange/red shoulders and saturated yellow peaks retain color at high intensity.
  vec3 orange = uFlameColor * mix(vec3(1.0, 0.9, 0.24), vec3(1.0, 0.38, 0.10), smoothstep(0.0, 0.18, edge));
  vec3 gold = mix(uFlameColor, uCoreColor, 0.64);
  vec3 color = mix(orange, uFlameColor, smoothstep(0.0, 0.28, heat));
  color = mix(color, gold, smoothstep(0.20, 0.65, heat));
  color = mix(color, uCoreColor, smoothstep(0.58, 0.98, heat));
  float glow = exp(-pow(edge / (0.23 + softness), 2.0)) * 0.22;
  float appear = smoothstep(0.0, 0.045, progress);
  float fade = 1.0 - smoothstep(0.57, 1.0, progress);
  float border = smoothstep(0.0, 0.07, uv.x) * (1.0 - smoothstep(0.93, 1.0, uv.x))
               * smoothstep(0.0, 0.07, uv.y) * (1.0 - smoothstep(0.93, 1.0, uv.y));
  float coverage = (flames * 0.85 + haze + glow + ignition * 0.8 + impactCore * 0.7) * mantle;
  float alpha = (1.0 - exp(-coverage * uIntensity * 2.0)) * appear * fade * border;
  alpha *= texture(uTexture, vTextureCoord).a;
  // Fine texture is deliberately subtle: the reference is a soft luminous mass.
  color *= 0.985 + grain * 0.03;
  finalColor = vec4(color * alpha, alpha);
}`

/** Expanding texture-driven fire blast used by the VFX Lab's area effect. */
export class AoeVfxShader {
  readonly filter: Filter
  private readonly uniforms: AoeVfxUniformValues

  constructor(noise: Texture) {
    const uniforms = {
      uTime: { value: 0, type: 'f32' },
      uProgress: { value: 1, type: 'f32' },
      uIntensity: { value: 1.65, type: 'f32' },
      uNoiseScale: { value: 2.6, type: 'f32' },
      uFlowSpeed: { value: 0.85, type: 'f32' },
      uTurbulence: { value: 0.85, type: 'f32' },
      uRadius: { value: 0.98, type: 'f32' },
      uEdgeSoftness: { value: 0.1, type: 'f32' },
      uShape: { value: 1, type: 'f32' },
      uImpact: { value: 0, type: 'f32' },
      uFlameColor: { value: hexColorToRgb('#ff5900'), type: 'vec3<f32>' },
      uCoreColor: { value: hexColorToRgb('#ffe600'), type: 'vec3<f32>' }
    }
    this.filter = Filter.from({
      gl: {
        vertex: FIRE_VFX_VERTEX_SHADER,
        fragment,
        name: 'aoe-vfx',
        preferredFragmentPrecision: 'highp'
      },
      padding: 0,
      antialias: 'inherit',
      resources: {
        uNoise: noise.source,
        aoeVfxUniforms: uniforms
      }
    })
    this.uniforms = this.filter.resources.aoeVfxUniforms.uniforms as AoeVfxUniformValues
  }

  setPalette(palette: AoeVfxPalette): void {
    this.uniforms.uFlameColor.set(hexColorToRgb(palette.flameColor))
    this.uniforms.uCoreColor.set(hexColorToRgb(palette.coreColor))
  }

  setTuning(tuning: AoeVfxTuning): void {
    this.uniforms.uIntensity = tuning.intensity
    this.uniforms.uNoiseScale = tuning.noiseScale
    this.uniforms.uFlowSpeed = tuning.flowSpeed
    this.uniforms.uTurbulence = tuning.turbulence
    this.uniforms.uRadius = tuning.radius
    this.uniforms.uEdgeSoftness = tuning.edgeSoftness
    this.uniforms.uShape = tuning.shape === 'wide' ? 1 : 0
    this.uniforms.uImpact = tuning.impact ? 1 : 0
  }

  setFrame(time: number, progress: number): void {
    this.uniforms.uTime = time
    this.uniforms.uProgress = progress
  }

  dispose(): void {
    this.filter.destroy()
  }
}
