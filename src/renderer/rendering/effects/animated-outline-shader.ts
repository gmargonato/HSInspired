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

  if (ring < RING_COUNT) {
    // Coverage is in [0, 1], so a later ring's candidate cannot be closer
    // than that ring's radius minus its radial step: this ring's radius
    // or farther. Once the current minimum is below that bound, all of
    // the remaining texture samples would leave the result unchanged.
    // Allow for the six-decimal shader literals and float arithmetic by
    // lowering the bound conservatively; borderline pixels keep searching.
    const remainingDistanceLowerBound = (radiusFraction - 0.00001).toFixed(6)
    GLSL_DISTANCE_SAMPLES.push(`
    if (result.distance < maxRadius * ${remainingDistanceLowerBound}) {
        return result;
    }`)
    WGSL_DISTANCE_SAMPLES.push(`
  if (result.distance < maxRadius * ${remainingDistanceLowerBound}) {
    return result;
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

export type OutlineShaderMode = 'live' | 'distance' | 'cached'

function fragmentGlsl(mode: OutlineShaderMode): string {
  return `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
${mode === 'cached' ? 'uniform highp sampler2D uDistanceCache;' : ''}
uniform vec4 uInputPixel;
uniform vec4 uInputClamp;
uniform vec4 uBaseColor;
uniform vec4 uRimColor;
uniform vec4 uGlowColor;
uniform vec4 uHotColor;
uniform vec4 uGeometry;
uniform vec4 uDetail;
uniform vec4 uMotion;
uniform vec4 uOrganic;
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
${
  mode === 'cached'
    ? `
    highp uvec4 bytes = uvec4(round(texelFetch(uDistanceCache, ivec2(uv * uInputPixel.xy), 0) * 255.0));
    highp uint bits = bytes.x | (bytes.y << 8u) | (bytes.z << 16u) | (bytes.w << 24u);
    return DistanceResult(uintBitsToFloat(bits));`
    : `
    DistanceResult result;
    result.distance = maxRadius;
    vec2 direction;
    float sampleAlpha;
    float coverage;
    float candidate;
${GLSL_DISTANCE_SAMPLES.join('\n')}
    return result;
`
}
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
    float innerEdgeWidth = max(0.0, uMotion.z);
    float pulseRate = max(0.0, uMotion.w);

    vec4 source = texture(uTexture, vTextureCoord);
    // Fully covered source pixels contribute no exterior outline. Avoid the
    // 216-sample distance search across the opaque interior of the proxy.
    if (source.a >= 0.78) {
        finalColor = vec4(0.0);
        return;
    }
    vec2 patternPixel = vTextureCoord * uInputPixel.xy;
    float time = uTime * speed;
    // Broad, slow field that makes the aura run thick on one side and thin
    // on another, like hand-painted light, instead of a parallel band.
    float contourVariation = clamp(uOrganic.x / 10.0, 0.0, 1.0);
    float variationNoise = outlineFbm(patternPixel * 0.012 + vec2(time * 0.11, -time * 0.07));
    float widthScale = mix(1.0 - contourVariation * 0.45, 1.0 + contourVariation * 0.55, variationNoise);
    float maxRadius = (ribbonWidth + rimWidth + glowWidth) * (1.0 + contourVariation * 0.55) + edgeWobble * 1.5 + 3.0;
    DistanceResult field = outlineDistance(vTextureCoord, maxRadius);
${
  mode === 'distance'
    ? `
    // Store the float's bits, not a quantized distance. This target is data:
    // blending, MSAA, dithering and interpolated cache reads are disabled.
    highp uint bits = floatBitsToUint(field.distance);
    highp uvec4 bytes = uvec4(bits, bits >> 8u, bits >> 16u, bits >> 24u) & uvec4(255u);
    finalColor = vec4(bytes) / 255.0;
    return;
`
    : `

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

    // Widths follow the organic field so the aura thickens and thins along
    // the contour instead of sitting at one constant distance.
    float ribbon = ribbonWidth * widthScale;
    float rim = rimWidth * widthScale;
    float glow = glowWidth * widthScale;

    // Monotonic materials: every layer is brightest at the silhouette and
    // decays outward with no plateau, reading as a hot core that diffuses
    // into a long soft tail. The core alone stays flat-bright across its
    // first stretch so a thin ribbon still reads as a solid hot band.
    float coreFlat = ribbon * 0.6;
    float coreAlpha = (1.0 - smoothstep(coreFlat, ribbon + edgeSoftness, distanceToEdge)) * exterior;
    float rimAlpha = pow(1.0 - clamp(distanceToEdge / (ribbon + rim + edgeSoftness * 1.2), 0.0, 1.0), 1.6) * exterior * 0.9;
    float tailStart = (ribbon + rim) * 0.35;
    float tailReach = max(ribbon + rim + glow, tailStart + 0.001);
    float tailT = clamp((distanceToEdge - tailStart) / (tailReach - tailStart), 0.0, 1.0);
    float tailAlpha = pow(1.0 - tailT, 2.4) * exterior;

    // A continuous pale stroke hugging the silhouette boundary, like a heated
    // inner lip. It only exists within the ribbon's reach, so it never
    // enlarges the outline silhouette.
    float innerEdgeAlpha = 0.0;
    if (innerEdgeWidth > 0.0) {
        innerEdgeAlpha = (1.0 - smoothstep(0.0, innerEdgeWidth, distanceToEdge)) * exterior;
    }

    // The pow falloffs reach exactly zero at their boundary; past it and the
    // inner stroke there is nothing to composite. Avoid the bloom and
    // highlight noise for those pixels.
    float maxReach = max(ribbon + edgeSoftness, max(ribbon + rim + edgeSoftness * 1.2, max(tailReach, innerEdgeWidth)));
    if (distanceToEdge >= maxReach) {
        finalColor = vec4(0.0);
        return;
    }

    // The atmospheric layer follows the contour motion but varies at a slower
    // frequency, so it breathes independently around the dense material.
    float bloomNoise = outlineFbm(patternPixel * 0.018 + vec2(time * 0.34, -time * 0.23));
    float energyVariation = clamp(edgeWobble / 3.5, 0.0, 1.0);
    float bloomPulse = mix(1.0 - energyVariation * 0.22, 1.0 + energyVariation * 0.32, bloomNoise);
    float haloAlpha = clamp(tailAlpha * glowStrength * 0.55 * bloomPulse, 0.0, 1.0);

    // Highlights occupy a narrow lane inside the dense ribbon. Noise varies
    // them along the contour, while the lane prevents round blobs from
    // crossing the ribbon or leaking into the rim and halo.
    float laneInner = smoothstep(ribbon * 0.10, ribbon * 0.32, distanceToEdge);
    float laneOuter = 1.0 - smoothstep(ribbon * 0.62, ribbon * 0.84, distanceToEdge);
    float highlightLane = laneInner * laneOuter * coreAlpha;
    float hotspotMix = 0.0;
    // Outside the highlight lane this multiplication is exactly zero,
    // regardless of the noise value. Keep the original math inside it.
    if (highlightLane != 0.0 && highlightStrength != 0.0) {
        float hotspotNoise = outlineFbm(patternPixel / hotspotScale + vec2(-time * 1.10, time * 0.46));
        float hotspotThreshold = mix(0.72, 0.54, hotspotDensity);
        float hotspotMask = smoothstep(hotspotThreshold, hotspotThreshold + 0.13, hotspotNoise);
        float filament = 0.14 + hotspotMask * 0.86;
        hotspotMix = clamp(highlightLane * filament * highlightStrength * mix(0.80, 1.15, flameLick), 0.0, 1.0);
    }

    // Premultiplied layer-over composition. The core stays dense; the tail
    // carries low alpha.
    vec4 result = vec4(0.0);
    result = layerOver(result, uGlowColor.rgb, haloAlpha);
    result = layerOver(result, uRimColor.rgb, rimAlpha);
    result = layerOver(result, uBaseColor.rgb, coreAlpha);
    result = layerOver(result, uHotColor.rgb, innerEdgeAlpha);
    // Hotspots modify luminance only. Keeping alpha unchanged guarantees that
    // the bright layer can never enlarge the outline silhouette.
    result.rgb = mix(result.rgb, uHotColor.rgb * result.a, hotspotMix);
    // Whole-aura breathing. Scaling the premultiplied result fades coverage
    // and color together, dimming the glow instead of darkening it.
    // pulseRate counts half-cycles per second: 1 gives a slow 2s breath.
    float breathe = 1.0;
    if (pulseRate != 0.0) {
        breathe = 1.0 - 0.12 * (0.5 - 0.5 * sin(uTime * pulseRate * 3.1415927));
    }
    finalColor = result * breathe;
`
}
}
`
}

function sourceWgsl(mode: OutlineShaderMode): string {
  return `
struct GlobalFilterUniforms { uInputSize: vec4<f32>, uInputPixel: vec4<f32>, uInputClamp: vec4<f32>, uOutputFrame: vec4<f32>, uGlobalFrame: vec4<f32>, uOutputTexture: vec4<f32>, };
struct OutlineUniforms { uBaseColor: vec4<f32>, uRimColor: vec4<f32>, uGlowColor: vec4<f32>, uHotColor: vec4<f32>, uGeometry: vec4<f32>, uDetail: vec4<f32>, uMotion: vec4<f32>, uOrganic: vec4<f32>, uTime: f32, };
struct DistanceResult { distance: f32, };
@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> outlineUniforms: OutlineUniforms;
${mode === 'cached' ? '@group(1) @binding(1) var uDistanceCache: texture_2d<f32>;' : ''}
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
${
  mode === 'cached'
    ? `
  let bytes = vec4<u32>(round(textureLoad(uDistanceCache, vec2<i32>(uv * gfu.uInputPixel.xy), 0) * 255.0));
  let bits = bytes.x | (bytes.y << 8u) | (bytes.z << 16u) | (bytes.w << 24u);
  return DistanceResult(bitcast<f32>(bits));`
    : `
  var result = DistanceResult(maxRadius);
${WGSL_DISTANCE_SAMPLES.join('\n')}
  return result;
`
}
}
fn layerOver(below: vec4<f32>, color: vec3<f32>, alpha: f32) -> vec4<f32> {
  let remaining = 1.0 - alpha;
  return vec4<f32>(color * alpha + below.rgb * remaining, alpha + below.a * remaining);
}

@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let ribbonWidth = outlineUniforms.uGeometry.x; let rimWidth = outlineUniforms.uGeometry.y; let glowWidth = outlineUniforms.uGeometry.z; let glowStrength = outlineUniforms.uGeometry.w;
  let highlightStrength = outlineUniforms.uDetail.x; let hotspotScale = max(8.0, outlineUniforms.uDetail.y); let hotspotDensity = clamp(outlineUniforms.uDetail.z, 0.0, 1.0); let edgeWobble = max(0.0, outlineUniforms.uDetail.w);
  let speed = outlineUniforms.uMotion.x; let edgeSoftness = max(0.75, outlineUniforms.uMotion.y);
  let innerEdgeWidth = max(0.0, outlineUniforms.uMotion.z); let pulseRate = max(0.0, outlineUniforms.uMotion.w);
  let source = textureSample(uTexture, uSampler, uv);
  // Matches sourceMask's opaque plateau below, where exterior is exactly zero.
  if (source.a >= 0.78) { return vec4<f32>(0.0); }
  let patternPixel = uv * gfu.uInputPixel.xy; let time = outlineUniforms.uTime * speed;
  let contourVariation = clamp(outlineUniforms.uOrganic.x / 10.0, 0.0, 1.0);
  let variationNoise = outlineFbm(patternPixel * 0.012 + vec2<f32>(time * 0.11, -time * 0.07));
  let widthScale = mix(1.0 - contourVariation * 0.45, 1.0 + contourVariation * 0.55, variationNoise);
  let maxRadius = (ribbonWidth + rimWidth + glowWidth) * (1.0 + contourVariation * 0.55) + edgeWobble * 1.5 + 3.0;
  let field = outlineDistance(uv, maxRadius); let sourceMask = smoothstep(0.02, 0.78, source.a); let exterior = 1.0 - sourceMask;
${
  mode === 'distance'
    ? `
  let bits = bitcast<u32>(field.distance);
  let bytes = vec4<u32>(bits, bits >> 8u, bits >> 16u, bits >> 24u) & vec4<u32>(255u);
  return vec4<f32>(bytes) / 255.0;
`
    : `
  let wobbleScale = max(18.0, hotspotScale * 1.2); let wobbleNoise = outlineFbm(patternPixel / wobbleScale + vec2<f32>(time * 0.52, -time * 0.37)); let lickNoise = outlineFbm(patternPixel / max(12.0, wobbleScale * 0.42) + vec2<f32>(-time * 1.18, time * 0.74)); let flameLick = outlineSmooth((lickNoise - 0.56) / 0.34); let wobble = ((wobbleNoise - 0.5) * 1.6 + (flameLick - 0.35) * 0.55) * edgeWobble; let distanceToEdge = max(0.0, field.distance - wobble);
  let ribbon = ribbonWidth * widthScale; let rim = rimWidth * widthScale; let glow = glowWidth * widthScale;
  let coreFlat = ribbon * 0.6; let coreAlpha = (1.0 - smoothstep(coreFlat, ribbon + edgeSoftness, distanceToEdge)) * exterior;
  let rimAlpha = pow(1.0 - clamp(distanceToEdge / (ribbon + rim + edgeSoftness * 1.2), 0.0, 1.0), 1.6) * exterior * 0.9;
  let tailStart = (ribbon + rim) * 0.35; let tailReach = max(ribbon + rim + glow, tailStart + 0.001);
  let tailT = clamp((distanceToEdge - tailStart) / (tailReach - tailStart), 0.0, 1.0); let tailAlpha = pow(1.0 - tailT, 2.4) * exterior;
  var innerEdgeAlpha = 0.0;
  if (innerEdgeWidth > 0.0) {
    innerEdgeAlpha = (1.0 - smoothstep(0.0, innerEdgeWidth, distanceToEdge)) * exterior;
  }
  // Match the geometric dead-zone shortcut in the WebGL shader.
  let maxReach = max(ribbon + edgeSoftness, max(ribbon + rim + edgeSoftness * 1.2, max(tailReach, innerEdgeWidth)));
  if (distanceToEdge >= maxReach) {
    return vec4<f32>(0.0);
  }
  let bloomNoise = outlineFbm(patternPixel * 0.018 + vec2<f32>(time * 0.34, -time * 0.23)); let energyVariation = clamp(edgeWobble / 3.5, 0.0, 1.0); let bloomPulse = mix(1.0 - energyVariation * 0.22, 1.0 + energyVariation * 0.32, bloomNoise); let haloAlpha = clamp(tailAlpha * glowStrength * 0.55 * bloomPulse, 0.0, 1.0);
  let laneInner = smoothstep(ribbon * 0.10, ribbon * 0.32, distanceToEdge); let laneOuter = 1.0 - smoothstep(ribbon * 0.62, ribbon * 0.84, distanceToEdge); let highlightLane = laneInner * laneOuter * coreAlpha;
  var hotspotMix = 0.0;
  if (highlightLane != 0.0 && highlightStrength != 0.0) {
    let hotspotNoise = outlineFbm(patternPixel / hotspotScale + vec2<f32>(-time * 1.10, time * 0.46)); let hotspotThreshold = mix(0.72, 0.54, hotspotDensity); let hotspotMask = smoothstep(hotspotThreshold, hotspotThreshold + 0.13, hotspotNoise); let filament = 0.14 + hotspotMask * 0.86; hotspotMix = clamp(highlightLane * filament * highlightStrength * mix(0.80, 1.15, flameLick), 0.0, 1.0);
  }
  var result = vec4<f32>(0.0); result = layerOver(result, outlineUniforms.uGlowColor.rgb, haloAlpha); result = layerOver(result, outlineUniforms.uRimColor.rgb, rimAlpha); result = layerOver(result, outlineUniforms.uBaseColor.rgb, coreAlpha); result = layerOver(result, outlineUniforms.uHotColor.rgb, innerEdgeAlpha); result = vec4<f32>(mix(result.rgb, outlineUniforms.uHotColor.rgb * result.a, hotspotMix), result.a);
  var breathe = 1.0;
  if (pulseRate != 0.0) {
    breathe = 1.0 - 0.12 * (0.5 - 0.5 * sin(outlineUniforms.uTime * pulseRate * 3.1415927));
  }
  return result * breathe;
`
}
}
`
}

export function createAnimatedOutlineGlProgram(
  mode: OutlineShaderMode = 'live'
): GlProgram {
  const version = mode === 'live' ? '' : '#version 300 es\n'
  return GlProgram.from({
    vertex: version + VERTEX_GLSL,
    fragment: version + fragmentGlsl(mode),
    name: `animated-outline-${mode}`
  })
}

export function createAnimatedOutlineGpuProgram(
  mode: OutlineShaderMode = 'live'
): GpuProgram {
  const source = sourceWgsl(mode)
  return GpuProgram.from({
    vertex: { source, entryPoint: 'mainVertex' },
    fragment: { source, entryPoint: 'mainFragment' }
  })
}
