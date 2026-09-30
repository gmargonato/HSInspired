// Adapted from pend00's God rays shader (CC0):
// https://godotshaders.com/shader/god-rays/

export const godRaysVertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vRayUv;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main() {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    gl_Position = vec4(position, 0.0, 1.0);
    vTextureCoord = aPosition * uOutputFrame.zw * uInputSize.zw;
    // The effect spans the quad, independently of the pooled input texture size.
    vRayUv = aPosition;
}`

export const godRaysFunctions = `
uniform float uTime;
uniform float uAngle;
uniform float uPosition;
uniform float uSpread;
uniform float uCutoff;
uniform float uFalloff;
uniform float uEdgeFade;
uniform float uSpeed;
uniform float uRay1Density;
uniform float uRay2Density;
uniform float uRay2Intensity;
uniform vec4 uColor;
uniform float uHdr;
uniform float uSeed;

float random(vec2 uv) {
    return fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453123);
}

float noise(vec2 uv) {
    vec2 i = floor(uv);
    vec2 f = fract(uv);
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

mat2 rotate(float angle) {
    return mat2(vec2(cos(angle), -sin(angle)), vec2(sin(angle), cos(angle)));
}

float godRaysAt(vec2 uv) {
    float divisor = max((uv.y + uSpread) - (uv.y * uSpread), 0.00001);
    vec2 transformedUv = (rotate(uAngle) * (uv - uPosition)) / divisor;
    vec2 ray1 = vec2(transformedUv.x * uRay1Density
        + sin(uTime * 0.1 * uSpeed) * (uRay1Density * 0.2) + uSeed, 1.0);
    vec2 ray2 = vec2(transformedUv.x * uRay2Density
        + sin(uTime * 0.2 * uSpeed) * (uRay1Density * 0.2) + uSeed, 1.0);
    float cut = step(uCutoff, transformedUv.x) * step(uCutoff, 1.0 - transformedUv.x);
    ray1 *= cut;
    ray2 *= cut;
    float rays = noise(ray1) + noise(ray2) * uRay2Intensity;
    if (uHdr < 0.5) rays = clamp(rays, 0.0, 1.0);
    rays *= smoothstep(0.0, max(uFalloff, 0.00001), 1.0 - uv.y);
    rays *= smoothstep(uCutoff, uCutoff + max(uEdgeFade, 0.00001), transformedUv.x);
    rays *= smoothstep(uCutoff, uCutoff + max(uEdgeFade, 0.00001), 1.0 - transformedUv.x);

    return rays;
}`

export const godRaysFragment = `
in vec2 vTextureCoord;
in vec2 vRayUv;
out vec4 finalColor;
uniform sampler2D uTexture;
${godRaysFunctions}
void main() {
    float rays = godRaysAt(vRayUv);
    // Screen blending is handled by Pixi. Respect the carrier's scene opacity
    // and emit premultiplied color so screen(color, background) is weighted by rays.
    float alpha = rays * uColor.a * texture(uTexture, vTextureCoord).a;
    finalColor = vec4(uColor.rgb * alpha, alpha);
}`

export const godRaysDustFragment = `
in vec2 vTextureCoord;
in vec2 vRayUv;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uDustBrightness;
${godRaysFunctions}
void main() {
    // Spotlight RGB is already premultiplied by its texture and sprite opacity.
    // Convert brightness to coverage: black texture borders contribute no light.
    vec3 glow = texture(uTexture, vTextureCoord).rgb;
    float coverage = max(glow.r, max(glow.g, glow.b));
    float illumination = 0.2 + 0.8 * clamp(godRaysAt(vRayUv), 0.0, 1.0);
    float alpha = clamp(coverage * illumination * uColor.a * uDustBrightness, 0.0, 1.0);
    finalColor = vec4(uColor.rgb * alpha, alpha);
}`
