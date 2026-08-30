import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptToken, decryptToken } from '../src/github/utils/github-token-crypto';

test('token crypto: round-trips a token', () => {
  const token = 'github_pat_11ABCDEFG_verysecretvalue';
  const encrypted = encryptToken(token);
  assert.notEqual(encrypted, token);
  assert.equal(decryptToken(encrypted), token);
});

test('token crypto: two encryptions of the same token differ (random IV)', () => {
  const token = 'github_pat_same_value';
  assert.notEqual(encryptToken(token), encryptToken(token));
});

test('token crypto: tampered payload fails to decrypt', () => {
  const encrypted = encryptToken('github_pat_xxx');
  const [iv, tag, data] = encrypted.split(':');
  const tampered = [iv, tag, data.slice(0, -2) + '00'].join(':');
  assert.throws(() => decryptToken(tampered));
});
