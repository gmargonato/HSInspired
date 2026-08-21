import { GlProgram, GpuProgram } from 'pixi.js'

const RING_COUNT = 8
const DIRECTION_COUNT = 8
const GLSL_DISTANCE_SAMPLES: string[] = []
const WGSL_DISTANCE_SAMPLES: string[] = []

for (let ring = 1; ring <= RING_COUNT; ring++) {
  const radiusFraction = ring / RING_COUNT
  const rotation = ring * 0.38196601125

  for (let directionIndex = 0; directionIndex < DIRECTION_COUNT; directionIndex++) {
    const angle = (Math.PI * 2 * (directionIndex + rotation)) / DIRECTION_COUNT
    const x = Math.cos(angle).toFixed(6)
    const y = Math.sin(angle).toFixed(6)
    const radius = radiusFraction.toFixed(6)
    GLSL_DISTANCE_SAMPLES.push(`
    direction = vec2(${x}, ${y});
    sampleAlpha = texture(uTexture, clamp(uv + direction * maxRadius * ${radius} * uInputPixel.zw, uInputClamp.xy, uInputClamp.zw)).a;
    candidate = mix(maxRadius, maxRadius * ${radius}, sampleAlpha);
    if (candidate < result.distance) {
        result.distance = candidate;
        result.inward = direction;
    }`)

    WGSL_DISTANCE_SAMPLES.push(`
  {
    let direction = vec2<f32>(${x}, ${y});
    let sampleAlpha = textureSample(uTexture, uSampler, clamp(uv + direction * maxRadius * ${radius} * gfu.uInputPixel.zw, gfu.uInputClamp.xy, gfu.uInputClamp.zw)).a;
    let candidate = mix(maxRadius, maxRadius * ${radius}, sampleAlpha);
    if (candidate < result.distance) {
      result.distance = candidate;
      result.inward = direction;
    }
  }`)
  }
}

const VERTEX_GLSL = `
in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition(void) {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord(void) {
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void) {
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`

const FRAGMENT_GLSL = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputPixel;
uniform vec4 uInputClamp;
uniform vec4 uBaseColor;
uniform vec4 uEdgeColor;
uniform vec4 uShape;
uniform vec4 uAtmosphere;
uniform vec4 uSurface;
uniform vec4 uMotion;
uniform float uTime;

struct DistanceResult { float distance; vec2 inward; };

float outlineSmooth(float x) {
    float t = clamp(x, 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

float outlineHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float outlineNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(outlineHash(i), outlineHash(i + vec2(1.0, 0.0)), u.x), mix(outlineHash(i + vec2(0.0, 1.0)), outlineHash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float outlineFbm(vec2 p) {
    return 0.62 * outlineNoise(p) + 0.28 * outlineNoise(p * 2.07 + 11.3) + 0.10 * outlineNoise(p * 4.11 + 29.7);
}

DistanceResult outlineDistance(vec2 uv, float maxRadius) {
    DistanceResult result;
    result.distance = maxRadius;
    result.inward = vec2(0.0, 1.0);
    vec2 direction;
    float sampleAlpha;
    float candidate;
${GLSL_DISTANCE_SAMPLES.join('\n')}
    return result;
}

void main() {
    // Pixi's input-pixel uniform converts texture UVs to pixels and its
    // reciprocal converts requested outline pixels back to texture UVs.
    float width = uShape.x;
    float feather = uShape.y;
    float coreWidth = uShape.z;
    float lipWidth = uShape.w;
    float bodyAlpha = uAtmosphere.x;
    float blobExpansion = uAtmosphere.y;
    float textureStrength = uSurface.x;
    float textureScale = uSurface.y;
    float specularStrength = uSurface.z;
    float specularPower = uSurface.w;
    float speed = uMotion.x;
    float pearlScale = uMotion.y;
    float coreWhiteness = uMotion.z;

    vec4 source = texture(uTexture, vTextureCoord);
    vec2 pixel = vTextureCoord * uInputPixel.xy;
    vec2 patternPixel = pixel;
    float time = uTime * speed;
    float maxRadius = width + feather + blobExpansion + 3.0;
    DistanceResult field = outlineDistance(vTextureCoord, maxRadius);
    float blobNoise = outlineFbm(patternPixel * 0.02 + vec2(time * 0.7, -time * 0.5));
    float blobWeight = pow(outlineSmooth((blobNoise - 0.42) / 0.45), 2.0);
    float distanceToEdge = field.distance - blobWeight * blobExpansion;
    float sourceMask = outlineSmooth((source.a - 0.04) / 0.5);
    float exterior = 1.0 - sourceMask;
    // Keep the GLSL path compatible with WebGL 1. Pixi may fall back to it,
    // and derivatives are not available there unless an extension is enabled.
    float antiAlias = 0.5;
    float edgeWidth = max(feather, antiAlias);
    float ribbonAlpha = 1.0 - smoothstep(max(0.0, width - edgeWidth), width + edgeWidth, distanceToEdge);
    ribbonAlpha *= exterior;
    float coreWeight = 1.0 - smoothstep(coreWidth, coreWidth + max(antiAlias, edgeWidth * 0.55), distanceToEdge);
    coreWeight *= ribbonAlpha;
    float lipStart = max(coreWidth + antiAlias, width - lipWidth);
    float lipWeight = smoothstep(lipStart - edgeWidth * 0.45, lipStart + edgeWidth * 0.45, distanceToEdge) * ribbonAlpha;
    float mainWeight = ribbonAlpha * (1.0 - coreWeight) * (1.0 - lipWeight * 0.82);

    vec2 outward = -normalize(field.inward);
    vec2 lightDirection = normalize(vec2(0.55, -0.83));
    float directional = pow(max(dot(outward, lightDirection), 0.0), specularPower);
    float pearlNoise = outlineFbm(patternPixel / max(8.0, pearlScale) + vec2(-time * 1.65, time * 0.55));
    float pearl = directional * outlineSmooth((pearlNoise - 0.43) / 0.28) * specularStrength * ribbonAlpha;
    float surfaceNoise = outlineFbm(patternPixel / max(8.0, textureScale) + vec2(time * 0.82, -time * 1.18));
    float surfaceLight = 1.0 + (surfaceNoise * 2.0 - 1.0) * textureStrength;
    float travelingWave = 0.5 + 0.5 * sin(patternPixel.x * 0.052 + patternPixel.y * 0.031 - time * 5.2 + surfaceNoise * 4.4);
    float caustic = outlineSmooth((surfaceNoise + travelingWave * 0.38 - 0.46) / 0.42);
    float slowBreath = 0.96 + 0.04 * sin(time * 2.4);
    surfaceLight *= (0.72 + caustic * 0.56) * slowBreath;
    pearl *= 0.72 + travelingWave * 0.48;

    vec3 coreColor = mix(uBaseColor.rgb, vec3(1.0), coreWhiteness);
    vec3 effectRgb = coreColor * coreWeight;
    effectRgb += uBaseColor.rgb * mainWeight * surfaceLight;
    effectRgb += uEdgeColor.rgb * lipWeight * (0.86 + surfaceNoise * 0.12);
    effectRgb += vec3(1.0) * pearl * 0.68;
    float effectAlpha = min(1.0, ribbonAlpha * bodyAlpha + pearl * 0.22);
    finalColor = vec4(effectRgb * bodyAlpha, effectAlpha);
}
`

const SOURCE_WGSL = `
struct GlobalFilterUniforms { uInputSize: vec4<f32>, uInputPixel: vec4<f32>, uInputClamp: vec4<f32>, uOutputFrame: vec4<f32>, uGlobalFrame: vec4<f32>, uOutputTexture: vec4<f32>, };
struct OutlineUniforms { uBaseColor: vec4<f32>, uEdgeColor: vec4<f32>, uShape: vec4<f32>, uAtmosphere: vec4<f32>, uSurface: vec4<f32>, uMotion: vec4<f32>, uTime: f32, };
struct DistanceResult { distance: f32, inward: vec2<f32>, };
@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> outlineUniforms: OutlineUniforms;
struct VSOutput { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32>, };

fn filterVertexPosition(aPosition: vec2<f32>) -> vec4<f32> {
  var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
  position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;
  return vec4<f32>(position, 0.0, 1.0);
}
fn filterTextureCoord(aPosition: vec2<f32>) -> vec2<f32> { return aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw); }
@vertex fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput { return VSOutput(filterVertexPosition(aPosition), filterTextureCoord(aPosition)); }
fn outlineSmooth(x: f32) -> f32 { let t = clamp(x, 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
fn outlineHash(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453123); }
fn outlineNoise(p: vec2<f32>) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(outlineHash(i), outlineHash(i + vec2<f32>(1.0, 0.0)), u.x), mix(outlineHash(i + vec2<f32>(0.0, 1.0)), outlineHash(i + vec2<f32>(1.0, 1.0)), u.x), u.y);
}
fn outlineFbm(p: vec2<f32>) -> f32 { return 0.62 * outlineNoise(p) + 0.28 * outlineNoise(p * 2.07 + 11.3) + 0.10 * outlineNoise(p * 4.11 + 29.7); }
fn outlineDistance(uv: vec2<f32>, maxRadius: f32) -> DistanceResult {
  var result = DistanceResult(maxRadius, vec2<f32>(0.0, 1.0));
${WGSL_DISTANCE_SAMPLES.join('\n')}
  return result;
}

@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let width = outlineUniforms.uShape.x; let feather = outlineUniforms.uShape.y; let coreWidth = outlineUniforms.uShape.z; let lipWidth = outlineUniforms.uShape.w;
  let bodyAlpha = outlineUniforms.uAtmosphere.x; let blobExpansion = outlineUniforms.uAtmosphere.y;
  let textureStrength = outlineUniforms.uSurface.x; let textureScale = outlineUniforms.uSurface.y; let specularStrength = outlineUniforms.uSurface.z; let specularPower = outlineUniforms.uSurface.w;
  let speed = outlineUniforms.uMotion.x; let pearlScale = outlineUniforms.uMotion.y; let coreWhiteness = outlineUniforms.uMotion.z;
  let source = textureSample(uTexture, uSampler, uv); let pixel = uv * gfu.uInputPixel.xy; let patternPixel = pixel; let time = outlineUniforms.uTime * speed;
  let maxRadius = width + feather + blobExpansion + 3.0; let field = outlineDistance(uv, maxRadius);
  let blobNoise = outlineFbm(patternPixel * 0.02 + vec2<f32>(time * 0.7, -time * 0.5));
  let blobWeight = pow(outlineSmooth((blobNoise - 0.42) / 0.45), 2.0);
  let distanceToEdge = field.distance - blobWeight * blobExpansion;
  let sourceMask = outlineSmooth((source.a - 0.04) / 0.5); let exterior = 1.0 - sourceMask;
  let antiAlias = 0.5; let edgeWidth = max(feather, antiAlias);
  var ribbonAlpha = 1.0 - smoothstep(max(0.0, width - edgeWidth), width + edgeWidth, distanceToEdge); ribbonAlpha *= exterior;
  var coreWeight = 1.0 - smoothstep(coreWidth, coreWidth + max(antiAlias, edgeWidth * 0.55), distanceToEdge); coreWeight *= ribbonAlpha;
  let lipStart = max(coreWidth + antiAlias, width - lipWidth);
  let lipWeight = smoothstep(lipStart - edgeWidth * 0.45, lipStart + edgeWidth * 0.45, distanceToEdge) * ribbonAlpha;
  let mainWeight = ribbonAlpha * (1.0 - coreWeight) * (1.0 - lipWeight * 0.82);
  let outward = -normalize(field.inward); let lightDirection = normalize(vec2<f32>(0.55, -0.83));
  let directional = pow(max(dot(outward, lightDirection), 0.0), specularPower);
  let pearlNoise = outlineFbm(patternPixel / max(8.0, pearlScale) + vec2<f32>(-time * 1.65, time * 0.55));
  var pearl = directional * outlineSmooth((pearlNoise - 0.43) / 0.28) * specularStrength * ribbonAlpha;
  let surfaceNoise = outlineFbm(patternPixel / max(8.0, textureScale) + vec2<f32>(time * 0.82, -time * 1.18));
  var surfaceLight = 1.0 + (surfaceNoise * 2.0 - 1.0) * textureStrength;
  let travelingWave = 0.5 + 0.5 * sin(patternPixel.x * 0.052 + patternPixel.y * 0.031 - time * 5.2 + surfaceNoise * 4.4); let caustic = outlineSmooth((surfaceNoise + travelingWave * 0.38 - 0.46) / 0.42); let slowBreath = 0.96 + 0.04 * sin(time * 2.4); surfaceLight *= (0.72 + caustic * 0.56) * slowBreath; pearl *= 0.72 + travelingWave * 0.48;
  let coreColor = mix(outlineUniforms.uBaseColor.rgb, vec3<f32>(1.0), coreWhiteness);
  var effectRgb = coreColor * coreWeight;
  effectRgb += outlineUniforms.uBaseColor.rgb * mainWeight * surfaceLight;
  effectRgb += outlineUniforms.uEdgeColor.rgb * lipWeight * (0.86 + surfaceNoise * 0.12);
  effectRgb += vec3<f32>(1.0) * pearl * 0.68;
  let effectAlpha = min(1.0, ribbonAlpha * bodyAlpha + pearl * 0.22);
  return vec4<f32>(effectRgb * bodyAlpha, effectAlpha);
}
`

export function createAnimatedOutlineGlProgram(): GlProgram {
  return GlProgram.from({
    vertex: VERTEX_GLSL,
    fragment: FRAGMENT_GLSL,
    name: 'animated-outline'
  })
}

export function createAnimatedOutlineGpuProgram(): GpuProgram {
  return GpuProgram.from({
    vertex: { source: SOURCE_WGSL, entryPoint: 'mainVertex' },
    fragment: { source: SOURCE_WGSL, entryPoint: 'mainFragment' }
  })
}
