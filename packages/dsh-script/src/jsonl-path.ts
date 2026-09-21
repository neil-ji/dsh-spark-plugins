/**
 * JSONL path helpers shared by the three spark storages (sparks / proposals /
 * scripts).
 *
 * Two related defects live behind `EISDIR: illegal operation on a directory,
 * read` in the spark/proposal/script directories:
 *
 *  1. The parent directory used to be derived with a forward-slash regex
 *     (`filePath.replace(/[/][^/]+$/, '')` / the `lastIndexOf('/')` variant).
 *     `path.join` returns `\` separators on Windows, so the pattern never
 *     matched, the whole FILE path was handed to `mkdir -p`, and a directory
 *     named `proposals.jsonl` (etc.) was created in place of the file.
 *  2. Every later `readFile` of that path then failed with EISDIR, and the
 *     directory could never be replaced by the real JSONL file.
 *
 * `path.dirname` is the only correct derivation on every platform, and the
 * self-heal below repairs installations that already carry the empty
 * directory.
 *
 * @module dsh-script/jsonl-path
 */
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Ensure the parent directory of a JSONL file exists and that the file path
 * itself is free for the file.
 *
 * When the file path currently names an empty directory, that is exactly the
 * artifact of the old `mkdir`-the-file-path bug: nothing was ever written into
 * it (every write failed with EISDIR too), so removing it restores the
 * intended JSONL location. A NON-empty directory is real user data: it is
 * refused loudly rather than destroyed.
 *
 * @param filePath - absolute path the JSONL backend will read and write.
 * @throws when the path is a non-empty directory.
 */
export async function ensureJsonlPath(filePath: string): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true })
  const existing = await fs.stat(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (existing === null || !existing.isDirectory()) return
  const entries = await fs.readdir(filePath)
  if (entries.length > 0) {
    throw new Error(
      `spark storage: ${filePath} is a non-empty directory, not a JSONL file. ` +
      'Move it aside so the plugin can recreate the file.',
    )
  }
  await fs.rmdir(filePath)
}

/**
 * Describe an EISDIR failure with the path and the recovery step instead of
 * letting Node's bare `EISDIR: illegal operation on a directory, read` reach
 * the UI. Returns the original error for every other code.
 *
 * @param error - the error thrown by a filesystem call.
 * @param filePath - the path that was read or written.
 */
export function describeStorageError(error: unknown, filePath: string): Error {
  const err = error as NodeJS.ErrnoException
  if (err?.code === 'EISDIR') {
    return new Error(
      `spark storage: ${filePath} is a directory, not a JSONL file. ` +
      'Move it aside so the plugin can recreate the file.',
    )
  }
  return error instanceof Error ? error : new Error(String(error))
}
