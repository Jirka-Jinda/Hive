import {
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LEN = 32;
const SALT_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
const ITERATIONS = 100_000;
const DIGEST = 'sha256';

function deriveKey(password: string, salt: Buffer): Buffer {
  return pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST);
}

/**
 * Encrypts plaintext with AES-256-GCM.
 * Returns a base64 string: salt(32) + iv(12) + tag(16) + ciphertext.
 */
export function encrypt(plaintext: string, password: string): string {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(password, salt);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, encrypted]).toString('base64');
}

/**
 * Decrypts a base64 string previously produced by encrypt().
 */
export function decrypt(ciphertext: string, password: string): string {
  const buf = Buffer.from(ciphertext, 'base64');
  const salt = buf.subarray(0, SALT_LEN);
  const iv = buf.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const tag = buf.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const encrypted = buf.subarray(SALT_LEN + IV_LEN + TAG_LEN);
  const key = deriveKey(password, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
}
