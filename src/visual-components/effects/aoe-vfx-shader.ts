import { Filter, type Texture } from 'pixi.js'
import {
  FIRE_VFX_VERTEX_SHADER,
  FIRE_VFX_NOISE_GLSL,
  hexColorToRgb
} from './fire-vfx-shader-common'

export interface AoeVfxPalette {
  readonly flameColor: string
  readonly coreColor: string
  readonly redColor?: string
  readonly sootColor?: string
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
  uSeed: number
  uFlameColor: Float32Array
  uCoreColor: Float32Array
  uRedColor: Float32Array
  uSootColor: Float32Array
}

const fragment = `#version 300 es
in vec2 vTextureCoord;
in vec2 vVfxUv;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uNoise;
uniform vec4 uOutputFrame;
uniform float uTime, uProgress, uIntensity, uNoiseScale, uFlowSpeed, uTurbulence;
uniform float uRadius, uEdgeSoftness, uShape, uImpact, uSeed;
uniform vec3 uFlameColor, uCoreColor, uRedColor, uSootColor;
${FIRE_VFX_NOISE_GLSL}
// Broad, soft billows rather than high-frequency cutout noise.
float explosionNoise(vec2 p) {
  return fireNoise(p) * 0.65 + fireNoise(p * 2.03 + 13.1) * 0.25
       + fireNoise(p * 4.07 - 7.3) * 0.10;
}
// Sample a softly overlapping vortex. UV y points down: inverse sampling with
// this positive rotation moves visible features counterclockwise on screen.
vec2 circulate(vec2 p, vec2 center, float angle) {
  vec2 q = p - center;
  float c = cos(angle), s = sin(angle);
  return center + vec2(c * q.x - s * q.y, s * q.x + c * q.y);
}
// Sample each circulating layer before blending, so overlaps cannot fold UVs.
vec4 flameField(vec2 flow, float drift, float life) {
  // A broad rolling mass is warped by a second field, then masked by an
  // independently evolving layer. The mask births/erodes lobes rather than
  // moving the same image. Finer tongues ride the surviving mass only.
  vec2 roll = vec2(explosionNoise(flow + vec2(5.2, life * 0.32)),
                   explosionNoise(flow + vec2(-11.7 - life * 0.21, 0.0))) - 0.5;
  float maskA = fireNoise(flow * vec2(1.25, 0.92) + vec2(-life * 0.27, life * 0.38));
  float maskB = fireNoise(flow * 0.88 + vec2(17.3, -9.1) + vec2(life * 0.19, -life * 0.24));
  float renewal = 0.5 + 0.5 * sin(life * 1.55 + maskB * 6.28318);
  float breakup = smoothstep(0.20, 0.77, mix(maskA, maskB, renewal));
  roll += vec2(maskA - 0.5, maskB - 0.5) * (0.45 + renewal * 0.40) * uTurbulence;
  float broad = explosionNoise(flow + roll * 1.6 * uTurbulence);
  float billow = explosionNoise(flow * 1.45 + roll * 1.3 - vec2(life * 0.19, 0.0));
  float tongues = fireFbm(flow * vec2(3.1, 1.9) + roll * 3.0 + vec2(0.0, -life * 0.52));
  float surface = fireFbm(flow * vec2(1.8, 1.5) + roll * 1.9
                        + vec2(life * 0.10, -life * 0.28));
  return vec4(broad, billow * (0.58 + breakup * 0.62),
              tongues * (0.72 + breakup * 0.28), surface * (0.70 + breakup * 0.30));
}
void main() {
  vec2 uv = vVfxUv;
  vec2 p = (uv - 0.5) * 2.0;
  float progress = clamp(uProgress, 0.0, 1.0);
  float t = uTime * uFlowSpeed;
  float aspect = uOutputFrame.z / max(uOutputFrame.w, 1.0);
  vec2 physical = p * vec2(aspect, 1.0);
  // Three broad texture regions share one continuous board silhouette.
  // Smooth weights avoid separate disks or seams between left, middle, right.
  vec2 leftCenter = vec2(-aspect * 0.54, -0.05);
  vec2 middleCenter = vec2(aspect * 0.02, -0.05);
  vec2 rightCenter = vec2(aspect * 0.50, 0.06);
  vec2 leftLocal = (physical - leftCenter) / vec2(aspect * 0.40, 0.90);
  vec2 middleLocal = (physical - middleCenter) / vec2(aspect * 0.23, 0.64);
  vec2 rightLocal = (physical - rightCenter) / vec2(aspect * 0.38, 0.90);
  vec3 weights = exp(-vec3(dot(leftLocal, leftLocal),
                          dot(middleLocal, middleLocal), dot(rightLocal, rightLocal)) * 2.0);
  weights /= max(dot(weights, vec3(1.0)), 0.001);
  // Bounded phase keeps replay and combat motion identical, even after Lab idle.
  float angle = progress * uFlowSpeed * 0.9;
  float drift = mix(progress * uFlowSpeed * 0.20, t, uImpact);
  float billowSurge = mix(1.28, 1.0, smoothstep(0.02, 0.30, progress));
  vec2 scale = vec2(uNoiseScale * 0.65 * billowSurge);
  vec2 advection = vec2(0.0, -drift * 0.85);
  float life = progress * 3.0 * uFlowSpeed + uImpact * 1.7 + uSeed * 0.71;
  // Fixed per-instance phase separates heroes without shifting their lifecycle.
  advection += vec2(uSeed * 7.13, uSeed * -4.79);
  // Eulerian renewal stays local while the broad material circulates through it.
  // Opposed continuous fields create/erode lobes instead of carrying a rigid patch.
  vec2 localFlow = physical * uNoiseScale + vec2(uSeed * 3.9, uSeed * -2.7);
  vec2 localRoll = vec2(
    fireNoise(localFlow * 1.7 + vec2(life * 0.83, -life * 0.67)),
    fireNoise(localFlow * 1.3 + vec2(-life * 0.72, life * 0.91))) - 0.5;
  advection += localRoll * 0.50 * uTurbulence;
  vec4 field;
  if (uImpact > 0.5) {
    field = flameField(physical * scale + advection, drift, life);
  } else {
    field = flameField(circulate(physical, leftCenter, angle) * scale + advection, drift, life) * weights.x
          + flameField(circulate(physical, middleCenter, angle) * scale + advection, drift, life) * weights.y
          + flameField(circulate(physical, rightCenter, angle) * scale + advection, drift, life) * weights.z;
  }
  float localBirth = fireNoise(localFlow * 1.45 + localRoll * 1.4
                             + vec2(-life * 0.64, -life * 0.96));
  float erosion = smoothstep(0.27, 0.68, localBirth);
  field.y *= mix(0.72, 1.12, erosion);
  field.z *= mix(0.64, 1.08, erosion);
  field.w = mix(field.w * 0.72, field.w * 1.08, erosion);
  float broad = field.x, billow = field.y, tongues = field.z, surface = field.w;
  float grain = texture(uNoise, fract(physical * 0.25)).r;
  float folds = smoothstep(0.24, 0.72, surface);
  float ridges = pow(1.0 - abs(surface * 2.0 - 1.0), 2.4);
  float litSide = clamp(0.5 + (surface - billow) * 2.0, 0.0, 1.0);
  // Rounded rectangle with softer corners than a superellipse of order four.
  float wide = pow(pow(abs(p.x), 2.8) + pow(abs(p.y), 2.8), 1.0 / 2.8);
  float distance = mix(length(p), wide, uShape);
  float impactExpansion = 0.10 + 0.70 * (1.0 - pow(1.0 - progress, 5.0));
  // Board fire begins around its full outer edge, then fills inward. Hero hits
  // keep their compact expansion. Both retain the original maximum footprint.
  float expansion = uRadius * mix(0.80, impactExpansion, uImpact);
  float displacement = ((broad - 0.5) * 0.43 + (billow - 0.5) * 0.14
                     + (tongues - 0.5) * 0.24) * uTurbulence;
  float edge = distance + displacement - expansion;
  float softness = max(0.02, uEdgeSoftness);
  float rimWidth = 0.115 + broad * 0.13;
  float crest = exp(-pow(edge / rimWidth, 2.0));
  float mantle = 1.0 - smoothstep(0.04, 0.20 + softness, edge);
  float interior = 1.0 - smoothstep(-0.28, 0.04, edge);
  float hotPockets = smoothstep(0.26, 0.70, billow * 0.55 + tongues * 0.45);
  float flames = crest * (0.18 + hotPockets * 0.82) * mix(0.35, 1.25, erosion);
  // Uneven edge ignition advances inward as a moving burning front, rather
  // than revealing a static full-frame image with one opacity ramp.
  float inwardFront = smoothstep(0.035, 0.28, progress);
  float frontEdge = edge + inwardFront * 1.02 + (broad - 0.5) * 0.12;
  float interiorBuild = mix(smoothstep(-0.08, 0.08, frontEdge), 1.0, uImpact);
  float advancingCrest = exp(-pow(frontEdge / 0.14, 2.0))
                       * (1.0 - smoothstep(0.26, 0.42, progress)) * (1.0 - uImpact);
  float haze = interior * (0.82 + broad * 0.55) * interiorBuild;
  float ignition = exp(-dot(physical, physical) * 5.0)
                * (1.0 - smoothstep(0.08, 0.25, progress)) * uImpact;
  float heat = clamp(crest * (0.28 + hotPockets * 0.90) + ignition * 0.8, 0.0, 1.0);
  float impactCore = exp(-dot(p, p) * 2.7) * uImpact;
  heat = mix(heat, 0.65 + hotPockets * 0.35, impactCore);
  heat = pow(heat, 1.45);
  // Three explicit editable hue roles: cooler red folds, orange body, warm peaks.
  float bodyHeat = clamp((surface * 0.70 + billow * 0.30 - 0.15) * 1.6, 0.0, 1.0);
  float surfaceHeat = clamp(heat * (0.22 + folds * 0.58)
                    + ridges * litSide * (0.18 + crest * 0.12)
                    + interior * bodyHeat * 0.62 + advancingCrest * 0.35, 0.0, 1.0);
  float deepFold = (1.0 - smoothstep(0.20, 0.47, surface))
                 * smoothstep(0.15, 0.60, billow) * (1.0 - crest * 0.45);
  vec3 foldColor = mix(uRedColor, uSootColor, deepFold * 0.42);
  vec3 color = mix(foldColor, uFlameColor, (0.12 + bodyHeat * 0.88) * (1.0 - deepFold * 0.45));
  color = mix(color, uCoreColor, smoothstep(0.36, 0.92, surfaceHeat));
  float glow = exp(-pow(edge / (0.23 + softness), 2.0)) * 0.22;
  float ignitionDelay = 0.008 + (1.0 - hotPockets) * 0.065;
  float appear = smoothstep(ignitionDelay, ignitionDelay + 0.045, progress);
  float fade = 1.0 - smoothstep(0.42, 0.80, progress);
  float border = smoothstep(0.0, 0.07, uv.x) * (1.0 - smoothstep(0.93, 1.0, uv.x))
               * smoothstep(0.0, 0.07, uv.y) * (1.0 - smoothstep(0.93, 1.0, uv.y));
  float coverage = (flames * 0.85 + advancingCrest * 0.85 + haze + glow + ignition * 0.8 + impactCore * 0.7) * mantle;
  float alpha = (1.0 - exp(-coverage * uIntensity * 2.0)) * appear * fade * border;
  // The hero envelope is a bound, not a visible oval: local tongues split,
  // stretch and burn away at its perimeter while the hot inner mass survives.
  float heroEdge = smoothstep(0.15, 0.68, length(p));
  float tongueCut = smoothstep(0.16 + heroEdge * 0.10,
                              0.64 + heroEdge * 0.12,
                              localBirth * 0.65 + tongues * 0.35);
  float heroSilhouette = mix(1.0, tongueCut, heroEdge * 0.95);
  alpha *= mix(1.0, heroSilhouette, uImpact);
  // Independent local extinction opens gaps before the lingering motes take
  // over. Keep the approved bright body intact until the breakup stage.
  float extinction = smoothstep(0.48, 0.82, progress);
  float survivingFlame = 1.0 - smoothstep(localBirth - 0.16,
                                        localBirth + 0.16, extinction);
  alpha *= mix(1.0, survivingFlame, smoothstep(0.48, 0.58, progress));
  alpha *= texture(uTexture, vTextureCoord).a;
  // Fine grain supports the larger folds without becoming a noisy cutout.
  color *= 0.99 + grain * 0.02;
  // Residual ash appears only after the bright body breaks up. Stable cells
  // drift gently; the last fraction is barely visible rather than another flash.
  vec2 ashPosition = physical * vec2(12.0, 16.0)
                   + vec2(progress * 0.65, progress * 2.0);
  vec2 ashCell = floor(ashPosition);
  vec2 ashLocal = fract(ashPosition) - 0.5;
  float ashSeed = fireHash(ashCell);
  float flakes = step(0.88, ashSeed) * (1.0 - smoothstep(0.07, 0.15,
                 max(abs(ashLocal.x) * 1.7, abs(ashLocal.y))));
  float dust = fireNoise(physical * 5.0 + vec2(0.0, progress * 0.8)) * 0.08;
  float residual = smoothstep(0.60, 0.78, progress)
                 * (1.0 - smoothstep(0.78, 1.0, progress));
  float ashAlpha = (flakes * 0.34 + dust) * residual * mantle * border
                 * texture(uTexture, vTextureCoord).a;
  finalColor = vec4(color * alpha + uSootColor * ashAlpha * (1.0 - alpha),
                    alpha + ashAlpha * (1.0 - alpha));
}`

/** Expanding texture-driven fire blast used by the VFX Lab's area effect. */
export class AoeVfxShader {
  readonly filter: Filter
  private readonly uniforms: AoeVfxUniformValues

  constructor(noise: Texture, seed = 0) {
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
      uSeed: { value: seed, type: 'f32' },
      uFlameColor: { value: hexColorToRgb('#F4A30F'), type: 'vec3<f32>' },
      uCoreColor: { value: hexColorToRgb('#EFE28B'), type: 'vec3<f32>' },
      uRedColor: { value: hexColorToRgb('#EB530D'), type: 'vec3<f32>' },
      uSootColor: { value: hexColorToRgb('#1f130b'), type: 'vec3<f32>' }
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
    this.uniforms.uRedColor.set(hexColorToRgb(palette.redColor ?? palette.flameColor))
    this.uniforms.uSootColor.set(hexColorToRgb(palette.sootColor ?? '#1f130b'))
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
