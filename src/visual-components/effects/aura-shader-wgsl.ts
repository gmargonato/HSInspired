/** WebGPU equivalent of the Metaball V5 Aura Shader. */
export const auraWgsl = `
struct GlobalFilterUniforms {
 uInputSize: vec4<f32>, uInputPixel: vec4<f32>, uInputClamp: vec4<f32>, uOutputFrame: vec4<f32>, uGlobalFrame: vec4<f32>, uOutputTexture: vec4<f32>,
}
struct AuraUniforms {
  uMapX: vec4<f32>,
  uMapY: vec4<f32>,
  uProjection0: vec4<f32>,
  uProjection1: vec4<f32>,
  uProjection2: vec4<f32>,
  uReady: f32,
  uAlpha: f32,
  uCardSize: vec2<f32>,
  uFieldSize: vec2<f32>,
  uPadding: f32,
  uDistanceLimit: f32,
  uTime: f32,
  uSpeed: f32,
  uWobble: f32,
  uBaseWidth: f32,
  uBaseEdgeSoftness: f32,
  uBaseOpacity: f32,
  uGlowWidth: f32,
  uGlowSoftness: f32,
  uGlowIntensity: f32,
  uHotCount: f32,
  uBlobLength: f32,
  uBlobThickness: f32,
  uBlobOffset: f32,
  uHotTravel: f32,
  uHotLife: f32,
  uHotIntensity: f32,
  uHotThreshold: f32,
  uCoreBrightness: f32,
  uCoreThreshold: f32,
  uHotBulge: f32,
  uHaloLength: f32,
  uBlobCoreColor: vec3<f32>,
  uTaperAmount: f32,
  uTaperStart: f32,
  uBottomFade: f32,
  uBottomFadeStart: f32,
  uSmoothOutline: f32,
  uCoreWidth: f32,
  uCoreIntensity: f32,
  uAdditive: f32,
  uShimmer: f32,
  uCoreColor: vec3<f32>,
  uBaseColor: vec3<f32>,
  uGlowColor: vec3<f32>,
  uHotColor: vec3<f32>,
}
@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> auraUniforms: AuraUniforms;
@group(1) @binding(1) var uDistanceField: texture_2d<f32>;
@group(1) @binding(2) var uDistanceSampler: sampler;
struct VSOutput { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
 var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
 position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
 position.y = position.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;
 return VSOutput(vec4<f32>(position, 0.0, 1.0), aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw));
}
fn modulo(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }
const TAU: f32 = 6.2831853;



fn hash1(n: f32) -> f32
{
    return fract(sin(n) * 43758.5453);
}

// Position along the card edge in pixels. The point is projected onto the
// card rectangle and measured clockwise from the top-left corner, so blob
// sizes stay the same on every side. Returns (position, perimeter length).
fn perimeterPosition(cardUv: vec2<f32>) -> vec2<f32>
{
    var halfSize: vec2<f32> = auraUniforms.uCardSize * 0.5;
    var n: vec2<f32> = (cardUv - vec2<f32>(0.5)) * 2.0;
    var q: vec2<f32> = n / max(max(abs(n.x), abs(n.y)), 1e-4);
    var perimeter: f32 = 4.0 * (halfSize.x + halfSize.y);
    var s: f32;
    if (abs(n.y) >= abs(n.x)) {
        s = select(2.0 * halfSize.x + 2.0 * halfSize.y + (1.0 - q.x) * halfSize.x, (q.x + 1.0) * halfSize.x, n.y < 0.0);
    } else {
        s = select(4.0 * halfSize.x + 2.0 * halfSize.y + (1.0 - q.y) * halfSize.y, 2.0 * halfSize.x + (q.y + 1.0) * halfSize.y, n.x > 0.0);
    }
    return vec2<f32>(s, perimeter);
}

// Hot spots are soft oval blobs sitting in the neon band. Each has a position
// along the edge that slowly travels, an along-edge length, and an optional
// fade cycle. Gaussian fields add up, so neighbouring blobs melt together.
// Each blob also has a wider pale halo. The swell field ignores the distance
// from the card so the whole glow bulges outward beside a blob.
// Returns (core field, halo field, swell field).
fn hotBlobs(cardUv: vec2<f32>, edgeDistance: f32) -> vec3<f32>
{
    var edge: vec2<f32> = perimeterPosition(cardUv);
    var perimeter: f32 = edge.y;
    var phase: f32 = auraUniforms.uTime * auraUniforms.uSpeed * 2.0;
    var count: f32 = max(auraUniforms.uHotCount, 1.0);
    var across: f32 = (edgeDistance - auraUniforms.uBlobOffset) / max(auraUniforms.uBlobThickness, 0.5);
    var acrossTerm: f32 = across * across;
    var haloAcross: f32 = across / 1.4;
    var haloAcrossTerm: f32 = haloAcross * haloAcross;
    var haloScale: f32 = max(auraUniforms.uHaloLength, 1.0);
    var field: f32 = 0.0;
    var halo: f32 = 0.0;
    var swell: f32 = 0.0;

    for (var i: i32 = 0; i < 16; i++) {
        var fi: f32 = f32(i);
        var activeBlob: f32 = step(fi + 0.5, auraUniforms.uHotCount);
        var r1: f32 = hash1(fi * 12.9898 + 1.3);
        var r2: f32 = hash1(fi * 78.233 + 4.1);
        var r3: f32 = hash1(fi * 39.425 + 7.7);
        var direction: f32 = select(-1.0, 1.0, modulo(fi, 2.0) < 0.5);
        var travel: f32 = direction * (0.35 + 0.65 * r2) * 0.04 * auraUniforms.uHotTravel;
        var centre: f32 = ((fi + r1 * 0.7) / count + phase * travel) * perimeter;
        var along: f32 = auraUniforms.uBlobLength * (0.6 + 0.8 * r3);
        var cycle: f32 = 0.5 + 0.5 * sin(phase * (0.2 + 0.3 * r3) + r1 * TAU);
        var life: f32 = mix(1.0, smoothstep(0.1, 0.9, cycle), auraUniforms.uHotLife);
        var delta: f32 = modulo(edge.x - centre + perimeter * 0.5, perimeter) - perimeter * 0.5;
        var alongT: f32 = delta / along;
        var haloT: f32 = alongT / haloScale;
        var strength: f32 = activeBlob * life * (0.7 + 0.3 * r2);
        field += strength * exp(-(alongT * alongT + acrossTerm));
        halo += strength * exp(-(haloT * haloT + haloAcrossTerm));
        swell += strength * exp(-alongT * alongT);
    }

    return vec3<f32>(field, halo, swell);
}

fn edgeWobble(point: vec2<f32>) -> f32
{
    var phase: f32 = auraUniforms.uTime * auraUniforms.uSpeed;
    var broad: f32 = sin(point.y * 9.0 + point.x * 3.0 - phase * 1.4);
    var detail: f32 = sin(point.x * 12.0 - point.y * 6.0 + phase * 2.1);
    return auraUniforms.uWobble * (broad * 0.65 + detail * 0.35);
}

fn hash(p: vec2<f32>) -> f32
{
    var q = fract(p * vec2<f32>(123.34, 456.21));
    q += vec2<f32>(dot(q, q + vec2<f32>(45.32)));
    return fract(q.x * q.y);
}

fn valueNoise(p: vec2<f32>) -> f32
{
    var i: vec2<f32> = floor(p);
    var f: vec2<f32> = fract(p);
    var u: vec2<f32> = f * f * (vec2<f32>(3.0) - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2<f32>(1.0, 0.0)), u.x),
               mix(hash(i + vec2<f32>(0.0, 1.0)), hash(i + vec2<f32>(1.0, 1.0)), u.x), u.y);
}

// Soft brightness blotches that travel around the card in both directions.
// Sampling on a circle keeps the pattern seamless all the way around.
fn perimeterShimmer(point: vec2<f32>) -> f32
{
    var angle: f32 = atan2(point.y, point.x);
    var phase: f32 = auraUniforms.uTime * auraUniforms.uSpeed;
    var forward: vec2<f32> = vec2<f32>(cos(angle + phase * 0.35), sin(angle + phase * 0.35)) * 2.6;
    var backward: vec2<f32> = vec2<f32>(cos(angle - phase * 0.22), sin(angle - phase * 0.22)) * 4.1;
    return valueNoise(forward + vec2<f32>(7.3)) * 0.6 + valueNoise(backward + vec2<f32>(19.1)) * 0.4;
}

@fragment fn mainFragment(@location(0) vTextureCoord: vec2<f32>) -> @location(0) vec4<f32>
{
    // The full padded sprite is 0..1 in the filter quad's local coordinates.
    if (auraUniforms.uReady < 0.5) { return vec4<f32>(0.0); }
    var local: vec3<f32> = vec3<f32>(dot(auraUniforms.uMapX.xyz, vec3<f32>(vTextureCoord, 1.0)), dot(auraUniforms.uMapY.xyz, vec3<f32>(vTextureCoord, 1.0)), 1.0);
    var projected: vec3<f32> = vec3<f32>(dot(auraUniforms.uProjection0.xyz, local), dot(auraUniforms.uProjection1.xyz, local), dot(auraUniforms.uProjection2.xyz, local));
    if (abs(projected.z) < 0.000001) { return vec4<f32>(0.0); }
    var cardUv: vec2<f32> = projected.xy / projected.z;
    var fieldUv: vec2<f32> = (cardUv * auraUniforms.uCardSize + vec2<f32>(auraUniforms.uPadding)) / auraUniforms.uFieldSize;
    // The filter input is premultiplied. Recover the encoded distance at its
    // transparent edge so interpolation cannot turn the padding into a glow line.
    var fieldSample: vec4<f32> = textureSampleLevel(uDistanceField, uDistanceSampler, fieldUv, 0.0);
    // Red holds the exact alpha distance, green the smoothed (closed) outline.
    var encodedChannel: f32 = mix(fieldSample.r, fieldSample.g, auraUniforms.uSmoothOutline);
    var encodedDistance: f32 = select(1.0, min(encodedChannel / max(fieldSample.a, 0.001), 1.0), fieldSample.a > 0.001);
    var distance: f32 = max(encodedDistance * auraUniforms.uDistanceLimit - 0.7, 0.0);

    // Taper: from Taper start down to the card bottom the whole glow (body,
    // core, tail and hot line) narrows. Dividing the distance keeps every
    // layer's proportions; below the card the narrowest width holds.
    var taperT: f32 = smoothstep(auraUniforms.uTaperStart, max(1.0, auraUniforms.uTaperStart + 0.00001), cardUv.y);
    var widthScale: f32 = max(mix(1.0, 1.0 - auraUniforms.uTaperAmount, taperT), 0.05);
    // Bottom fade: the glow dies out behind the gems and under the card.
    var bottomFade: f32 = 1.0 - auraUniforms.uBottomFade * smoothstep(auraUniforms.uBottomFadeStart, max(1.0, auraUniforms.uBottomFadeStart + 0.00001), cardUv.y);

    var point: vec2<f32> = (cardUv - vec2<f32>(0.5)) * 2.0;
    point.x *= auraUniforms.uCardSize.x / auraUniforms.uCardSize.y;
    // Shimmer gently varies both the reach and the brightness of the glow.
    var shimmer: f32 = perimeterShimmer(point);
    var shimmerSigned: f32 = (shimmer - 0.5) * 2.0 * auraUniforms.uShimmer;
    var movedDistance: f32 = distance / widthScale - edgeWobble(point) - shimmerSigned * 10.0;
    // Blobs ride on the moving band, then swell the glow around themselves.
    var blobFields: vec3<f32> = hotBlobs(cardUv, max(movedDistance, 0.0));
    var blobField: f32 = blobFields.x;
    var haloField: f32 = blobFields.y;
    var warpedDistance: f32 = movedDistance - min(blobFields.z, 1.5) * auraUniforms.uHotBulge;
    var outsideDistance: f32 = max(warpedDistance, 0.0);

    // Neon body: opaque up to its width, then a short feather.
    var baseFeather: f32 = min(auraUniforms.uBaseEdgeSoftness, auraUniforms.uBaseWidth * 0.5);
    var baseStart: f32 = auraUniforms.uBaseWidth - baseFeather;
    var baseAlpha: f32 = auraUniforms.uBaseOpacity
        * (1.0 - smoothstep(baseStart, auraUniforms.uBaseWidth, outsideDistance));

    // Tail: a squared falloff from the card edge to the outer reach.
    var glowOuter: f32 = max(auraUniforms.uGlowWidth, auraUniforms.uBaseWidth + 1.0);
    var tailT: f32 = 1.0 - smoothstep(0.0, glowOuter, outsideDistance);
    var glowShape: f32 = mix(tailT * tailT, tailT, auraUniforms.uGlowSoftness);
    var glowAlpha: f32 = clamp(glowShape * auraUniforms.uGlowIntensity * (1.0 + min(blobField, 1.0) * 0.25 + shimmerSigned * 0.3), 0.0, 1.0);

    // Blob colour ramp: green -> pale lime -> near-white core.
    var hot: f32 = auraUniforms.uHotIntensity * smoothstep(0.0, auraUniforms.uHotThreshold, haloField);
    var blobCore: f32 = auraUniforms.uCoreBrightness * smoothstep(auraUniforms.uCoreThreshold * 0.6, auraUniforms.uCoreThreshold * 1.3, blobField);

    // Pale core line right against the card, brightening with the shimmer.
    var core: f32 = exp(-outsideDistance / max(auraUniforms.uCoreWidth, 0.5))
        * auraUniforms.uCoreIntensity * (1.0 + shimmerSigned * 0.6);

    var baseColor: vec3<f32> = mix(auraUniforms.uBaseColor, auraUniforms.uCoreColor, clamp(core, 0.0, 1.0));
    baseColor = mix(mix(baseColor, auraUniforms.uHotColor, hot), auraUniforms.uBlobCoreColor, blobCore);
    var glowColor: vec3<f32> = mix(mix(auraUniforms.uGlowColor, auraUniforms.uHotColor, hot), auraUniforms.uBlobCoreColor, blobCore);
    var premultiplied: vec3<f32> = baseColor * baseAlpha + glowColor * glowAlpha * (1.0 - baseAlpha);
    // Keep the reserved outer pixels clear even if the filter input is sampled
    // across its transparent border.
    var edgePixels: vec2<f32> = min(fieldUv, vec2<f32>(1.0) - fieldUv) * auraUniforms.uFieldSize;
    var edgeMask: f32 = smoothstep(3.0, 5.0, min(edgePixels.x, edgePixels.y));

    // Pixi expects premultiplied output. The body blends normally so it stays
    // saturated on bright boards; lowering the tail's alpha while keeping its
    // colour turns that share of the tail into added light.
    var outAlpha: f32 = baseAlpha + glowAlpha * (1.0 - baseAlpha) * (1.0 - auraUniforms.uAdditive);
    return vec4<f32>(premultiplied, outAlpha) * edgeMask * bottomFade * (1.0 - smoothstep(0.02, 0.78, fieldSample.b)) * auraUniforms.uAlpha;
}

`
