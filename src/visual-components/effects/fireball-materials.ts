import {
  Buffer,
  BufferUsage,
  Container,
  Filter,
  Mesh,
  MeshGeometry,
  Shader,
  Texture
} from 'pixi.js'
import type { GameAssets } from '../assets'
import authored from './fireball-authored.json'
import { FIRE_VFX_VERTEX_SHADER } from './fire-vfx-shader-common'

export type FireballAssets = Pick<
  GameAssets,
  | 'fireballCoreClouds'
  | 'fireballCoreShadows'
  | 'fireballCrescent'
  | 'fireballErosion'
  | 'fireballFill'
  | 'fireballGlow'
  | 'fireballImpactFlash'
  | 'fireballScorch'
  | 'fireballSmoke'
  | 'fireballSpark'
>
interface Material {
  shader: string
  values: Record<string, number | number[]>
  textures: Record<string, { asset: string; scale: number[]; offset: number[] }>
}
export const FIREBALL_MATERIALS = authored.materials as unknown as Record<
  string,
  Material
>
export function fireballTexture(assets: FireballAssets, name: string): Texture {
  const key = ('fireball' +
    name
      .split('-')
      .map((s) => s[0].toUpperCase() + s.slice(1))
      .join('')) as keyof FireballAssets
  return assets[key]
}
export function configureFireballAssets(assets: FireballAssets): void {
  // Unity samples RGB independently of alpha, including the erosion texture's
  // transparent pixels. Preserve that data instead of premultiplying on upload.
  for (const name of [
    'core-clouds',
    'core-shadows',
    'crescent',
    'erosion',
    'fill',
    'glow',
    'impact-flash',
    'scorch',
    'smoke',
    'spark'
  ]) {
    const source = fireballTexture(assets, name).source
    if (source.alphaMode !== 'no-premultiply-alpha') {
      source.alphaMode = 'no-premultiply-alpha'
      source.update()
    }
  }
}
const VERTEX = `in vec2 aPosition; in vec2 aUV; in vec4 aParticleColor;
 out vec2 vUV; out vec4 vParticleColor;
 uniform mat3 uProjectionMatrix,uWorldTransformMatrix,uTransformMatrix;
 void main(){vUV=aUV;vParticleColor=aParticleColor;gl_Position=vec4((uProjectionMatrix*uWorldTransformMatrix*uTransformMatrix*vec3(aPosition,1.0)).xy,0.0,1.0);}`

/** One draw per authored stream; particles retain independent vertex colors and erosion. */
export class FireballParticleMesh extends Mesh<MeshGeometry, Shader> {
  readonly positions: Float32Array
  readonly colors: Float32Array
  constructor(assets: FireballAssets, materialName: string, count: number) {
    const material = FIREBALL_MATERIALS[materialName],
      values = material.values
    const smoke = material.shader.includes('Particles_Transparent')
    const positions = new Float32Array(Math.max(1, count) * 8),
      uvs = new Float32Array(Math.max(1, count) * 8)
    const colors = new Float32Array(Math.max(1, count) * 16),
      indices = new Uint32Array(Math.max(1, count) * 6)
    for (let i = 0; i < count; i++) {
      uvs.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8)
      indices.set(
        [0, 1, 2, 0, 2, 3].map((x) => x + i * 4),
        i * 6
      )
    }
    const geometry = new MeshGeometry({ positions, uvs, indices })
    geometry.batchMode = 'no-batch'
    geometry.addAttribute('aParticleColor', {
      buffer: new Buffer({
        data: colors,
        usage: BufferUsage.VERTEX | BufferUsage.COPY_DST
      }),
      format: 'float32x4',
      stride: 16,
      offset: 0
    })
    const texture = fireballTexture(assets, material.textures._MainTex.asset)
    const erosion = assets.fireballErosion
    const shader = Shader.from({
      gl: {
        name: 'fireball-' + materialName,
        vertex: VERTEX,
        fragment: `
      in vec2 vUV; in vec4 vParticleColor; out vec4 finalColor;
      uniform sampler2D uArtwork,uErosion;
      uniform vec4 uMaterial; uniform float uAlphaIntensity,uNoiseScale,uKind;
      uniform vec3 uTint; uniform float uRecolor;
      void main(){
        vec4 tex=texture(uArtwork,vUV);vec3 rgb=tex.rgb;
        float alpha;vec3 color;
        if(uKind<0.5){
          // FX Particle Additive Alpha 2Layer: particle red/alpha drive the noise UV.
          vec2 noiseUV=(vUV+vParticleColor.rr-vParticleColor.aa*vec2(.33,.30))*uNoiseScale;
          float noise=texture(uErosion,fract(noiseUV)).r;
          alpha=noise*tex.a*uAlphaIntensity*vParticleColor.a;color=uMaterial.rgb;
        }else{
          vec4 vertex=2.0*uMaterial*vParticleColor;
          color=rgb*vertex.rgb;alpha=tex.a*vertex.a;
        }
        if(uRecolor>0.5)color=uTint*max(max(color.r,color.g),color.b);
        // Unity SrcAlpha,One squares alpha too. Pixi add-npm uses One for the
        // alpha channel, so bake both factors and use its One,One blend instead.
        finalColor=uKind<1.5?vec4(color*alpha,alpha*alpha):vec4(color,alpha);
        if(uKind>2.5)finalColor=vec4(mix(vec3(1.),rgb*vParticleColor.rgb,tex.a*vParticleColor.a),1.);
      }`
      },
      resources: {
        uArtwork: texture.source,
        uErosion: erosion.source,
        fireball: {
          uMaterial: {
            value: (smoke ? values._TintColor : values._Color) ?? [1, 1, 1, 1],
            type: 'vec4<f32>'
          },
          uAlphaIntensity: { value: values._AlphaIntensity ?? 1, type: 'f32' },
          uNoiseScale: { value: values._Scale ?? 1, type: 'f32' },
          uKind: { value: material.shader.includes('2Layer') ? 0 : 1, type: 'f32' },
          uTint: { value: [1, 1, 1], type: 'vec3<f32>' },
          uRecolor: { value: 0, type: 'f32' }
        }
      }
    })
    super({ geometry, shader, texture })
    this.positions = positions
    this.colors = colors
    this.blendMode = smoke
      ? 'normal-npm'
      : materialName === 'scorch'
        ? 'multiply'
        : 'add'
    this.label = 'fireball.particles.' + materialName
    if (smoke) {
      // Ordinary SrcAlpha,OneMinusSrcAlpha, including its separate alpha equation.
      shader.resources.fireball.uniforms.uKind = 2
    }
    if (materialName === 'scorch') shader.resources.fireball.uniforms.uKind = 3
  }
  upload(): void {
    this.geometry.getBuffer('aPosition').update()
    this.geometry.getBuffer('aParticleColor').update()
  }
  override destroy(): void {
    const { geometry, shader } = this
    super.destroy()
    geometry.destroy(true)
    shader?.destroy()
  }
}

/** Analytic front surface of the source spheres, with their original quaternions and UVs. */
export class FireballCoreMesh extends Container {
  readonly shader: Shader
  private readonly geometry: MeshGeometry
  private readonly additiveShader: Shader
  constructor(assets: FireballAssets, width: number, height: number, cameraZ: number) {
    super()
    const geometry = new MeshGeometry({
      positions: new Float32Array([0, 0, width, 0, width, height, 0, height]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3])
    })
    geometry.batchMode = 'no-batch'
    geometry.addAttribute('aParticleColor', {
      buffer: new Buffer({
        data: new Float32Array(16).fill(1),
        usage: BufferUsage.VERTEX
      }),
      format: 'float32x4'
    })
    const shader = Shader.from({
      gl: {
        name: 'fireball-three-cores',
        vertex: VERTEX,
        fragment: `
      in vec2 vUV; out vec4 finalColor;
      uniform sampler2D uClouds,uShadows;uniform vec2 uWorldSize;uniform float uCameraZ,uRadius;
      uniform vec4 uQ0,uQ1,uQ2; uniform vec3 uTint;uniform float uRecolor;
      vec3 inverseRotate(vec3 p,vec4 q){q.xyz=-q.xyz;return p+2.0*cross(q.xyz,cross(q.xyz,p)+q.w*p);}
      vec2 sphereUV(vec3 p){return vec2(atan(p.x,p.z)/6.28318530718+.5,acos(clamp(p.y,-1.0,1.0))/3.14159265359);}
      void main(){
        vec2 p=vec2((vUV.x-.5)*uWorldSize.x,(.5-vUV.y)*uWorldSize.y+uCameraZ)-vec2(.02602005,.00857067);
        float r2=dot(p,p)/(uRadius*uRadius);if(r2>1.0)discard;
        vec3 normal=vec3(p.x/uRadius,sqrt(max(0.0,1.0-r2)),p.y/uRadius);
        vec4 a=texture(uShadows,fract(sphereUV(inverseRotate(normal,uQ1))*vec2(2.,1.)));
        vec4 b=texture(uShadows,fract(sphereUV(inverseRotate(normal,uQ2))*vec2(2.,1.)));
        float mask1=ceil(a.a*.17254902-.09253731),mask2=ceil(b.a*.23529412-.11940298);
        vec3 dark=mask2>0.5?vec3(.05223882,.00818668,.00818668):vec3(.05970150,.02717755,.02717755);
        float mask=max(mask1,mask2);
        vec3 rgb=(mask2>0.5?b.rgb:a.rgb)*dark;
        if(uRecolor>.5)rgb=uTint*max(max(rgb.r,rgb.g),rgb.b);
        finalColor=vec4(rgb*mask,mask);
      }`
      },
      resources: {
        uClouds: assets.fireballCoreClouds.source,
        uShadows: assets.fireballCoreShadows.source,
        core: {
          uWorldSize: { value: [2.5, 8.5], type: 'vec2<f32>' },
          uCameraZ: { value: cameraZ, type: 'f32' },
          uRadius: { value: 0.3, type: 'f32' },
          uQ0: { value: [0, 0, 0, 1], type: 'vec4<f32>' },
          uQ1: { value: [0, 0, 0, 1], type: 'vec4<f32>' },
          uQ2: { value: [0, 0, 0, 1], type: 'vec4<f32>' },
          uTint: { value: [1, 1, 1], type: 'vec3<f32>' },
          uRecolor: { value: 0, type: 'f32' }
        }
      }
    })
    // SetRenderQue increments sortingOrder: dark spheres are 1, additive core is 2.
    // Unlit_Cutout has ZWrite Off. It must not replace the later additive fire.
    const dark = new Mesh({ geometry, shader, texture: assets.fireballCoreClouds })
    dark.label = 'fireball.core-cutouts'
    dark.blendMode = 'normal'
    const additiveShader = Shader.from({
      gl: {
        name: 'fireball-core-additive',
        vertex: VERTEX,
        fragment: `
      in vec2 vUV; out vec4 finalColor;
      uniform sampler2D uClouds;uniform vec2 uWorldSize;uniform float uCameraZ,uRadius;
      uniform vec4 uQ0;uniform vec3 uTint;uniform float uRecolor;
      vec3 inverseRotate(vec3 p,vec4 q){q.xyz=-q.xyz;return p+2.0*cross(q.xyz,cross(q.xyz,p)+q.w*p);}
      vec2 sphereUV(vec3 p){return vec2(atan(p.x,p.z)/6.28318530718+.5,acos(clamp(p.y,-1.0,1.0))/3.14159265359);}
      void main(){
        vec2 p=vec2((vUV.x-.5)*uWorldSize.x,(.5-vUV.y)*uWorldSize.y+uCameraZ)-vec2(.02602005,.00857067);
        float r2=dot(p,p)/(uRadius*uRadius);if(r2>1.0)discard;
        float y=sqrt(max(0.0,1.0-r2));
        vec4 front=texture(uClouds,fract(sphereUV(inverseRotate(vec3(p.x/uRadius,y,p.y/uRadius),uQ0))));
        vec4 back=texture(uClouds,fract(sphereUV(inverseRotate(vec3(p.x/uRadius,-y,p.y/uRadius),uQ0))));
        // Hero/Additive/Additive uses 2*_TintColor, SrcAlpha/One and Cull Off.
        // Both sphere faces contribute, after the dark cutouts.
        vec4 tint=vec4(1.,.08208954,.08208954,.45882353)*2.;
        vec4 a=front*tint,b=back*tint;
        vec3 rgb=a.rgb*clamp(a.a,0.,1.)+b.rgb*clamp(b.a,0.,1.);
        if(uRecolor>.5)rgb=uTint*max(max(rgb.r,rgb.g),rgb.b);
        finalColor=vec4(rgb,a.a*clamp(a.a,0.,1.)+b.a*clamp(b.a,0.,1.));
      }`
      },
      resources: {
        uClouds: assets.fireballCoreClouds.source,
        core: shader.resources.core
      }
    })
    const bright = new Mesh({
      geometry,
      shader: additiveShader,
      texture: assets.fireballCoreClouds
    })
    bright.label = 'fireball.core-additive'
    bright.blendMode = 'add'
    this.addChild(dark, bright)
    this.shader = shader
    this.geometry = geometry
    this.additiveShader = additiveShader
    this.label = 'fireball.cores'
  }
  override destroy(): void {
    super.destroy({ children: true })
    this.geometry.destroy(true)
    this.shader.destroy()
    this.additiveShader.destroy()
  }
}

/** AlphaClip and its bloom extraction/blur passes, recovered from resources.assets. */
export function createFireballComposite(
  kind: 'main' | 'extract' | 'horizontal' | 'vertical' | 'bloom-display',
  options: {
    alphaExponent: number
    intensity: number
    bloom: { intensity: number; threshold: number; blur: number }
  }
): Filter {
  return Filter.from({
    gl: {
      name: 'fireball-' + kind,
      vertex: FIRE_VFX_VERTEX_SHADER,
      fragment: `#version 300 es
    precision highp float;
    in vec2 vTextureCoord; out vec4 finalColor;uniform sampler2D uTexture;
    uniform vec4 uInputSize;uniform float uExponent,uIntensity,uThreshold,uBloom,uBlur;
    vec4 convert(vec4 s){return vec4(s.rgb*uIntensity,pow(max(s.a,0.0),uExponent));}
    void main(){
    ${
      kind === 'main'
        ? `vec4 s=convert(texture(uTexture,vTextureCoord));float a=clamp(s.a,0.,1.);finalColor=vec4(s.rgb*a,a);`
        : kind === 'bloom-display'
          ? `vec4 s=texture(uTexture,vTextureCoord);finalColor=vec4(s.rgb*s.a,s.a*s.a);`
          : kind === 'extract'
            ? `vec2 px=uInputSize.zw;vec4 s=texture(uTexture,vTextureCoord);
        s=max(s,texture(uTexture,vTextureCoord+px*vec2(1.5,1.5)));
        s=max(s,texture(uTexture,vTextureCoord+px*vec2(-1.5,1.5)));
        s=max(s,texture(uTexture,vTextureCoord+px*vec2(1.5,-1.5)));
        s=max(s,texture(uTexture,vTextureCoord+px*vec2(-1.5,-1.5)));
        finalColor=clamp(convert(s)-uThreshold,0.,1.)*uBloom;`
            : `vec2 offset=uInputSize.zw*${kind === 'horizontal' ? 'vec2(1.,0.)' : 'vec2(0.,1.)'}*(4.0*uBlur);
        finalColor=(texture(uTexture,vTextureCoord+offset*1.5)+texture(uTexture,vTextureCoord-offset*1.5)+texture(uTexture,vTextureCoord+offset*.5)+texture(uTexture,vTextureCoord-offset*.5))*.25;`
    }
    }`
    },
    resources: {
      fireballComposite: {
        uExponent: { value: options.alphaExponent, type: 'f32' },
        // _ColorIntensity remains 1 in Hidden/R2TAlphaClipBloom. The method's
        // _Intensity assignment controls threshold extraction, not RGB gain.
        uIntensity: { value: kind === 'main' ? options.intensity : 1, type: 'f32' },
        uThreshold: { value: options.bloom.threshold, type: 'f32' },
        uBloom: {
          value: options.bloom.intensity / (1 - options.bloom.threshold),
          type: 'f32'
        },
        uBlur: { value: options.bloom.blur, type: 'f32' }
      }
    },
    clipToViewport: false,
    padding: 0,
    antialias: 'off'
  })
}
