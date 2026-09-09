import crypto from 'crypto';
import { config } from '../config/env';

/**
 * One-time codes, shared by every feature that needs one.
 *
 * The rules are the same wherever a code is used, so they live in one place:
 * generate from a real CSPRNG, store only a keyed hash, and compare in
 * constant time. Two copies of this would eventually disagree, and the copy
 * that drifted would be the one nobody noticed.
 */

/** A numeric code of `length` digits, leading zeros preserved. */
export const generateOtp = (length = 6): string => {
  const max = 10 ** length;
  return String(crypto.randomInt(0, max)).padStart(length, '0');
};

/**
 * Salted with something identifying (an order id, a user id) so a hash lifted
 * from one row cannot be replayed against another, and keyed with the server
 * secret so a database dump alone cannot be brute-forced offline — a 6-digit
 * space is trivially small without the key.
 */
export const hashOtp = (salt: string, code: string): string =>
  crypto.createHmac('sha256', config.jwt.secret).update(`${salt}:${code}`).digest('hex');

/** Constant-time comparison — a timing side channel would leak the code digit by digit. */
export const otpMatches = (salt: string, code: string, stored: string): boolean => {
  const candidate = Buffer.from(hashOtp(salt, code), 'utf8');
  const expected = Buffer.from(stored, 'utf8');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
};
