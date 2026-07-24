const test = require('node:test');
const assert = require('node:assert/strict');

const { getUserId } = require('../services/db');

function makeReq(query = {}, headers = {}) {
  return { query, headers };
}

test('getUserId returns trimmed string keys', () => {
  assert.equal(getUserId(makeReq({ user: '  abc-123  ' })), 'abc-123');
  assert.equal(getUserId(makeReq({ uid: 'uid-key' })), 'uid-key');
  assert.equal(getUserId(makeReq({}, { 'x-user-id': 'header-key' })), 'header-key');
});

test('getUserId prefers user over uid over header', () => {
  const req = makeReq(
    { user: 'primary', uid: 'secondary' },
    { 'x-user-id': 'tertiary' },
  );
  assert.equal(getUserId(req), 'primary');
});

test('getUserId rejects non-string values (query parser objects/arrays)', () => {
  // Express extended query parser: ?user[$gt]=x -> { user: { $gt: 'x' } }
  assert.equal(getUserId(makeReq({ user: { $gt: '' } })), null);
  // ?user=a&user=b -> { user: ['a', 'b'] }
  assert.equal(getUserId(makeReq({ user: ['a', 'b'] })), null);
  assert.equal(getUserId(makeReq({ user: 42 })), null);
});

test('getUserId falls through to the next candidate when one is invalid', () => {
  assert.equal(
    getUserId(makeReq({ user: { $gt: '' }, uid: 'valid-uid' })),
    'valid-uid',
  );
});

test('getUserId rejects empty and oversized keys', () => {
  assert.equal(getUserId(makeReq({ user: '' })), null);
  assert.equal(getUserId(makeReq({ user: '   ' })), null);
  assert.equal(getUserId(makeReq({ user: 'x'.repeat(129) })), null);
  assert.equal(getUserId(makeReq({ user: 'x'.repeat(128) })), 'x'.repeat(128));
  assert.equal(getUserId(makeReq({})), null);
});
