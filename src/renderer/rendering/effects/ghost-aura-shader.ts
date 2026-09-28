// Ghost Mist v1, ported from ShaderTest (2026-09-27).
export const ghostMistVertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main() {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    gl_Position = vec4(position, 0.0, 1.0);
    vTextureCoord = aPosition * uOutputFrame.zw * uInputSize.zw;
}`

export const ghostMistFragment = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uNoise;
uniform sampler2D uDissolve;
uniform sampler2D uHalo;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec4 uOutputFrame;
uniform vec2 uWind;
uniform vec2 uFlow;
uniform float uTime;
uniform float uExpansion;
uniform float uIntensity;
uniform float uTextureScale;
uniform float uProgress;
uniform vec3 uPrimary;
uniform vec3 uSecondary;

float noiseAt(vec2 p) {
    // Mirrored texture coordinates avoid a hard wrap seam in the supplied noise.
    vec2 uv = 1.0 - abs(mod(p, 2.0) - 1.0);
    return texture(uNoise, uv).r;
}
vec4 over(vec4 back, vec3 color, float alpha) {
    alpha = clamp(alpha, 0.0, 1.0);
    return vec4(color * alpha + back.rgb * (1.0 - alpha), alpha + back.a * (1.0 - alpha));
}
void main() {
    if (uProgress >= 1.0) { finalColor = vec4(0.0); return; }
    vec2 p = vTextureCoord * uInputSize.xy;
    vec4 source = texture(uTexture, vTextureCoord);
    float progress = uProgress;
    float remaining = 1.0 - smoothstep(0.45, 1.0, progress);
    // Whiten first and keep surviving fragments white until they dissolve.
    // A fading color overlay exposed the original artwork again mid-transition.
    float whiten = smoothstep(0.0, 0.10, progress);
    // Independent low-frequency cloud texture: broad, soft dissolving patches.
    vec2 dissolveUv = 1.0 - abs(mod(p * 0.008 + vec2(0.23, 0.41), 2.0) - 1.0);
    float breakup = texture(uDissolve, dissolveUv).r;
    float erase = smoothstep(0.18, 0.62, progress);
    float intact = 1.0 - smoothstep(breakup - 0.10, breakup + 0.10, erase * 1.2);
    if (progress <= 0.18) intact = 1.0;

    vec2 advected = p - uFlow;
    float broad = noiseAt(advected * 0.012 / uTextureScale);
    float detail = noiseAt((advected * 0.037 + vec2(uTime * 0.018, -uTime * 0.024)) / uTextureScale);
    float fogNoise = broad * 0.65 + detail * 0.35;
    vec2 trail = uWind * uExpansion * (0.3 + progress * 0.5);
    vec2 warp = vec2(broad - 0.5, detail - 0.5) * uExpansion * 0.22;
    vec2 haloUv = (p - trail + warp) * uInputSize.zw;
    float halo = texture(uHalo, clamp(haloUv, uInputClamp.xy, uInputClamp.zw)).a;
    // A real Gaussian-blurred silhouette gives a continuous falloff, not
    // discrete shifted copies of the alpha edge. Noise modulates its density.
    float fog = halo * (0.65 + fogNoise * 0.7) * remaining;
    // Fade the whole cloud uniformly. Using source alpha here carved the
    // vanished button's hard silhouette into the remaining fog.
    fog *= 1.0 - erase * 0.8;
    vec4 art = source * intact;
    art.rgb = mix(art.rgb, vec3(art.a), whiten);
    float exterior = 1.0 - art.a;
    float glowAlpha = (1.0 - exp(-fog * uIntensity * 0.32)) * exterior;
    vec4 result = over(vec4(0.0), uPrimary, glowAlpha);
    result = art + result * (1.0 - art.a);
    // Emission increases RGB independently of coverage: intensity now adds
    // light on bright boards instead of merely becoming an opaque blue mask.
    vec3 light = mix(uPrimary, uSecondary, clamp(halo * 1.7, 0.0, 0.7));
    result.rgb += light * fog * uIntensity * (exterior * 1.3 + art.a * 0.025);
    finalColor = result;
}`
