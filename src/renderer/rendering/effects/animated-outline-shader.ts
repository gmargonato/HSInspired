import { GlProgram, GpuProgram } from 'pixi.js'

/**
 * The distance field is intentionally generated from a deterministic radial
 * pattern. Rings are concentrated near the source boundary, where the dense
 * ribbon needs subpixel precision, while the atmospheric tail can tolerate
 * wider steps. Alternating angular offsets avoid visible radial spokes.
 */
const RING_COUNT = 18
const DIRECTION_COUNT = 12
const GLSL_DISTANCE_SAMPLES: string[] = []
const WGSL_DISTANCE_SAMPLES: string[] = []

for (let ring = 1; ring <= RING_COUNT; ring++) {
  const radiusFraction = Math.pow(ring / RING_COUNT, 1.5)
  const previousRadiusFraction = Math.pow((ring - 1) / RING_COUNT, 1.5)
  const radialStep = radiusFraction - previousRadiusFraction
  const rotation = (ring % 2) * 0.5

  for (let directionIndex = 0; directionIndex < DIRECTION_COUNT; directionIndex++) {
    const angle = (Math.PI * 2 * (directionIndex + rotation)) / DIRECTION_COUNT
    const x = Math.cos(angle).toFixed(6)
    const y = Math.sin(angle).toFixed(6)
    const radius = radiusFraction.toFixed(6)
    const step = radialStep.toFixed(6)
    GLSL_DISTANCE_SAMPLES.push(`
    direction = vec2(${x}, ${y});
    sampleAlpha = texture(uTexture, clamp(uv + direction * maxRadius * ${radius} * uInputPixel.zw, uInputClamp.xy, uInputClamp.zw)).a;
    coverage = smoothstep(0.01, 0.72, sampleAlpha);
    candidate = maxRadius * max(0.0, ${radius} - coverage * ${step});
    if (coverage > 0.001 && candidate < result.distance) {
        result.distance = candidate;
    }`)

    WGSL_DISTANCE_SAMPLES.push(`
  {
    let direction = vec2<f32>(${x}, ${y});
    let sampleAlpha = textureSample(uTexture, uSampler, clamp(uv + direction * maxRadius * ${radius} * gfu.uInputPixel.zw, gfu.uInputClamp.xy, gfu.uInputClamp.zw)).a;
    let coverage = smoothstep(0.01, 0.72, sampleAlpha);
    let candidate = maxRadius * max(0.0, ${radius} - coverage * ${step});
    if (coverage > 0.001 && candidate < result.distance) {
      result.distance = candidate;
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
uniform vec4 uRimColor;
uniform vec4 uGlowColor;
uniform vec4 uHotColor;
uniform vec4 uGeometry;
uniform vec4 uDetail;
uniform vec4 uMotion;
uniform float uTime;

struct DistanceResult { float distance; };

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
    vec2 direction;
    float sampleAlpha;
    float coverage;
    float candidate;
${GLSL_DISTANCE_SAMPLES.join('\n')}
    return result;
}

vec4 layerOver(vec4 below, vec3 color, float alpha) {
    float remaining = 1.0 - alpha;
    return vec4(color * alpha + below.rgb * remaining, alpha + below.a * remaining);
}

void main() {
    float ribbonWidth = uGeometry.x;
    float rimWidth = uGeometry.y;
    float glowWidth = uGeometry.z;
    float glowStrength = uGeometry.w;
    float highlightStrength = uDetail.x;
    float hotspotScale = max(8.0, uDetail.y);
    float hotspotDensity = clamp(uDetail.z, 0.0, 1.0);
    float edgeWobble = max(0.0, uDetail.w);
    float speed = uMotion.x;
    float edgeSoftness = max(0.75, uMotion.y);

    vec4 source = texture(uTexture, vTextureCoord);
    vec2 patternPixel = vTextureCoord * uInputPixel.xy;
    float time = uTime * speed;
    float maxRadius = ribbonWidth + rimWidth + glowWidth + edgeWobble * 1.5 + 3.0;
    DistanceResult field = outlineDistance(vTextureCoord, maxRadius);

    // Preserve the texture's authored antialiasing instead of rebuilding its
    // edge from only near-opaque texels.
    float sourceMask = smoothstep(0.02, 0.78, source.a);
    float exterior = 1.0 - sourceMask;

    // Two moving frequency bands deform the actual contour. The broad field
    // produces a slow bidirectional wobble while the tighter field adds short
    // outward licks, giving the ribbon flame-like motion without blurring it.
    float wobbleScale = max(18.0, hotspotScale * 1.2);
    float wobbleNoise = outlineFbm(patternPixel / wobbleScale + vec2(time * 0.52, -time * 0.37));
    float lickNoise = outlineFbm(patternPixel / max(12.0, wobbleScale * 0.42) + vec2(-time * 1.18, time * 0.74));
    float flameLick = outlineSmooth((lickNoise - 0.56) / 0.34);
    float wobble = ((wobbleNoise - 0.5) * 1.6 + (flameLick - 0.35) * 0.55) * edgeWobble;
    float distanceToEdge = max(0.0, field.distance - wobble);

    // Each material is a complete coverage field layered beneath the previous
    // one. The ribbon keeps an opaque plateau; only its outer shoulder fades.
    // Overlap between fields produces a continuous color transition instead
    // of three hard, non-overlapping strokes.
    float baseAlpha = (1.0 - smoothstep(ribbonWidth - edgeSoftness, ribbonWidth + edgeSoftness, distanceToEdge)) * exterior;
    float rimExtent = ribbonWidth + rimWidth;
    float rimSoftness = edgeSoftness * 1.18;
    float rimAlpha = (1.0 - smoothstep(rimExtent - rimSoftness, rimExtent + rimSoftness, distanceToEdge)) * exterior * 0.92;
    float glowStart = max(ribbonWidth, rimExtent - edgeSoftness * 0.45);
    float glowEnd = rimExtent + glowWidth;
    float glowCoverage = 1.0 - smoothstep(glowStart, glowEnd, distanceToEdge);

    // The atmospheric layer follows the contour motion but varies at a slower
    // frequency, so it breathes independently around the dense material.
    float bloomNoise = outlineFbm(patternPixel * 0.018 + vec2(time * 0.34, -time * 0.23));
    float energyVariation = clamp(edgeWobble / 3.5, 0.0, 1.0);
    float bloomPulse = mix(1.0 - energyVariation * 0.22, 1.0 + energyVariation * 0.32, bloomNoise);
    float haloAlpha = clamp(glowCoverage * exterior * glowStrength * 0.34 * bloomPulse, 0.0, 1.0);

    // Highlights occupy a narrow lane inside the dense ribbon. Noise varies
    // them along the contour, while the lane prevents round blobs from
    // crossing the ribbon or leaking into the rim and halo.
    float laneInner = smoothstep(ribbonWidth * 0.10, ribbonWidth * 0.32, distanceToEdge);
    float laneOuter = 1.0 - smoothstep(ribbonWidth * 0.62, ribbonWidth * 0.84, distanceToEdge);
    float highlightLane = laneInner * laneOuter * baseAlpha;
    float hotspotNoise = outlineFbm(patternPixel / hotspotScale + vec2(-time * 1.10, time * 0.46));
    float hotspotThreshold = mix(0.72, 0.54, hotspotDensity);
    float hotspotMask = smoothstep(hotspotThreshold, hotspotThreshold + 0.13, hotspotNoise);
    float filament = 0.14 + hotspotMask * 0.86;
    float hotspotMix = clamp(highlightLane * filament * highlightStrength * mix(0.80, 1.15, flameLick), 0.0, 1.0);

    // Premultiplied layer-over composition. The ribbon and rim remain dense;
    // only the bloom carries low alpha.
    vec4 result = vec4(0.0);
    result = layerOver(result, uGlowColor.rgb, haloAlpha);
    result = layerOver(result, uRimColor.rgb, rimAlpha);
    result = layerOver(result, uBaseColor.rgb, baseAlpha);
    // Hotspots modify luminance only. Keeping alpha unchanged guarantees that
    // the bright layer can never enlarge the outline silhouette.
    result.rgb = mix(result.rgb, uHotColor.rgb * result.a, hotspotMix);
    finalColor = result;
}
`

const SOURCE_WGSL = `
struct GlobalFilterUniforms { uInputSize: vec4<f32>, uInputPixel: vec4<f32>, uInputClamp: vec4<f32>, uOutputFrame: vec4<f32>, uGlobalFrame: vec4<f32>, uOutputTexture: vec4<f32>, };
struct OutlineUniforms { uBaseColor: vec4<f32>, uRimColor: vec4<f32>, uGlowColor: vec4<f32>, uHotColor: vec4<f32>, uGeometry: vec4<f32>, uDetail: vec4<f32>, uMotion: vec4<f32>, uTime: f32, };
struct DistanceResult { distance: f32, };
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
  var result = DistanceResult(maxRadius);
${WGSL_DISTANCE_SAMPLES.join('\n')}
  return result;
}
fn layerOver(below: vec4<f32>, color: vec3<f32>, alpha: f32) -> vec4<f32> {
  let remaining = 1.0 - alpha;
  return vec4<f32>(color * alpha + below.rgb * remaining, alpha + below.a * remaining);
}

@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let ribbonWidth = outlineUniforms.uGeometry.x; let rimWidth = outlineUniforms.uGeometry.y; let glowWidth = outlineUniforms.uGeometry.z; let glowStrength = outlineUniforms.uGeometry.w;
  let highlightStrength = outlineUniforms.uDetail.x; let hotspotScale = max(8.0, outlineUniforms.uDetail.y); let hotspotDensity = clamp(outlineUniforms.uDetail.z, 0.0, 1.0); let edgeWobble = max(0.0, outlineUniforms.uDetail.w);
  let speed = outlineUniforms.uMotion.x; let edgeSoftness = max(0.75, outlineUniforms.uMotion.y);
  let source = textureSample(uTexture, uSampler, uv); let patternPixel = uv * gfu.uInputPixel.xy; let time = outlineUniforms.uTime * speed; let maxRadius = ribbonWidth + rimWidth + glowWidth + edgeWobble * 1.5 + 3.0;
  let field = outlineDistance(uv, maxRadius); let sourceMask = smoothstep(0.02, 0.78, source.a); let exterior = 1.0 - sourceMask;
  let wobbleScale = max(18.0, hotspotScale * 1.2); let wobbleNoise = outlineFbm(patternPixel / wobbleScale + vec2<f32>(time * 0.52, -time * 0.37)); let lickNoise = outlineFbm(patternPixel / max(12.0, wobbleScale * 0.42) + vec2<f32>(-time * 1.18, time * 0.74)); let flameLick = outlineSmooth((lickNoise - 0.56) / 0.34); let wobble = ((wobbleNoise - 0.5) * 1.6 + (flameLick - 0.35) * 0.55) * edgeWobble; let distanceToEdge = max(0.0, field.distance - wobble);
  let baseAlpha = (1.0 - smoothstep(ribbonWidth - edgeSoftness, ribbonWidth + edgeSoftness, distanceToEdge)) * exterior;
  let rimExtent = ribbonWidth + rimWidth; let rimSoftness = edgeSoftness * 1.18;
  let rimAlpha = (1.0 - smoothstep(rimExtent - rimSoftness, rimExtent + rimSoftness, distanceToEdge)) * exterior * 0.92;
  let glowStart = max(ribbonWidth, rimExtent - edgeSoftness * 0.45); let glowEnd = rimExtent + glowWidth; let glowCoverage = 1.0 - smoothstep(glowStart, glowEnd, distanceToEdge);
  let bloomNoise = outlineFbm(patternPixel * 0.018 + vec2<f32>(time * 0.34, -time * 0.23)); let energyVariation = clamp(edgeWobble / 3.5, 0.0, 1.0); let bloomPulse = mix(1.0 - energyVariation * 0.22, 1.0 + energyVariation * 0.32, bloomNoise); let haloAlpha = clamp(glowCoverage * exterior * glowStrength * 0.34 * bloomPulse, 0.0, 1.0);
  let laneInner = smoothstep(ribbonWidth * 0.10, ribbonWidth * 0.32, distanceToEdge); let laneOuter = 1.0 - smoothstep(ribbonWidth * 0.62, ribbonWidth * 0.84, distanceToEdge); let highlightLane = laneInner * laneOuter * baseAlpha;
  let hotspotNoise = outlineFbm(patternPixel / hotspotScale + vec2<f32>(-time * 1.10, time * 0.46)); let hotspotThreshold = mix(0.72, 0.54, hotspotDensity); let hotspotMask = smoothstep(hotspotThreshold, hotspotThreshold + 0.13, hotspotNoise); let filament = 0.14 + hotspotMask * 0.86; let hotspotMix = clamp(highlightLane * filament * highlightStrength * mix(0.80, 1.15, flameLick), 0.0, 1.0);
  var result = vec4<f32>(0.0); result = layerOver(result, outlineUniforms.uGlowColor.rgb, haloAlpha); result = layerOver(result, outlineUniforms.uRimColor.rgb, rimAlpha); result = layerOver(result, outlineUniforms.uBaseColor.rgb, baseAlpha); result = vec4<f32>(mix(result.rgb, outlineUniforms.uHotColor.rgb * result.a, hotspotMix), result.a); return result;
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
