/** Pixi filter vertex stage with stable UVs for the effect's local quad. */
export const FIRE_VFX_VERTEX_SHADER = [
  '#version 300 es',
  'in vec2 aPosition;',
  'out vec2 vTextureCoord;',
  'out vec2 vVfxUv;',
  'uniform vec4 uInputSize;',
  'uniform vec4 uOutputFrame;',
  'uniform vec4 uOutputTexture;',
  'void main(void) {',
  '  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;',
  '  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;',
  '  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;',
  '  gl_Position = vec4(position, 0.0, 1.0);',
  '  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);',
  '  vVfxUv = aPosition;',
  '}'
].join('\n')

export function hexColorToRgb(color: string): Float32Array {
  const normalized = color.replace('#', '')
  const value = Number.parseInt(normalized, 16)
  return new Float32Array([
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255
  ])
}

/** Smooth, advected turbulence: large rolling shapes before fine flame detail. */
export const FIRE_VFX_NOISE_GLSL = `
float fireHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float fireNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fireHash(i), fireHash(i + vec2(1, 0)), f.x),
             mix(fireHash(i + vec2(0, 1)), fireHash(i + vec2(1, 1)), f.x), f.y);
}
float fireFbm(vec2 p) {
  float n = 0.0, weight = 0.57;
  mat2 turn = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    n += weight * fireNoise(p);
    p = turn * p * 2.03 + 7.1;
    weight *= 0.47;
  }
  return n;
}
vec3 fireColor(float heat, vec3 flame, vec3 core) {
  vec3 ember = flame * vec3(0.48, 0.19, 0.12);
  vec3 color = mix(ember, flame, smoothstep(0.0, 0.42, heat));
  return mix(color, core, smoothstep(0.40, 1.0, heat));
}
`
