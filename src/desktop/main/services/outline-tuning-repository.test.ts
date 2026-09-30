import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import rawConfig from '../../../../config/outline-tunings.json'
import { parseOutlineTuningConfig } from '../../contracts/ipc/outline-tuning'
import { OutlineTuningRepository } from './outline-tuning-repository'

describe('OutlineTuningRepository', () => {
  const directories: string[] = []

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true }))
    )
  })

  it('atomically persists the latest queued production configuration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hs-outline-tuning-'))
    directories.push(directory)
    const filePath = join(directory, 'config', 'outline-tunings.json')
    const repository = new OutlineTuningRepository(filePath)
    const first = parseOutlineTuningConfig(rawConfig)
    const draft = structuredClone(rawConfig)
    draft.aura.presets.minion.glowIntensity = 0.35
    draft.aura.palettes.green.baseColor = 0x123456
    draft.ghost.tuning.particleWindStrength = 1.5
    draft.shatter.duration = 2.4
    draft.shatter.shardCount = 72
    const second = parseOutlineTuningConfig(draft)

    await Promise.all([repository.save(first), repository.save(second)])

    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(second)
    expect(await readdir(join(directory, 'config'))).toEqual(['outline-tunings.json'])
  })
})
