import assert from 'node:assert/strict';
import test from 'node:test';
import { decryptText, deriveAesKey, encryptText } from '../dist/crypto.js';

test('encrypts and decrypts text without plaintext in ciphertext', () => {
  const key = deriveAesKey('test-secret-that-is-long-enough');
  const payload = encryptText('今晚想一起聊天', key);

  assert.notEqual(payload.ciphertext, '今晚想一起聊天');
  assert.equal(Buffer.from(payload.iv, 'base64').length, 12);
  assert.equal(decryptText(payload, key), '今晚想一起聊天');
});
