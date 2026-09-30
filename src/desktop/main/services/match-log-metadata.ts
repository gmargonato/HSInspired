import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { CARD_CATALOG } from '../../../game-rules/content/cards'
import { HERO_CATALOG } from '../../../game-rules/content/heroes'
import { HERO_POWER_CATALOG } from '../../../game-rules/content/hero-powers'
import type { JsonObject } from '../../contracts/ipc/ai'

export async function matchLogMetadata(
  appPath: string,
  version: string,
  development: boolean
): Promise<JsonObject> {
  let revision: JsonObject | null = null
  if (development) {
    try {
      const run = promisify(execFile)
      const options = {
        cwd: appPath,
        timeout: 2000,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024
      }
      const [head, status] = await Promise.all([
        run('git', ['rev-parse', 'HEAD'], options),
        run('git', ['status', '--porcelain', '--untracked-files=normal'], options)
      ])
      revision = { commit: head.stdout.trim(), dirty: status.stdout.trim().length > 0 }
    } catch {
      /* Installed builds and source archives may have no Git metadata. */
    }
  }
  return {
    appVersion: version,
    development,
    revision,
    contentFingerprint: createHash('sha256')
      .update(
        JSON.stringify({
          cards: CARD_CATALOG.all,
          heroes: HERO_CATALOG.all,
          heroPowers: HERO_POWER_CATALOG.all
        })
      )
      .digest('hex')
  }
}
