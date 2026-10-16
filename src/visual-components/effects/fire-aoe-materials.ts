import {
  Container,
  Filter,
  Mesh,
  MeshGeometry,
  Rectangle,
  RenderTexture,
  Sprite,
  Shader,
  Texture,
  type Renderer
} from 'pixi.js'
import type { GameAssets } from '../assets'
import { FIRE_VFX_VERTEX_SHADER, hexColorToRgb } from './fire-vfx-shader-common'
import type {
  FireAoeAppearance,
  FireAoePalette
} from '../../desktop/contracts/ipc/vfx-templates'
import { FIRE_AOE_LAYOUT as L, type FireAoeCoverage } from './fire-aoe-layout'

export type FireAoeAssets = Pick<
  GameAssets,
  | 'fireAoeWispAtlas'
  | 'fireAoeDarkWisp'
  | 'fireAoeSmoke'
  | 'fireAoeColorRamp'
  | 'fireAoeEmbers'
  | 'fireAoeGlowMaskOpponent'
  | 'fireAoeGlowMaskFriendly'
  | 'fireAoeGlowMaskFull'
  | 'fireAoeImpactBurst'
  | 'fireAoeImpactSpark'
>

/** Derived GPU masks are owned here; registered source textures are never modified. */
export class FireAoeResources {
  readonly wisps: readonly Texture[]
  readonly smoke: Texture
  readonly smokeMask: Texture
  readonly burst: Texture
  readonly spark: Texture
  readonly masks: Readonly<Record<FireAoeCoverage, Texture>>
  private readonly owned: Texture[] = []

  constructor(
    readonly renderer: Renderer,
    readonly assets: FireAoeAssets
  ) {
    this.wisps = Array.from(
      { length: 4 },
      (_, row) =>
        new Texture({
          source: assets.fireAoeWispAtlas.source,
          frame: new Rectangle(0, row * 128, 128, 128)
        })
    )
    try {
      this.smoke = this.bake(assets.fireAoeSmoke, 'smoke')
      this.smokeMask = this.bake(assets.fireAoeSmoke, 'smokeMask')
      this.burst = assets.fireAoeImpactBurst
      this.spark = assets.fireAoeImpactSpark
      this.masks = {
        full: this.bake(assets.fireAoeGlowMaskFull, 'mask'),
        opponent: this.bake(assets.fireAoeGlowMaskOpponent, 'mask'),
        friendly: this.bake(assets.fireAoeGlowMaskFriendly, 'mask')
      }
      this.warm()
    } catch (error) {
      this.destroy()
      throw error
    }
  }

  /** Upload textures and compile both composite passes before a gameplay cast. */
  private warm(): void {
    const group = new Container()
    group.label = 'fire-aoe.warmup'
    const target = RenderTexture.create({ width: 32, height: 32, resolution: 1 })
    const main = new FireAoeComposite(Texture.WHITE, this.assets.fireAoeColorRamp)
    const halo = new FireAoeComposite(Texture.WHITE, this.assets.fireAoeColorRamp, true)
    const glow = createFireBoardGlow()
    main.update(1, 2, 1.1, 0.75)
    halo.update(1, 2, 1.1, 0.75)
    for (const [index, texture] of [
      ...this.wisps,
      this.assets.fireAoeDarkWisp,
      this.assets.fireAoeEmbers
    ].entries()) {
      const sprite = new Sprite(texture)
      sprite.label = `fire-aoe.warm-texture-${index}`
      sprite.width = sprite.height = 32
      group.addChild(sprite)
    }
    for (const [index, filter] of [main.filter, halo.filter, glow].entries()) {
      const sprite = new Sprite(Texture.WHITE)
      sprite.label = `fire-aoe.warm-pass-${index}`
      sprite.width = sprite.height = 32
      sprite.filters = [filter]
      group.addChild(sprite)
    }
    for (const burst of [true, false]) {
      const mesh = new FireImpactMesh(burst ? this.burst : this.spark, burst)
      mesh.label = 'fire-aoe.warm-impact'
      mesh.width = mesh.height = 32
      group.addChild(mesh)
    }
    try {
      this.renderer.render({ container: group, target, clear: true })
    } finally {
      for (const child of group.children) child.filters = null
      group.destroy({ children: true })
      main.destroy()
      halo.destroy()
      glow.destroy()
      target.destroy(true)
    }
  }

  /** Caller owns a generated ramp; the extracted alpha curve is copied unchanged. */
  createRamp(palette: FireAoePalette): RenderTexture {
    const source = this.assets.fireAoeColorRamp
    const filter = Filter.from({
      gl: {
        vertex: FIRE_VFX_VERTEX_SHADER,
        name: 'fire-aoe-palette',
        fragment: `#version 300 es
          in vec2 vTextureCoord; in vec2 vVfxUv; out vec4 finalColor;
          uniform sampler2D uTexture;
          uniform vec3 uEdge, uFlame, uCore;
          void main() {
            float alpha = texture(uTexture, vTextureCoord).a;
            float heat = vVfxUv.x;
            vec3 rgb = mix(uEdge, uFlame, smoothstep(0.0, 0.45, heat));
            rgb = mix(rgb, uCore, smoothstep(0.45, 1.0, heat));
            finalColor = vec4(rgb * alpha, alpha);
          }`
      },
      resources: {
        palette: {
          uEdge: { value: hexColorToRgb(palette.edge), type: 'vec3<f32>' },
          uFlame: { value: hexColorToRgb(palette.flame), type: 'vec3<f32>' },
          uCore: { value: hexColorToRgb(palette.core), type: 'vec3<f32>' }
        }
      },
      padding: 0,
      resolution: 1,
      antialias: 'off'
    })
    const sprite = new Sprite(source)
    sprite.label = 'fire-aoe.palette-ramp'
    sprite.filters = [filter]
    const target = RenderTexture.create({
      width: source.width,
      height: source.height,
      resolution: 1
    })
    try {
      this.renderer.render({ container: sprite, target, clear: true })
      return target
    } catch (error) {
      target.destroy(true)
      throw error
    } finally {
      sprite.filters = null
      sprite.destroy()
      filter.destroy()
    }
  }

  private bake(texture: Texture, kind: 'mask' | 'smoke' | 'smokeMask'): Texture {
    const conversion =
      kind === 'smoke'
        ? // ColorizeMask: RGB = vertexRGB * _Color.rgb * 2 * _Intensity;
          // alpha = texture.r * vertexAlpha * _Alpha * _Intensity. Convert to PMA.
          'float mask = tex.r * 0.5; finalColor = vec4(vec3(0.044776082) * mask, mask);'
        : kind === 'smokeMask'
          ? 'float mask = tex.r * 0.5; finalColor = vec4(vec3(mask), mask);'
          : 'float mask = tex.r; finalColor = vec4(vec3(mask), mask);'
    const filter = Filter.from({
      gl: {
        vertex: FIRE_VFX_VERTEX_SHADER,
        fragment: `#version 300 es
        in vec2 vTextureCoord;
        out vec4 finalColor;
        uniform sampler2D uTexture;
        void main() { vec4 tex = texture(uTexture, vTextureCoord); ${conversion} }
      `,
        name: `fire-aoe-${kind}`
      },
      padding: 0,
      resolution: 1,
      antialias: 'off'
    })
    const sprite = new Sprite(texture)
    sprite.label = `fire-aoe.prepare-${kind}`
    sprite.filters = [filter]
    const target = RenderTexture.create({
      width: texture.width,
      height: texture.height,
      resolution: 1
    })
    try {
      this.renderer.render({
        container: sprite,
        target,
        clear: true,
        clearColor: [0, 0, 0, 0]
      })
      this.owned.push(target)
      return target
    } catch (error) {
      target.destroy(true)
      throw error
    } finally {
      sprite.filters = null
      sprite.destroy()
      filter.destroy()
    }
  }

  destroy(): void {
    for (const texture of this.wisps) if (!texture.destroyed) texture.destroy()
    for (const texture of this.owned) if (!texture.destroyed) texture.destroy(true)
    this.owned.length = 0
  }
}

/** Red-channel lookup with the original tint-alpha semantics, adapted to Pixi PMA output. */
export class FireAoeComposite {
  readonly filter: Filter
  private readonly values: {
    uAlpha: number
    uIntensity: number
    uRampIntensity: number
    uGlow: number
  }

  constructor(
    heat: Texture,
    ramp: Texture,
    glowPass = false,
    appearance?: FireAoeAppearance
  ) {
    const glowColor = appearance?.glowColor ?? appearance?.palette?.flame
    this.filter = Filter.from({
      gl: {
        vertex: FIRE_VFX_VERTEX_SHADER,
        name: glowPass ? 'fire-aoe-glow' : 'fire-aoe-ramp',
        fragment: `#version 300 es
        in vec2 vVfxUv;
        out vec4 finalColor;
        uniform sampler2D uHeat, uRamp;
        uniform float uAlpha, uIntensity, uRampIntensity, uGlow;
        uniform vec3 uTint, uGlowColor;
        void main() {
          vec2 uv = vVfxUv;
          float heat = texture(uHeat, uv).r;
          ${
            glowPass
              ? `
          // Recovered glow pass: heat.rgb * dot(heat.rgb, vec3(.333)) * glow.
          // Hearthstone's scene-wide bloom is separate from this material pass.
          vec3 field = texture(uHeat, uv).rgb;
          vec3 light = field * dot(field, vec3(0.333)) * uGlow;
          finalColor = vec4(uGlowColor * light, 0.0);
          `
              : `
          vec4 ramp = texture(uRamp, vec2(heat * uRampIntensity, 0.5));
          // Loaded PNGs are premultiplied. Recover the ramp's authored RGB before tinting.
          vec3 rgb = ramp.rgb / max(ramp.a, 0.00001);
          rgb *= uTint * 0.549;
          rgb *= uIntensity * uAlpha;
          // Normalized framebuffer alpha is bounded; the ramp coordinate is not saturated.
          float alpha = min(1.0, ramp.a * uIntensity * uAlpha);
          // The ramp's first texel has alpha 1/255. Suppress empty black RT background only.
          float occupied = smoothstep(0.0, 0.008, heat);
          finalColor = vec4(rgb * alpha, alpha) * occupied;
          `
          }
        }
      `
      },
      padding: 0,
      antialias: 'off',
      // The heat quad extends beyond the viewport. Clipping its filter bounds would
      // remap 0..1 UVs onto the clipped rectangle and move/stretch the board fire.
      clipToViewport: false,
      resources: {
        uHeat: heat.source,
        uRamp: ramp.source,
        fire: {
          uTint: {
            value: appearance?.palette ? [1, 1, 1] : [1, 0.936, 0.866],
            type: 'vec3<f32>'
          },
          uGlowColor: {
            value: glowColor
              ? hexColorToRgb(glowColor)
              : [0.97794116, 0.45752969, 0.26605755],
            type: 'vec3<f32>'
          },
          uAlpha: { value: 0, type: 'f32' },
          uIntensity: { value: 2, type: 'f32' },
          uRampIntensity: { value: 1.1, type: 'f32' },
          uGlow: { value: 0.75, type: 'f32' }
        }
      }
    })
    this.values = this.filter.resources.fire.uniforms
  }

  update(alpha: number, intensity: number, rampIntensity: number, glow: number): void {
    Object.assign(this.values, {
      uAlpha: alpha,
      uIntensity: intensity,
      uRampIntensity: rampIntensity,
      uGlow: glow
    })
  }

  destroy(): void {
    this.filter.destroy()
  }
}

export function createFireBoardGlow(appearance?: FireAoeAppearance): Filter {
  const color = appearance?.glowColor ?? appearance?.palette?.flame
  return Filter.from({
    gl: {
      vertex: FIRE_VFX_VERTEX_SHADER,
      name: 'fire-aoe-board-glow',
      fragment: `#version 300 es
      precision highp float;
      in vec2 vTextureCoord, vVfxUv;
      out vec4 finalColor;
      uniform sampler2D uTexture;
      uniform vec4 uInputSize, uOutputFrame;
      uniform float uLevel;
      uniform vec3 uGlowColor;
      uniform vec2 uOverlapNear, uOverlapFar, uCoverageScale;
      float coverage(vec2 localUv) {
        if (any(lessThan(localUv, vec2(0.0))) || any(greaterThan(localUv, vec2(1.0)))) return 0.0;
        // Filter textures may be larger than the quad. Transform in local UVs,
        // then map back into the occupied region of Pixi's pooled input texture.
        vec2 sampleUv = vTextureCoord + (localUv - vVfxUv) * uOutputFrame.zw * uInputSize.zw;
        return texture(uTexture, sampleUv).a;
      }
      void main() {
        vec2 uv = vec2(0.5) + (vVfxUv - vec2(0.5)) * uCoverageScale;
        float mask = coverage(uv);
        // Add a low-opacity shoulder to the coverage mask. Scaling about the
        // texture center also preserves the half-board masks' shared center seam.
        vec2 centered = uv - vec2(0.5);
        float nearMask = coverage(vec2(0.5) + centered / uOverlapNear);
        float farMask = coverage(vec2(0.5) + centered / uOverlapFar);
        mask = max(mask, max(nearMask * 0.85, farMask * 0.4));
        // Smooth coverage mask replaces the dissolve texture; retain its white-point gain.
        float alpha = mask * uLevel * uLevel * 0.8;
        finalColor = clamp(vec4(uGlowColor * 2.0 * alpha, alpha), 0.0, 1.0);
      }
    `
    },
    padding: 0,
    clipToViewport: false,
    resources: {
      glow: {
        uCoverageScale: { value: [1, 1], type: 'vec2<f32>' },
        uOverlapNear: { value: [...L.boardGlowOverlap.near], type: 'vec2<f32>' },
        uOverlapFar: { value: [...L.boardGlowOverlap.far], type: 'vec2<f32>' },
        uGlowColor: {
          value: color
            ? Array.from(hexColorToRgb(color), (v) => v * 0.41176471)
            : [0.41176471, 0.09803922, 0.0],
          type: 'vec3<f32>'
        },
        uLevel: { value: 0, type: 'f32' }
      }
    }
  })
}

/** Direct port of Hero/AddMultiply/AddMultiply, including saturation AFTER vertex color.
 * A mesh avoids baking/clipping the HDR intermediate before per-particle color is applied.
 * With the opaque burst texture and material alpha=1, output alpha is zero (emissive).
 */
export class FireImpactMesh extends Mesh<MeshGeometry, Shader> {
  constructor(texture: Texture, burst: boolean, color?: string) {
    const geometry = new MeshGeometry({
      positions: new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3])
    })
    geometry.batchMode = 'no-batch'
    const shader = Shader.from({
      gl: {
        name: 'fire-aoe-add-multiply',
        vertex: `in vec2 aPosition; in vec2 aUV; out vec2 vUV;
          uniform mat3 uProjectionMatrix, uWorldTransformMatrix, uTransformMatrix;
          void main() { vUV=aUV; gl_Position=vec4((uProjectionMatrix*uWorldTransformMatrix*uTransformMatrix*vec3(aPosition,1.0)).xy,0.0,1.0); }`,
        fragment: `in vec2 vUV; out vec4 finalColor;
          uniform sampler2D uArtwork;
          uniform vec4 uMaterialColor, uParticleColor, uColor;
          uniform float uIntensity;
          uniform vec3 uTint;
          uniform float uRecolor;
          void main() {
            vec4 tex=texture(uArtwork,vUV);
            vec3 rgb=tex.rgb/max(tex.a,0.00001);
            vec4 outputColor=vec4(rgb*uMaterialColor.rgb,tex.a*(uMaterialColor.a-tex.a));
            finalColor=clamp(outputColor*(2.0*uIntensity)*uParticleColor,0.0,1.0)*uColor;
            if (uRecolor > 0.5) finalColor.rgb = uTint * max(max(finalColor.r, finalColor.g), finalColor.b);
          }`
      },
      resources: {
        uArtwork: texture.source,
        impact: {
          uTint: { value: color ? hexColorToRgb(color) : [1, 1, 1], type: 'vec3<f32>' },
          uRecolor: { value: color ? 1 : 0, type: 'f32' },
          uMaterialColor: {
            value: burst
              ? [0.17164177, 0.02433727, 0.02433727, 1]
              : [0.77611941, 0.45193306, 0.272221, 0.48235294],
            type: 'vec4<f32>'
          },
          uParticleColor: { value: [1, 1, 1, 1], type: 'vec4<f32>' },
          uIntensity: { value: burst ? 9 : 1, type: 'f32' }
        }
      }
    })
    super({ geometry, shader, texture })
  }
  setParticleColor(color: readonly number[]): void {
    this.shader!.resources.impact.uniforms.uParticleColor = color
  }
  override destroy(): void {
    const geometry = this.geometry,
      shader = this.shader
    super.destroy()
    geometry.destroy(true)
    shader?.destroy()
  }
}
