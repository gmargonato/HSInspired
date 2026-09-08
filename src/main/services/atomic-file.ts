import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Replaces a file and always attempts to clean its unique temporary file.
 * The caller allocates the temporary name when scheduling the write. Content
 * is serialized after directory creation, at the same point as an immediate write.
 */
export async function replaceFileAtomically(
  filePath: string,
  temporaryPath: string,
  serialize: () => string
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  try {
    await writeFile(temporaryPath, serialize(), 'utf8')
    await rename(temporaryPath, filePath)
  } finally {
    await unlink(temporaryPath).catch(() => undefined)
  }
}
