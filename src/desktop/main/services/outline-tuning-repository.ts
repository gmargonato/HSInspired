import { randomUUID } from 'node:crypto'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  parseOutlineTuningConfig,
  type OutlineTuningConfig
} from '../../contracts/ipc/outline-tuning'

/** Development-only atomic writer for the source-controlled outline configuration. */
export class OutlineTuningRepository {
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  save(config: OutlineTuningConfig): Promise<void> {
    const payload = parseOutlineTuningConfig(config)
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
