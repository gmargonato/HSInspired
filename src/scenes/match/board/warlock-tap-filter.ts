import { Filter, GlProgram, GpuProgram, UniformGroup, type Texture } from 'pixi.js'
import { WARLOCK_LIFE_TAP } from './warlock-life-tap-layout'

const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main() {
  vec2 p = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  p.x = p.x * 2.0 / uOutputTexture.x - 1.0;
  p.y = p.y * 2.0 * uOutputTexture.z / uOutputTexture.y - uOutputTexture.z;
  gl_Position = vec4(p, 0.0, 1.0);
  vTextureCoord = aPosition * uOutputFrame.zw * uInputSize.zw;
}`
const fragment = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uRamp;
uniform float uIntensity;
uniform float uRampIntensity;
uniform float uOpacity;
void main() {
  vec4 body = texture(uTexture, vTextureCoord);
  // Energy chooses colour; coverage remains independent of the ramp alpha.
  // Compress energy into the dark-purple/violet ramp; separate motes supply pink highlights.
  // Multiplying both alphas here would attenuate the particle edges twice.
  float energy = max(max(body.r, body.g), body.b) * uIntensity;
  vec4 ramp = texture(uRamp, vec2(mix(0.35, 0.82, energy / (1.0 + energy)), 0.5));
  vec3 straight = body.rgb / max(body.a, 0.0001);
  vec3 colour = mix(straight, ramp.rgb / max(ramp.a, 0.0001), uRampIntensity);
  float alpha = clamp(body.a, 0.0, 1.0) * uOpacity;
  finalColor = vec4(colour * alpha, alpha);
}`
const wgsl = `
struct Globals { uInputSize: vec4<f32>, uInputPixel: vec4<f32>, uInputClamp: vec4<f32>, uOutputFrame: vec4<f32>, uGlobalFrame: vec4<f32>, uOutputTexture: vec4<f32> }
struct Tuning { uIntensity: f32, uRampIntensity: f32, uOpacity: f32 }
@group(0) @binding(0) var<uniform> g: Globals;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> tuning: Tuning;
@group(1) @binding(1) var uRamp: texture_2d<f32>;
@group(1) @binding(2) var uRampSampler: sampler;
struct Output { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn mainVertex(@location(0) aPosition: vec2<f32>) -> Output {
  var p = aPosition * g.uOutputFrame.zw + g.uOutputFrame.xy;
  p.x = p.x * 2.0 / g.uOutputTexture.x - 1.0;
  p.y = p.y * 2.0 * g.uOutputTexture.z / g.uOutputTexture.y - g.uOutputTexture.z;
  return Output(vec4<f32>(p, 0.0, 1.0), aPosition * g.uOutputFrame.zw * g.uInputSize.zw);
}
@fragment fn mainFragment(input: Output) -> @location(0) vec4<f32> {
  let body = textureSample(uTexture, uSampler, input.uv);
  let energy = max(max(body.r, body.g), body.b) * tuning.uIntensity;
  let ramp = textureSample(uRamp, uRampSampler, vec2<f32>(mix(0.35, 0.82, energy / (1.0 + energy)), 0.5));
  let straight = body.rgb / max(body.a, 0.0001);
  let colour = mix(straight, ramp.rgb / max(ramp.a, 0.0001), tuning.uRampIntensity);
  let alpha = clamp(body.a, 0.0, 1.0) * tuning.uOpacity;
  return vec4<f32>(colour * alpha, alpha);
}`

/** Pixi renders the particle group into its pooled filter target each frame. */
export function createWarlockTapFilter(ramp: Texture): Filter {
  const config = WARLOCK_LIFE_TAP.composite
  return new Filter({
    glProgram: GlProgram.from({ vertex, fragment, name: 'warlock-tap-ramp' }),
    gpuProgram: GpuProgram.from({
      vertex: { source: wgsl, entryPoint: 'mainVertex' },
      fragment: { source: wgsl, entryPoint: 'mainFragment' }
    }),
    resources: {
      tuning: new UniformGroup({
        uIntensity: { value: config.intensity, type: 'f32' },
        uRampIntensity: { value: config.rampIntensity, type: 'f32' },
        uOpacity: { value: config.opacity, type: 'f32' }
      }),
      uRamp: ramp.source,
      uRampSampler: ramp.source.style
    },
    padding: config.padding,
    resolution: 1,
    antialias: 'off'
  })
}
