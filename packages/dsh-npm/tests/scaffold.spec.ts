import { describe, expect, it } from 'vitest'
import { renderScaffold } from '../src/scaffold.ts'

const opts = {
  packageName: 'test-lib',
  description: 'A test library',
  repoOwner: 'octocat',
  repoName: 'test-lib',
  authorName: 'Octo Cat',
  licenseYear: '2026',
}

describe('renderScaffold', () => {
  it('emits all expected template files', async () => {
    const files = await renderScaffold(opts)
    for (const p of [
      'package.json', 'tsconfig.json', 'build.mjs', 'src/index.ts', '.gitignore',
      'README.md', 'LICENSE',
      '.github/workflows/release.yml', '.github/workflows/pages.yml',
    ]) {
      expect(files.has(p)).toBe(true)
    }
  })

  it('replaces every author-facing placeholder token', async () => {
    const files = await renderScaffold(opts)
    const all = [...files.values()].join('\n')
    for (const token of ['__PACKAGE_NAME__', '__PACKAGE_DESCRIPTION__', '__REPO_OWNER__', '__REPO_NAME__', '__AUTHOR_NAME__', '__LICENSE_YEAR__']) {
      expect(all).not.toContain(token)
    }
  })

  it('injects the package name and owner into package.json', async () => {
    const files = await renderScaffold(opts)
    const pkg = files.get('package.json') ?? ''
    expect(pkg).toContain('"name": "test-lib"')
    expect(pkg).toContain('https://github.com/octocat/test-lib.git')
  })
})
