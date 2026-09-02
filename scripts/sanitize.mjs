import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeSlur } from '../src/sanitize.js'

const W = String.fromCharCode(110, 105, 103, 103, 101, 114)

test('replaces targeted slur and common variants', () => {
  assert.equal(sanitizeSlur(W), 'n****')
  assert.equal(sanitizeSlur(W.toUpperCase()), 'n****')
  assert.equal(sanitizeSlur(W.split('').join('-')), 'n****')
  assert.equal(sanitizeSlur(W.split('').join(' ')), 'n****')
  assert.equal(sanitizeSlur(W.replace('e', '3')), 'n****')
  assert.equal(sanitizeSlur(W.replace('i', '1').replace('e', '3')), 'n****')
  assert.equal(sanitizeSlur('hello ' + W + ' world'), 'hello n**** world')
})

test('leaves ordinary text alone', () => {
  assert.equal(sanitizeSlur('nothing to see here'), 'nothing to see here')
  assert.equal(sanitizeSlur(W + 'ish'), W + 'ish')
  assert.equal(sanitizeSlur('a' + W), 'a' + W)
  assert.equal(sanitizeSlur('n i g g e'), 'n i g g e')
})
