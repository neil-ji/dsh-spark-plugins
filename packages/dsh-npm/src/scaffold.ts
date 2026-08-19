/**
 * Scaffold rendering: reads the bundled templates/ directory (published with
 * the package via "files") and replaces __PLACEHOLDER__ tokens.
 */
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface ScaffoldOptions {
  packageName: string
  description: string
  repoOwner: string
  repoName: string
  authorName: string
  licenseYear: string
}

/** Placeholder tokens replaced at render time (__DSH_VERSION__ is left for CI). */
const TOKENS: Record<string, keyof ScaffoldOptions> = {
  '__PACKAGE_NAME__': 'packageName',
  '__PACKAGE_DESCRIPTION__': 'description',
  '__REPO_OWNER__': 'repoOwner',
  '__REPO_NAME__': 'repoName',
  '__AUTHOR_NAME__': 'authorName',
  '__LICENSE_YEAR__': 'licenseYear',
}

function templateRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../templates')
}

/** Recursively read templates/ into path -> raw content (template-relative paths). */
async function readTemplates(dir: string, prefix: string, out: Map<string, string>): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const rel = prefix + entry.name
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await readTemplates(full, rel + '/', out)
    } else {
      out.set(rel, await readFile(full, 'utf8'))
    }
  }
}

/** Render all templates into a map of repo-relative path -> final content. */
export async function renderScaffold(opts: ScaffoldOptions): Promise<Map<string, string>> {
  const raw = new Map<string, string>()
  await readTemplates(templateRoot(), '', raw)
  const out = new Map<string, string>()
  for (const [rel, content] of raw) {
    let rendered = content
    for (const [token, key] of Object.entries(TOKENS)) {
      rendered = rendered.split(token).join(opts[key])
    }
    out.set(rel, rendered)
  }
  return out
}

/** Write rendered files under root, creating parent directories. */
export async function writeScaffold(root: string, files: Map<string, string>): Promise<number> {
  for (const [rel, content] of files) {
    const target = join(root, rel)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, content, 'utf8')
  }
  return files.size
}
