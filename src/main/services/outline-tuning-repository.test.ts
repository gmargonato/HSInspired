import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import rawConfig from '../../../config/outline-tunings.json'
import { parseOutlineTuningConfig } from '../../shared/ipc/outline-tuning'
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
    const second = parseOutlineTuningConfig({
      ...first,
      presets: {
        ...first.presets,
        board: { ...first.presets.board, glowStrength: 2.25 }
      }
    })

    await Promise.all([repository.save(first), repository.save(second)])

    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(second)
    expect(await readdir(join(directory, 'config'))).toEqual(['outline-tunings.json'])
  })
})
