import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildExtractionPrompt, candidateToInput, collectTurnMessages,
  extractTextFromBlocks, parseCandidateMemories,
} from '../src/memory-extract.ts'

test('extractTextFromBlocks keeps text and joins with spaces', () => {
  assert.equal(extractTextFromBlocks([
    { type: 'text', text: 'hello' },
    { type: 'tool-call' },
    { type: 'text', text: 'world' },
  ]), 'hello world')
  assert.equal(extractTextFromBlocks([]), '')
})

test('collectTurnMessages formats and truncates transcripts', () => {
  assert.equal(collectTurnMessages([
    { role: 'user', text: 'remember this' },
    { role: 'assistant', text: 'done' },
  ]), 'USER: remember this\nASSISTANT: done')
  const long = 'a'.repeat(30_000)
  const collected = collectTurnMessages([{ role: 'user', text: long }])
  assert.equal(collected.length <= 24_000 + '\n...[truncated]'.length, true)
  assert.equal(collected.endsWith('[truncated]'), true)
})

test('buildExtractionPrompt frames the transcript as JSON', () => {
  const prompt = buildExtractionPrompt('hello')
  assert.equal(prompt.system.includes('JSON array'), true)
  assert.equal(prompt.user.includes('Transcript:'), true)
  assert.equal(prompt.user.includes('"hello"'), true)
})

test('parseCandidateMemories accepts a plain JSON array', () => {
  const candidates = parseCandidateMemories(JSON.stringify([{
    kind: 'decision', title: 'Use pnpm', content: 'All installs use pnpm', tags: ['tooling'], scope: 'global', importance: 0.8,
  }]))
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].kind, 'decision')
  assert.equal(candidates[0].tags[0], 'tooling')
})

test('parseCandidateMemories tolerates surrounding prose', () => {
  const text = 'Here are candidates:\n[{"kind":"fact","title":"N","content":"C","tags":[],"scope":"global","importance":0.5}]\nDone'
  const candidates = parseCandidateMemories(text)
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].title, 'N')
})

test('parseCandidateMemories drops invalid entries and caps the list', () => {
  const items = Array.from({ length: 20 }, (_, index) => ({
    kind: 'fact', title: 'T' + String(index), content: 'C', tags: [], scope: 'global', importance: 0.5,
  }))
  const candidates = parseCandidateMemories(JSON.stringify(items))
  assert.equal(candidates.length, 12)
  assert.equal(parseCandidateMemories('not json').length, 0)
  assert.equal(parseCandidateMemories('[]').length, 0)
})

test('parseCandidateMemories normalizes scope and importance', () => {
  const candidates = parseCandidateMemories(JSON.stringify([
    { kind: 'constraint', title: 'X', content: 'Y', tags: ['a', 'a'], scope: 'other', importance: 2 },
  ]))
  assert.equal(candidates[0].scope, 'global')
  assert.equal(candidates[0].importance, 1)
})

test('candidateToInput writes candidate status and provenance', () => {
  const input = candidateToInput({
    kind: 'insight', title: 'T', content: 'C', tags: ['t'], scope: 'workspace', importance: 0.7,
  }, 'session-1', 3)
  assert.equal(input.status, 'candidate')
  assert.equal(input.sourceSessionId, 'session-1')
  assert.equal(input.sourceTurn, 3)
  assert.equal(input.updatedBy, 'system')
  assert.equal(input.scope, 'workspace')
})
