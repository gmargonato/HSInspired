import { Filter, type Texture } from 'pixi.js'
import {
  FIRE_VFX_VERTEX_SHADER,
  FIRE_VFX_NOISE_GLSL,
  hexColorToRgb
} from './fire-vfx-shader-common'

export const MISSILE_VFX_TIMING = {
  launch: 0.16,
  arrival: 0.58,
  trailEnd: 0.84
} as const
export interface MissileVfxPalette {
  readonly flameColor: string
  readonly coreColor: string
}
export interface MissileVfxTuning {
  readonly intensity: number
  readonly noiseScale: number
  readonly flowSpeed: number
  readonly turbulence: number
  readonly width: number
  /** Maximum deposited trail length, in design pixels. */
  readonly trailLength: number
}
interface MissileVfxUniformValues {
  uTime: number
  uProgress: number
  uIntensity: number
  uNoiseScale: number
  uFlowSpeed: number
  uTurbulence: number
  uWidth: number
  uTrailLength: number
  uSize: Float32Array
  uSource: Float32Array
  uTarget: Float32Array
  uFlameColor: Float32Array
  uCoreColor: Float32Array
}
const fragment = `#version 300 es
in vec2 vTextureCoord;
in vec2 vVfxUv;
out vec4 finalColor;
uniform sampler2D uTexture, uNoise;
uniform float uTime, uProgress, uIntensity, uNoiseScale, uFlowSpeed, uTurbulence, uWidth, uTrailLength;
uniform vec2 uSize, uSource, uTarget;
uniform vec3 uFlameColor, uCoreColor;
${FIRE_VFX_NOISE_GLSL}
// Coverage and heat for a spherical flame. Dissolve opens holes before fading.
vec2 fireOrb(vec2 p, float radius, float age, float seed) {
  float t = uTime * uFlowSpeed;
  vec2 flow = p / radius * uNoiseScale * 0.68;
  vec2 warp = vec2(fireFbm(flow + t * 0.8 + seed), fireFbm(flow - t + seed + 9.2)) - 0.5;
  float cloud = fireFbm(flow + warp * 2.1 + vec2(0.0, -t * 1.5) + seed);
  float d = length(p) / radius;
  float detail = fireFbm(flow * 2.8 + warp * 3.5 - vec2(t * 0.4, t * 2.1));
  float edge = d + (cloud - 0.5) * uTurbulence * 1.2 + (detail - 0.5) * 0.20;
  float body = 1.0 - smoothstep(0.85, 1.06, edge);
  body *= mix(0.48, 1.0, smoothstep(0.28, 0.65, detail));
  float erosion = smoothstep(age * 0.92 - 0.06, age * 0.92 + 0.12, cloud);
  float heat = clamp(0.98 - d * 0.43 + (cloud - 0.5) * 0.85 + (detail - 0.5) * 1.1, 0.0, 1.0);
  return vec2(body * erosion, heat);
}
void main() {
  vec2 pixel = vVfxUv * uSize;
  float progress = clamp(uProgress, 0.0, 1.0);
  float t = uTime * uFlowSpeed;
  vec2 path = uTarget - uSource;
  float distance = max(length(path), 1.0);
  vec2 direction = path / distance;
  vec2 normal = vec2(-direction.y, direction.x);
  vec2 relative = pixel - uSource;
  float along = dot(relative, direction);
  float across = dot(relative, normal);
  float flight = clamp((progress - ${MISSILE_VFX_TIMING.launch}) / ${MISSILE_VFX_TIMING.arrival - MISSILE_VFX_TIMING.launch}, 0.0, 1.0);
  float travel = distance * pow(flight, 1.08);
  float post = clamp((progress - ${MISSILE_VFX_TIMING.arrival}) / ${1 - MISSILE_VFX_TIMING.arrival}, 0.0, 1.0);
  float radius = mix(33.0, 59.0, clamp((uWidth - 0.12) / 0.36, 0.0, 1.0));
  vec2 headPoint = uSource + direction * travel;
  vec2 head = fireOrb(pixel - headPoint, radius, 0.0, 3.0);
  float launch = smoothstep(${MISSILE_VFX_TIMING.launch}, ${MISSILE_VFX_TIMING.launch + 0.035}, progress);
  head.x *= launch * (1.0 - smoothstep(${MISSILE_VFX_TIMING.arrival}, ${MISSILE_VFX_TIMING.arrival + 0.035}, progress));

  // The wake occupies the path already travelled; it never extends behind the caster.
  float tailStart = max(0.0, travel - uTrailLength);
  float behind = clamp((travel - along) / max(min(travel, uTrailLength), 1.0), 0.0, 1.0);
  float age = clamp((progress - ${MISSILE_VFX_TIMING.arrival}) / ${MISSILE_VFX_TIMING.trailEnd - MISSILE_VFX_TIMING.arrival}, 0.0, 1.0);
  vec2 flow = vec2(along / 75.0 + t * 1.5, across / 62.0) * uNoiseScale * 0.5;
  vec2 warp = vec2(fireFbm(flow + 12.1), fireFbm(flow + 31.7)) - 0.5;
  float noise = fireFbm(flow + warp * 2.7);
  float curl = warp.y * 38.0 * uTurbulence;
  float width = radius * mix(0.12, 0.66, pow(1.0 - behind, 0.55));
  width *= mix(0.60, 1.45, noise);
  // Separate moving sheets create overlapping tongues, rather than a solid tube.
  vec2 sheetUv = vec2(across / max(radius, 1.0) * 3.8, along / 95.0 + t * 3.0);
  float sheets = 0.0;
  float hotThreads = 0.0;
  for (int layer = 0; layer < 3; layer++) {
    float seed = float(layer) * 17.3;
    vec2 uv = sheetUv + vec2(seed, -t * float(layer) * 0.65);
    float folds = fireFbm(uv + warp * (2.0 + float(layer)));
    float fine = fireNoise(uv * vec2(3.2, 2.1) + folds * 3.5);
    float offset = (folds - 0.5) * radius * 1.25 * uTurbulence;
    float envelope = 1.0 - smoothstep(width * 0.25, width * 1.35 + 3.0, abs(across + curl + offset));
    float tongue = smoothstep(0.37 + behind * 0.10, 0.62, folds + (fine - 0.5) * 0.22);
    sheets = max(sheets, envelope * tongue);
    hotThreads = max(hotThreads, envelope * smoothstep(0.55, 0.72, folds) * (0.5 + fine * 0.5));
  }
  float wake = sheets;
  wake *= smoothstep(tailStart - 8.0, tailStart + 20.0, along) * (1.0 - smoothstep(travel - 5.0, travel + 12.0, along));
  // Old tail sections become isolated wisps first; the head end dies last.
  float erosion = age * 0.90 + behind * 0.15;
  wake *= smoothstep(erosion - 0.06, erosion + 0.16, noise) * launch;
  wake *= 1.0 - smoothstep(0.70, 1.0, age);
  float wakeHeat = clamp(0.40 + hotThreads * 0.75 + noise * 0.15 - behind * 0.12, 0.0, 1.0);

  // Brief launch charge only; the reference's persistent caster flame is another cast.
  vec2 origin = pixel - uSource;
  float chargeRadius = radius * (0.9 + 0.65 * smoothstep(0.0, ${MISSILE_VFX_TIMING.launch}, progress));
  float angle = atan(origin.y, origin.x);
  float swirl = sin(angle * 4.0 + length(origin) * 0.045 - t * 6.0);
  vec2 charge = fireOrb(origin, chargeRadius * (1.0 + swirl * 0.12), 0.0, 11.0);
  charge.x *= smoothstep(0.0, 0.065, progress) * (1.0 - smoothstep(${MISSILE_VFX_TIMING.launch}, ${MISSILE_VFX_TIMING.launch + 0.075}, progress));
  float twist = t * 1.8 + length(origin) / chargeRadius * 2.4;
  mat2 turn = mat2(cos(twist), -sin(twist), sin(twist), cos(twist));
  float petals = fireFbm(turn * origin / chargeRadius * 3.0 + 19.7);
  charge.x *= mix(0.30, 1.0, smoothstep(0.24, 0.60, petals));
  charge.y = clamp(charge.y - 0.18 + petals * 0.16, 0.0, 1.0);

  // Arrival blooms into a flash, then the spherical shell tears apart.
  float impactRadius = radius * (1.10 + 1.1 * smoothstep(0.0, 0.72, post));
  vec2 impact = fireOrb(pixel - uTarget, impactRadius, smoothstep(0.16, 1.0, post) * 0.78, 23.1);
  impact.x *= smoothstep(${MISSILE_VFX_TIMING.arrival - 0.008}, ${MISSILE_VFX_TIMING.arrival + 0.04}, progress);
  impact.x *= 1.0 - smoothstep(0.76, 1.0, post);
  // The flash opens into a torn shell before the last peripheral wisps vanish.
  float hollow = smoothstep(0.25, 0.70, length(pixel - uTarget) / impactRadius);
  impact.x *= mix(1.0, hollow, smoothstep(0.18, 0.48, post));
  impact.y = mix(1.0, impact.y, smoothstep(0.0, 0.30, post));
  impact.y *= 1.0 - 0.55 * smoothstep(0.30, 0.90, post);
  float flame = max(max(head.x, wake), max(charge.x, impact.x));
  float heat = wakeHeat;
  if (charge.x > wake) heat = charge.y;
  if (head.x > max(wake, charge.x)) heat = head.y;
  if (impact.x > max(head.x, max(wake, charge.x))) heat = impact.y;
  float halo = exp(-dot(pixel-headPoint, pixel-headPoint) / (radius*radius*2.8)) * head.x * 0.20;
  halo += exp(-dot(origin,origin) / (chargeRadius*chargeRadius*1.8)) * charge.x * 0.12;
  halo += exp(-dot(pixel-uTarget,pixel-uTarget) / (impactRadius*impactRadius*1.8)) * impact.x * 0.24;
  vec3 color = mix(uFlameColor * vec3(1.0,0.35,0.12), uFlameColor, smoothstep(0.0,0.45,heat));
  color = mix(color, uCoreColor, pow(smoothstep(0.48,1.0,heat), 1.35));
  float grain = texture(uNoise, fract(pixel / 700.0 + vec2(0.0,-t*0.05))).r;
  color *= 0.985 + grain * 0.03;
  float alpha = (1.0 - exp(-(flame * 1.7 + halo) * uIntensity));
  alpha *= smoothstep(0.0,0.015,progress) * (1.0-smoothstep(0.97,1.0,progress));
  alpha *= texture(uTexture,vTextureCoord).a;
  // A restrained emissive layer lights the hottest folds without whitening the red body.
  vec3 emission = uCoreColor * pow(max(heat - 0.55, 0.0) / 0.45, 3.0) * 0.18;
  finalColor = vec4((color + emission) * alpha, alpha);
}`

/** Charge, deposited trail, arrival flash and dissolving flame shell in one bounded quad. */
export class MissileVfxShader {
  readonly filter: Filter
  private readonly uniforms: MissileVfxUniformValues
  constructor(noise: Texture) {
    this.filter = Filter.from({
      gl: {
        vertex: FIRE_VFX_VERTEX_SHADER,
        fragment,
        name: 'missile-vfx',
        preferredFragmentPrecision: 'highp'
      },
      padding: 0,
      antialias: 'inherit',
      resources: {
        uNoise: noise.source,
        missileVfxUniforms: {
          uTime: { value: 0, type: 'f32' },
          uProgress: { value: 1, type: 'f32' },
          uIntensity: { value: 1.7, type: 'f32' },
          uNoiseScale: { value: 2.8, type: 'f32' },
          uFlowSpeed: { value: 1.2, type: 'f32' },
          uTurbulence: { value: 0.85, type: 'f32' },
          uWidth: { value: 0.32, type: 'f32' },
          uTrailLength: { value: 550, type: 'f32' },
          uSize: { value: new Float32Array([290, 945]), type: 'vec2<f32>' },
          uSource: { value: new Float32Array([145, 800]), type: 'vec2<f32>' },
          uTarget: { value: new Float32Array([145, 145]), type: 'vec2<f32>' },
          uFlameColor: { value: hexColorToRgb('#ff4b08'), type: 'vec3<f32>' },
          uCoreColor: { value: hexColorToRgb('#ffd13b'), type: 'vec3<f32>' }
        }
      }
    })
    this.uniforms = this.filter.resources.missileVfxUniforms
      .uniforms as MissileVfxUniformValues
  }
  setPalette(palette: MissileVfxPalette): void {
    this.uniforms.uFlameColor.set(hexColorToRgb(palette.flameColor))
    this.uniforms.uCoreColor.set(hexColorToRgb(palette.coreColor))
  }
  setTuning(tuning: MissileVfxTuning): void {
    this.uniforms.uIntensity = tuning.intensity
    this.uniforms.uNoiseScale = tuning.noiseScale
    this.uniforms.uFlowSpeed = tuning.flowSpeed
    this.uniforms.uTurbulence = tuning.turbulence
    this.uniforms.uWidth = tuning.width
    this.uniforms.uTrailLength = tuning.trailLength
  }
  setGeometry(
    size: { width: number; height: number },
    source: { x: number; y: number },
    target: { x: number; y: number }
  ): void {
    this.uniforms.uSize.set([size.width, size.height])
    this.uniforms.uSource.set([source.x, source.y])
    this.uniforms.uTarget.set([target.x, target.y])
  }
  setFrame(time: number, progress: number): void {
    this.uniforms.uTime = time
    this.uniforms.uProgress = progress
  }
  dispose(): void {
    this.filter.destroy()
  }
}
