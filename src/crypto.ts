import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export function deriveAesKey(input: string): Buffer {
  const trimmed = input.trim();
  const base64 = Buffer.from(trimmed, 'base64');
  if (base64.length === 32 && base64.toString('base64').replace(/=+$/, '') === trimmed.replace(/=+$/, '')) {
    return base64;
  }

  if (/^[a-f0-9]{64}$/i.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  return createHash('sha256').update(trimmed, 'utf8').digest();
}

export function encryptText(plaintext: string, key: Buffer): EncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

export function decryptText(payload: EncryptedPayload, key: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
