import { randomUUID } from 'node:crypto'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  parseCardClassBuilderConfig,
  type CardClassBuilderConfig
} from '../../contracts/ipc/card-class-builder'

/** Development-only atomic writer for the source-controlled card color configuration. */
export class CardClassBuilderRepository {
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  save(config: CardClassBuilderConfig): Promise<void> {
    const payload = parseCardClassBuilderConfig(config)
    const operation = async (): Promise<void> => {
      const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
      await mkdir(dirname(this.filePath), { recursive: true })
      try {
        await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
        await rename(temporaryPath, this.filePath)
      } finally {
        await unlink(temporaryPath).catch(() => undefined)
      }
    }
    const next = this.mutationQueue.then(operation, operation)
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }
}
