'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

test('empty and whitespace-only posts are rejected', () => {
  assert.ok(L.validateInput('', '3').errors.text);
  assert.ok(L.validateInput('   \n  ', '3').errors.text);
});

test('post at the limit passes and one over fails', () => {
  assert.strictEqual(L.validateInput('a'.repeat(500), '3').ok, true);
  const over = L.validateInput('a'.repeat(501), '3');
  assert.strictEqual(over.ok, false);
  assert.match(over.errors.text, /1 characters over/);
});

test('emoji count as one character each', () => {
  assert.strictEqual(L.countChars('\u{1F418}\u{1F418}'), 2);
});

test('long strings without spaces are accepted when within the limit', () => {
  assert.strictEqual(L.validateInput('x'.repeat(400), '1').ok, true);
});

test('server count validation', () => {
  assert.ok(L.validateInput('hi', '').errors.servers);
  assert.ok(L.validateInput('hi', '-1').errors.servers);
  assert.ok(L.validateInput('hi', '1.5').errors.servers);
  assert.ok(L.validateInput('hi', 'abc').errors.servers);
  assert.ok(L.validateInput('hi', '10001').errors.servers);
  assert.strictEqual(L.validateInput('hi', '0').ok, true);
  assert.strictEqual(L.validateInput('hi', '10000').ok, true);
});

function statuses(failure, servers = 5, isPublic = true) {
  const input = { text: 'hi', length: 2, servers };
  return Object.fromEntries(L.buildTrace(input, failure, isPublic).map(s => [s.id, s.status]));
}

test('healthy system completes every step', () => {
  const s = statuses('none');
  assert.deepStrictEqual(Object.values(s), ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
});

test('sidekiq backlog delays only background steps', () => {
  const s = statuses('sidekiq');
  assert.strictEqual(s.validate, 'ok');
  assert.strictEqual(s.save, 'ok');
  assert.strictEqual(s.enqueue, 'ok');
  assert.strictEqual(s.fanout, 'delayed');
  assert.strictEqual(s.stream, 'delayed');
  assert.strictEqual(s.federate, 'delayed');
});

test('redis outage blocks queueing and skips what follows', () => {
  const s = statuses('redis');
  assert.strictEqual(s.save, 'ok');
  assert.strictEqual(s.enqueue, 'blocked');
  assert.strictEqual(s.fanout, 'skipped');
  assert.strictEqual(s.federate, 'skipped');
});

test('postgres outage blocks the save and everything after', () => {
  const s = statuses('postgres');
  assert.strictEqual(s.save, 'blocked');
  assert.strictEqual(s.enqueue, 'skipped');
  assert.strictEqual(s.fanout, 'skipped');
});

test('zero remote servers skips federation; private posts skip email', () => {
  assert.strictEqual(statuses('none', 0).federate, 'skipped');
  assert.strictEqual(statuses('none', 5, false).email, 'skipped');
});

test('unknown failure falls back to healthy', () => {
  assert.strictEqual(statuses('bogus').fanout, 'ok');
});

test('singular wording for one server', () => {
  const steps = L.buildTrace({ text: 'hi', length: 2, servers: 1 }, 'none', true);
  assert.match(steps.find(s => s.id === 'federate').detail, /about 1 delivery job on/);
});
