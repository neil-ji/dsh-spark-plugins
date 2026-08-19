import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSearchTermsPrompt, parseSearchTerms } from '../src/memory-terms.ts'

test('parseSearchTerms parses a JSON string array', () => {
  assert.deepEqual(parseSearchTerms('["recall", "召回", "citation"]'), ['recall', '召回', 'citation'])
})

test('parseSearchTerms tolerates surrounding prose and dedupes', () => {
  assert.deepEqual(parseSearchTerms('Here you go: ["recall", "recall", " 召回 "]'), ['recall', '召回'])
})

test('parseSearchTerms returns [] on invalid or non-array input', () => {
  assert.deepEqual(parseSearchTerms('not json'), [])
  assert.deepEqual(parseSearchTerms('{}'), [])
  assert.deepEqual(parseSearchTerms('[1, "x", ""]'), ['x'])
  assert.deepEqual(parseSearchTerms(''), [])
})

test('parseSearchTerms drops over-long terms', () => {
  const long = 'a'.repeat(51)
  assert.deepEqual(parseSearchTerms(JSON.stringify(['ok', long])), ['ok'])
})

test('buildSearchTermsPrompt embeds title and content', () => {
  const prompt = buildSearchTermsPrompt('Recall design', 'How memory is cited')
  assert.equal(prompt.user.includes('Recall design'), true)
  assert.equal(prompt.user.includes('How memory is cited'), true)
  assert.equal(prompt.system.length > 0, true)
})
