/**
 * Phase 6 valence heuristic tests (pure).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  detectIntensity,
  extractPreferences,
  candidateToHippoPreference,
  decayImportance,
} from '../src/valence.ts'

test('detectIntensity: empty → 0', () => {
  assert.equal(detectIntensity(''), 0)
})

test('detectIntensity: polite English → low (below 0.4 threshold)', () => {
  assert.ok(detectIntensity('please consider revising the api') < 0.4)
})

test('detectIntensity: ALL CAPS run adds weight', () => {
  const polite = detectIntensity('please fix this')
  const angry = detectIntensity('WHY DID YOU DO THIS')
  assert.ok(angry > polite, 'angry should outscore polite: ' + angry + ' vs ' + polite)
})

test('detectIntensity: Chinese frustration markers add weight', () => {
  const polite = detectIntensity('这个方案可以再优化一下')
  const angry = detectIntensity('你怎么搞的！这不对')
  assert.ok(angry > polite)
})

test('detectIntensity: English profanity adds weight', () => {
  const angry = detectIntensity('this is broken, damn it')
  assert.ok(angry >= 0.4)
})

test('detectIntensity: bounded to [0, 1]', () => {
  const text = 'WHY!!! WTF??? ' + '你搞砸了, damn, ' + 'a'.repeat(100)
  assert.ok(detectIntensity(text) <= 1)
})

test('extractPreferences: "don\'t touch X" → do-not', () => {
  const out = extractPreferences("don't touch the build config")
  assert.ok(out.some(c => c.kind === 'do-not' && c.target.includes('build')), JSON.stringify(out))
})

test('extractPreferences: "别动 X" → do-not', () => {
  const out = extractPreferences('别动我的配置文件')
  assert.ok(out.some(c => c.kind === 'do-not' && c.target.includes('配置')))
})

test('extractPreferences: "always X" → always', () => {
  const out = extractPreferences('always run tests before commit')
  assert.ok(out.some(c => c.kind === 'always' && c.target.includes('run tests')))
})

test('extractPreferences: "总是 X" → always', () => {
  const out = extractPreferences('总是先更新文档')
  assert.ok(out.some(c => c.kind === 'always' && c.target.includes('更新')))
})

test('extractPreferences: "never X" → never', () => {
  const out = extractPreferences('never run rm -rf in production')
  assert.ok(out.some(c => c.kind === 'never' && c.target.includes('rm')))
})

test('extractPreferences: dedups repeated (kind, target)', () => {
  const out = extractPreferences("don't touch the build. don't touch the build. don't touch the build!")
  const buildHits = out.filter(c => c.target.toLowerCase().includes('build'))
  assert.equal(buildHits.length, 1, 'should dedup identical (kind, target) pairs: ' + JSON.stringify(out))
})

test('extractPreferences: empty → []', () => {
  assert.deepEqual(extractPreferences(''), [])
})

test('candidateToHippoPreference: maps kind to title prefix', () => {
  const c = { kind: 'do-not' as const, target: 'build', source: "don't touch the build" }
  const out = candidateToHippoPreference(c)
  assert.equal(out.kind, 'preference')
  assert.match(out.title, /Don't.*build/)
  assert.equal(out.content, c.source)
  assert.deepEqual(out.tags, ['preference', 'valence-mined', 'do-not'])
  assert.equal(out.scope, 'global')
  assert.equal(out.importance, 0.7)
  assert.equal(out.globalProven, false)
})

test('decayImportance: never drops below 40%', () => {
  assert.ok(decayImportance(1.0, 0) > 0.99)
  assert.ok(decayImportance(1.0, 365) >= 0.4)
})

test('decayImportance: monotone decreasing', () => {
  let prev = decayImportance(1.0, 0)
  for (const age of [1, 7, 30, 90, 365]) {
    const next = decayImportance(1.0, age)
    assert.ok(next <= prev, 'must be monotone at age ' + age + ': ' + next + ' vs ' + prev)
    prev = next
  }
})

// Integration: high-intensity message extracts preferences
test('integration: high-intensity frustration message yields a preference candidate', () => {
  const message = "WHY did you change file X! don't touch it again!"
  const intensity = detectIntensity(message)
  const candidates = extractPreferences(message)
  assert.ok(intensity >= 0.4, 'should cross default threshold: ' + intensity)
  assert.ok(candidates.length >= 1, 'should extract ≥1 preference: ' + JSON.stringify(candidates))
  assert.ok(candidates.some(c => c.kind === 'do-not'))
})
console.log('valence tests loaded');
