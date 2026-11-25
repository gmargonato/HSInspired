import * as THREE from 'three'
import type { ControlModelData } from '../../../visual-components/assets/match-control-assets'
import { MATCH_CONTROLS_3D_LAYOUT as layout } from './match-controls-3d-layout'

type SourceMaterial = ControlModelData['materials'][string]

/** Adapt Unity's DiffuseReflection material to the Three lighting pipeline. */
export function configureGoldReflection(
  material: THREE.MeshPhongMaterial,
  source: SourceMaterial,
  reflection: THREE.Texture,
  mask: THREE.Texture,
  enabled: { value: number },
  time: { value: number }
): void {
  const color = (name: string) => new THREE.Color().fromArray(source.colors[name])
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      goldEnabled: enabled,
      goldFrameSaturation: { value: layout.lighting.heroPower.goldFrameSaturation },
      goldFrameBrightness: { value: layout.lighting.heroPower.goldFrameBrightness },
      goldTime: time,
      goldReflection: { value: reflection },
      goldMask: { value: mask },
      goldColor: { value: color('_ReflectionColor') },
      goldIntensity: {
        value:
          source.floats._ReflectionIntensity *
          layout.lighting.heroPower.goldReflectionMultiplier
      },
      goldRotation: { value: source.floats._ReflectionRotation }
    })
    shader.fragmentShader =
      `
      uniform float goldEnabled, goldTime, goldIntensity, goldRotation, goldFrameSaturation;
      uniform float goldFrameBrightness;
      uniform sampler2D goldReflection, goldMask;
      uniform vec3 goldColor;
    ` +
      shader.fragmentShader
        .replace(
          '#include <map_fragment>',
          `
      #include <map_fragment>
      // Enrich only the premium plate texture, before lighting and reflection.
      float frameGray = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      diffuseColor.rgb = mix(vec3(frameGray), diffuseColor.rgb,
        mix(1.0, goldFrameSaturation, goldEnabled));
      diffuseColor.rgb *= mix(1.0, goldFrameBrightness, goldEnabled);
    `
        )
        .replace(
          '#include <opaque_fragment>',
          `
      // View-space reflection follows the original mesh normals during its flip.
      vec3 reflected = reflect(-normalize(vViewPosition), normal);
      vec2 reflectionUV = reflected.xy * 0.5;
      float c = cos(goldRotation * goldTime), s = sin(goldRotation * goldTime);
      reflectionUV = mat2(c, -s, s, c) * reflectionUV + 0.5;
      outgoingLight += goldEnabled * goldIntensity * goldColor
        * texture2D(goldReflection, reflectionUV).rgb * texture2D(goldMask, vMapUv).rgb;
      #include <opaque_fragment>
    `
        )
  }
  material.customProgramCacheKey = () => 'match-gold-reflection-v3'
}

/** The original mana texture's alpha masks its scrolling inner light. */
export function configureManaCrystal(
  material: THREE.MeshPhongMaterial,
  source: SourceMaterial,
  clouds: THREE.Texture,
  time: { value: number }
): void {
  material.color.fromArray(source.colors._TintColor)
  // The active DiffuseAlphaMaskScroller shader has no specular/gloss term.
  // _SpecColor, _Shininess and _Color survive in the serialized material only.
  material.specular.set(0x000000)
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      crystalTime: time,
      crystalClouds: { value: clouds },
      crystalTint: { value: new THREE.Color().fromArray(source.colors._tint) },
      crystalSpeed: {
        value: new THREE.Vector2(source.floats._XSpeed, source.floats._YSpeed)
      },
      crystalScale: {
        value: new THREE.Vector2(source.floats._ScaleX, source.floats._ScaleY)
      },
      crystalIntensity: { value: source.floats._Intensity }
    })
    shader.fragmentShader =
      `
      uniform float crystalTime, crystalIntensity;
      uniform sampler2D crystalClouds;
      uniform vec3 crystalTint;
      uniform vec2 crystalSpeed, crystalScale;
    ` +
      shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `
      vec2 crystalUV = vMapUv * crystalScale + crystalSpeed * crystalTime / 20.0;
      float innerLight = texture2D(crystalClouds, crystalUV).r;
      float crystalMask = texture2D(map, vMapUv).a;
      outgoingLight += crystalTint * innerLight * crystalMask * crystalIntensity;
      diffuseColor.a = opacity;
      #include <opaque_fragment>
    `
      )
  }
  material.customProgramCacheKey = () => 'match-mana-scroller-v1'
}
