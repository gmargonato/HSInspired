import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import rawConfig from '../../../config/card-class-colors.json'
import { parseCardClassBuilderConfig } from '../../shared/ipc/card-class-builder'
import { CardClassBuilderRepository } from './card-class-builder-repository'

describe('CardClassBuilderRepository', () => {
  const directories: string[] = []

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true }))
    )
  })

  it('atomically persists the latest queued production configuration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hs-card-class-builder-'))
    directories.push(directory)
    const filePath = join(directory, 'config', 'card-class-colors.json')
    const repository = new CardClassBuilderRepository(filePath)
    const first = parseCardClassBuilderConfig(rawConfig)
    const second = parseCardClassBuilderConfig({
      ...first,
      classes: {
        ...first.classes,
        Druid: {
          ...first.classes.Druid,
          primary: { ...first.classes.Druid.primary, hue: 222.5 }
        }
      }
    })

    await Promise.all([repository.save(first), repository.save(second)])

    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(second)
  })
})
