import { GlProgram, GpuProgram, UniformGroup } from 'pixi.js'
import { auraWgsl } from './aura-shader-wgsl'

// Ported from ShaderTest/src/shaders/metaballAuraV5.js.
// Only field coordinates, exterior masking and endpoint guards are adapted.
const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vFieldUv;

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
    vFieldUv = aPosition;
}
`
const fragment = `
in vec2 vTextureCoord;
in vec2 vFieldUv;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uDistanceField;
uniform vec4 uMapX;
uniform vec4 uMapY;
uniform vec4 uProjection0;
uniform vec4 uProjection1;
uniform vec4 uProjection2;
uniform float uReady;
uniform float uAlpha;

uniform vec2 uCardSize;
uniform vec2 uFieldSize;
uniform float uPadding;
uniform float uDistanceLimit;
uniform float uTime;
uniform float uSpeed;
uniform float uWobble;
uniform float uBaseWidth;
uniform float uBaseEdgeSoftness;
uniform float uBaseOpacity;
uniform float uGlowWidth;
uniform float uGlowSoftness;
uniform float uGlowIntensity;
uniform float uHotCount;
uniform float uBlobLength;
uniform float uBlobThickness;
uniform float uBlobOffset;
uniform float uHotTravel;
uniform float uHotLife;
uniform float uHotIntensity;
uniform float uHotThreshold;
uniform float uCoreBrightness;
uniform float uCoreThreshold;
uniform float uHotBulge;
uniform float uHaloLength;
uniform vec3 uBlobCoreColor;
uniform float uTaperAmount;
uniform float uTaperStart;
uniform float uBottomFade;
uniform float uBottomFadeStart;
uniform float uSmoothOutline;
uniform float uCoreWidth;
uniform float uCoreIntensity;
uniform float uAdditive;
uniform float uShimmer;
uniform vec3 uCoreColor;
uniform vec3 uBaseColor;
uniform vec3 uGlowColor;
uniform vec3 uHotColor;

const float TAU = 6.2831853;

float wrapAngle(float angle)
{
    return angle - TAU * floor(angle / TAU + 0.5);
}

float hash1(float n)
{
    return fract(sin(n) * 43758.5453);
}

// Position along the card edge in pixels. The point is projected onto the
// card rectangle and measured clockwise from the top-left corner, so blob
// sizes stay the same on every side. Returns (position, perimeter length).
vec2 perimeterPosition(vec2 cardUv)
{
    vec2 halfSize = uCardSize * 0.5;
    vec2 n = (cardUv - 0.5) * 2.0;
    vec2 q = n / max(max(abs(n.x), abs(n.y)), 1e-4);
    float perimeter = 4.0 * (halfSize.x + halfSize.y);
    float s;
    if (abs(n.y) >= abs(n.x)) {
        s = n.y < 0.0
            ? (q.x + 1.0) * halfSize.x
            : 2.0 * halfSize.x + 2.0 * halfSize.y + (1.0 - q.x) * halfSize.x;
    } else {
        s = n.x > 0.0
            ? 2.0 * halfSize.x + (q.y + 1.0) * halfSize.y
            : 4.0 * halfSize.x + 2.0 * halfSize.y + (1.0 - q.y) * halfSize.y;
    }
    return vec2(s, perimeter);
}

// Hot spots are soft oval blobs sitting in the neon band. Each has a position
// along the edge that slowly travels, an along-edge length, and an optional
// fade cycle. Gaussian fields add up, so neighbouring blobs melt together.
// Each blob also has a wider pale halo. The swell field ignores the distance
// from the card so the whole glow bulges outward beside a blob.
// Returns (core field, halo field, swell field).
vec3 hotBlobs(vec2 cardUv, float edgeDistance)
{
    vec2 edge = perimeterPosition(cardUv);
    float perimeter = edge.y;
    float phase = uTime * uSpeed * 2.0;
    float count = max(uHotCount, 1.0);
    float across = (edgeDistance - uBlobOffset) / max(uBlobThickness, 0.5);
    float acrossTerm = across * across;
    float haloAcross = across / 1.4;
    float haloAcrossTerm = haloAcross * haloAcross;
    float haloScale = max(uHaloLength, 1.0);
    float field = 0.0;
    float halo = 0.0;
    float swell = 0.0;

    for (int i = 0; i < 16; i++) {
        float fi = float(i);
        float active = step(fi + 0.5, uHotCount);
        float r1 = hash1(fi * 12.9898 + 1.3);
        float r2 = hash1(fi * 78.233 + 4.1);
        float r3 = hash1(fi * 39.425 + 7.7);
        float direction = mod(fi, 2.0) < 0.5 ? 1.0 : -1.0;
        float travel = direction * (0.35 + 0.65 * r2) * 0.04 * uHotTravel;
        float centre = ((fi + r1 * 0.7) / count + phase * travel) * perimeter;
        float along = uBlobLength * (0.6 + 0.8 * r3);
        float cycle = 0.5 + 0.5 * sin(phase * (0.2 + 0.3 * r3) + r1 * TAU);
        float life = mix(1.0, smoothstep(0.1, 0.9, cycle), uHotLife);
        float delta = mod(edge.x - centre + perimeter * 0.5, perimeter) - perimeter * 0.5;
        float alongT = delta / along;
        float haloT = alongT / haloScale;
        float strength = active * life * (0.7 + 0.3 * r2);
        field += strength * exp(-(alongT * alongT + acrossTerm));
        halo += strength * exp(-(haloT * haloT + haloAcrossTerm));
        swell += strength * exp(-alongT * alongT);
    }

    return vec3(field, halo, swell);
}

float edgeWobble(vec2 point)
{
    float phase = uTime * uSpeed;
    float broad = sin(point.y * 9.0 + point.x * 3.0 - phase * 1.4);
    float detail = sin(point.x * 12.0 - point.y * 6.0 + phase * 2.1);
    return uWobble * (broad * 0.65 + detail * 0.35);
}

float hash(vec2 p)
{
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float valueNoise(vec2 p)
{
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// Soft brightness blotches that travel around the card in both directions.
// Sampling on a circle keeps the pattern seamless all the way around.
float perimeterShimmer(vec2 point)
{
    float angle = atan(point.y, point.x);
    float phase = uTime * uSpeed;
    vec2 forward = vec2(cos(angle + phase * 0.35), sin(angle + phase * 0.35)) * 2.6;
    vec2 backward = vec2(cos(angle - phase * 0.22), sin(angle - phase * 0.22)) * 4.1;
    return valueNoise(forward + 7.3) * 0.6 + valueNoise(backward + 19.1) * 0.4;
}

void main(void)
{
    // The full padded sprite is 0..1 in the filter quad's local coordinates.
    if (uReady < 0.5) { finalColor = vec4(0.0); return; }
    vec3 local = vec3(dot(uMapX.xyz, vec3(vTextureCoord, 1.0)), dot(uMapY.xyz, vec3(vTextureCoord, 1.0)), 1.0);
    vec3 projected = vec3(dot(uProjection0.xyz, local), dot(uProjection1.xyz, local), dot(uProjection2.xyz, local));
    if (abs(projected.z) < 0.000001) { finalColor = vec4(0.0); return; }
    vec2 cardUv = projected.xy / projected.z;
    vec2 fieldUv = (cardUv * uCardSize + vec2(uPadding)) / uFieldSize;
    // The filter input is premultiplied. Recover the encoded distance at its
    // transparent edge so interpolation cannot turn the padding into a glow line.
    vec4 fieldSample = texture(uDistanceField, fieldUv);
    // Red holds the exact alpha distance, green the smoothed (closed) outline.
    float encodedChannel = mix(fieldSample.r, fieldSample.g, uSmoothOutline);
    float encodedDistance = fieldSample.a > 0.001
        ? min(encodedChannel / fieldSample.a, 1.0)
        : 1.0;
    float distance = max(encodedDistance * uDistanceLimit - 0.7, 0.0);

    // Taper: from Taper start down to the card bottom the whole glow (body,
    // core, tail and hot line) narrows. Dividing the distance keeps every
    // layer's proportions; below the card the narrowest width holds.
    float taperT = smoothstep(uTaperStart, max(1.0, uTaperStart + 0.00001), cardUv.y);
    float widthScale = max(mix(1.0, 1.0 - uTaperAmount, taperT), 0.05);
    // Bottom fade: the glow dies out behind the gems and under the card.
    float bottomFade = 1.0 - uBottomFade * smoothstep(uBottomFadeStart, max(1.0, uBottomFadeStart + 0.00001), cardUv.y);

    vec2 point = (cardUv - 0.5) * 2.0;
    point.x *= uCardSize.x / uCardSize.y;
    // Shimmer gently varies both the reach and the brightness of the glow.
    float shimmer = perimeterShimmer(point);
    float shimmerSigned = (shimmer - 0.5) * 2.0 * uShimmer;
    float movedDistance = distance / widthScale - edgeWobble(point) - shimmerSigned * 10.0;
    // Blobs ride on the moving band, then swell the glow around themselves.
    vec3 blobFields = hotBlobs(cardUv, max(movedDistance, 0.0));
    float blobField = blobFields.x;
    float haloField = blobFields.y;
    float warpedDistance = movedDistance - min(blobFields.z, 1.5) * uHotBulge;
    float outsideDistance = max(warpedDistance, 0.0);

    // Neon body: opaque up to its width, then a short feather.
    float baseFeather = min(uBaseEdgeSoftness, uBaseWidth * 0.5);
    float baseStart = uBaseWidth - baseFeather;
    float baseAlpha = uBaseOpacity
        * (1.0 - smoothstep(baseStart, uBaseWidth, outsideDistance));

    // Tail: a squared falloff from the card edge to the outer reach.
    float glowOuter = max(uGlowWidth, uBaseWidth + 1.0);
    float tailT = 1.0 - smoothstep(0.0, glowOuter, outsideDistance);
    float glowShape = mix(tailT * tailT, tailT, uGlowSoftness);
    float glowAlpha = clamp(glowShape * uGlowIntensity * (1.0 + min(blobField, 1.0) * 0.25 + shimmerSigned * 0.3), 0.0, 1.0);

    // Blob colour ramp: green -> pale lime -> near-white core.
    float hot = uHotIntensity * smoothstep(0.0, uHotThreshold, haloField);
    float blobCore = uCoreBrightness * smoothstep(uCoreThreshold * 0.6, uCoreThreshold * 1.3, blobField);

    // Pale core line right against the card, brightening with the shimmer.
    float core = exp(-outsideDistance / max(uCoreWidth, 0.5))
        * uCoreIntensity * (1.0 + shimmerSigned * 0.6);

    vec3 baseColor = mix(uBaseColor, uCoreColor, clamp(core, 0.0, 1.0));
    baseColor = mix(mix(baseColor, uHotColor, hot), uBlobCoreColor, blobCore);
    vec3 glowColor = mix(mix(uGlowColor, uHotColor, hot), uBlobCoreColor, blobCore);
    vec3 premultiplied = baseColor * baseAlpha + glowColor * glowAlpha * (1.0 - baseAlpha);
    // Keep the reserved outer pixels clear even if the filter input is sampled
    // across its transparent border.
    vec2 edgePixels = min(fieldUv, vec2(1.0) - fieldUv) * uFieldSize;
    float edgeMask = smoothstep(3.0, 5.0, min(edgePixels.x, edgePixels.y));

    // Pixi expects premultiplied output. The body blends normally so it stays
    // saturated on bright boards; lowering the tail's alpha while keeping its
    // colour turns that share of the tail into added light.
    float outAlpha = baseAlpha + glowAlpha * (1.0 - baseAlpha) * (1.0 - uAdditive);
    finalColor = vec4(premultiplied, outAlpha) * edgeMask * bottomFade * (1.0 - smoothstep(0.02, 0.78, fieldSample.b)) * uAlpha;
}
`
export function createAuraGlProgram(): GlProgram {
  return GlProgram.from({
    vertex,
    fragment,
    name: 'aura-shader',
    preferredFragmentPrecision: 'highp'
  })
}
export function createAuraGpuProgram(): GpuProgram {
  return GpuProgram.from({
    vertex: { source: auraWgsl, entryPoint: 'mainVertex' },
    fragment: { source: auraWgsl, entryPoint: 'mainFragment' }
  })
}

export function createAuraUniforms() {
  return new UniformGroup({
    uMapX: { value: new Float32Array(4), type: 'vec4<f32>' },
    uMapY: { value: new Float32Array(4), type: 'vec4<f32>' },
    uProjection0: { value: new Float32Array(4), type: 'vec4<f32>' },
    uProjection1: { value: new Float32Array(4), type: 'vec4<f32>' },
    uProjection2: { value: new Float32Array(4), type: 'vec4<f32>' },
    uReady: { value: 0, type: 'f32' },
    uAlpha: { value: 0, type: 'f32' },
    uCardSize: { value: new Float32Array(2), type: 'vec2<f32>' },
    uFieldSize: { value: new Float32Array(2), type: 'vec2<f32>' },
    uPadding: { value: 0, type: 'f32' },
    uDistanceLimit: { value: 0, type: 'f32' },
    uTime: { value: 0, type: 'f32' },
    uSpeed: { value: 0, type: 'f32' },
    uWobble: { value: 0, type: 'f32' },
    uBaseWidth: { value: 0, type: 'f32' },
    uBaseEdgeSoftness: { value: 0, type: 'f32' },
    uBaseOpacity: { value: 0, type: 'f32' },
    uGlowWidth: { value: 0, type: 'f32' },
    uGlowSoftness: { value: 0, type: 'f32' },
    uGlowIntensity: { value: 0, type: 'f32' },
    uHotCount: { value: 0, type: 'f32' },
    uBlobLength: { value: 0, type: 'f32' },
    uBlobThickness: { value: 0, type: 'f32' },
    uBlobOffset: { value: 0, type: 'f32' },
    uHotTravel: { value: 0, type: 'f32' },
    uHotLife: { value: 0, type: 'f32' },
    uHotIntensity: { value: 0, type: 'f32' },
    uHotThreshold: { value: 0, type: 'f32' },
    uCoreBrightness: { value: 0, type: 'f32' },
    uCoreThreshold: { value: 0, type: 'f32' },
    uHotBulge: { value: 0, type: 'f32' },
    uHaloLength: { value: 0, type: 'f32' },
    uBlobCoreColor: { value: new Float32Array(3), type: 'vec3<f32>' },
    uTaperAmount: { value: 0, type: 'f32' },
    uTaperStart: { value: 0, type: 'f32' },
    uBottomFade: { value: 0, type: 'f32' },
    uBottomFadeStart: { value: 0, type: 'f32' },
    uSmoothOutline: { value: 0, type: 'f32' },
    uCoreWidth: { value: 0, type: 'f32' },
    uCoreIntensity: { value: 0, type: 'f32' },
    uAdditive: { value: 0, type: 'f32' },
    uShimmer: { value: 0, type: 'f32' },
    uCoreColor: { value: new Float32Array(3), type: 'vec3<f32>' },
    uBaseColor: { value: new Float32Array(3), type: 'vec3<f32>' },
    uGlowColor: { value: new Float32Array(3), type: 'vec3<f32>' },
    uHotColor: { value: new Float32Array(3), type: 'vec3<f32>' }
  })
}
