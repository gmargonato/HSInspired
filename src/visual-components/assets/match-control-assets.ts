import type { Texture } from 'pixi.js'
import { asset } from './asset-definition'
import { ASSET_BUNDLE_IDS } from './asset-bundle-ids'
import modelUrl from '@assets/models/match/match-controls.json?url'
import controlTexture0 from '@assets/images/match/end-turn-button-diffuse.png'
import controlTexture1 from '@assets/images/heroes/hero-power-mana-diffuse.png'
import controlTexture2 from '@assets/images/heroes/hero-power-mana-clouds.png'
import controlTexture3 from '@assets/images/heroes/hero-power-frame-diffuse.png'
import controlTexture4 from '@assets/images/heroes/hero-power-white.png'
import controlTexture5 from '@assets/images/heroes/hero-power-back-diffuse.png'
import controlTexture6 from '@assets/images/heroes/hero-power-frame-premium-diffuse.png'
import controlTexture7 from '@assets/images/heroes/hero-power-back-premium-diffuse.png'
import premiumFrameSpecular from '@assets/images/heroes/hero-power-frame-premium-specular.png'
import premiumBackSpecular from '@assets/images/heroes/hero-power-back-premium-specular.png'
import premiumReflection from '@assets/images/heroes/hero-power-premium-reflection.png'
export const MATCH_CONTROL_ASSETS = [
  asset('match.controls.premium-frame-specular', ASSET_BUNDLE_IDS.gameControls,
    'Hero_Power_Frame_Golden_Specular', premiumFrameSpecular, 128, 128, 'match-controls'),
  asset('match.controls.premium-back-specular', ASSET_BUNDLE_IDS.gameControls,
    'Hero_Power_S_Gold', premiumBackSpecular, 128, 128, 'match-controls'),
  asset('match.controls.premium-reflection', ASSET_BUNDLE_IDS.gameControls,
    'GenFX_clouds7', premiumReflection, 256, 256, 'match-controls'),
  asset(
    'match.controls.models',
    ASSET_BUNDLE_IDS.gameControls,
    'models',
    modelUrl,
    0,
    0,
    'match-controls'
  ),
  asset(
    'match.controls.board-endturnbutton',
    ASSET_BUNDLE_IDS.gameControls,
    'Board_EndTurnButton',
    controlTexture0,
    512,
    512,
    'match-controls'
  ),
  asset(
    'match.controls.genfx-gem-mana-d',
    ASSET_BUNDLE_IDS.gameControls,
    'GenFX_Gem_Mana_D',
    controlTexture1,
    128,
    128,
    'match-controls'
  ),
  asset(
    'match.controls.genfx-clouds03',
    ASSET_BUNDLE_IDS.gameControls,
    'GenFX_clouds03',
    controlTexture2,
    256,
    256,
    'match-controls'
  ),
  asset(
    'match.controls.hero-power-frame',
    ASSET_BUNDLE_IDS.gameControls,
    'Hero_Power_Frame',
    controlTexture3,
    256,
    256,
    'match-controls'
  ),
  asset(
    'match.controls.genfx-white32x32',
    ASSET_BUNDLE_IDS.gameControls,
    'GenFX_white32x32',
    controlTexture4,
    32,
    32,
    'match-controls'
  ),
  asset(
    'match.controls.hero-power-d',
    ASSET_BUNDLE_IDS.gameControls,
    'Hero_Power_D',
    controlTexture5,
    256,
    256,
    'match-controls'
  ),
  asset(
    'match.controls.hero-power-frame-golden',
    ASSET_BUNDLE_IDS.gameControls,
    'Hero_Power_Frame_Golden',
    controlTexture6,
    256,
    256,
    'match-controls'
  ),
  asset(
    'match.controls.hero-power-d-gold',
    ASSET_BUNDLE_IDS.gameControls,
    'Hero_Power_D_Gold',
    controlTexture7,
    256,
    256,
    'match-controls'
  )
] as const
export interface CurveKey {
  time: number
  value: number[]
  inSlope: (number | string)[]
  outSlope: (number | string)[]
}
export interface ControlTrack {
  path: string
  property: string
  keys: CurveKey[]
}
export interface ControlClip {
  duration: number
  tracks: ControlTrack[]
}
export interface ControlNode {
  name: string
  path: string
  position: number[]
  quaternion: number[]
  scale: number[]
  mesh?: string
  materials?: string[]
  text?: { value: string; width: number; height: number }
}
export interface ControlModelData {
  controls: Record<string, ControlNode[]>
  meshes: Record<
    string,
    {
      positions: number[]
      normals: number[]
      uv: number[]
      indices: number[]
      groups: { start: number; count: number; material: number }[]
    }
  >
  materials: Record<
    string,
    {
      textures: Record<string, { name: string; scale: number[]; offset: number[] }>
      floats: Record<string, number>
      colors: Record<string, number[]>
    }
  >
  clips: Record<string, ControlClip>
}
export type MatchControlAssets = { models: ControlModelData } & Record<
  string,
  Texture | ControlModelData
>
