import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);
const KEY_LEN = 64;

/**
 * Hash a password with Node scrypt. Stored as `saltHex:derivedHex`.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
}

/**
 * Constant-time verify against a `salt:hash` string from {@link hashPassword}.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const derived = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}
