import { randomInt } from 'node:crypto';
import { TRANSACTION_REFERENCE_PREFIX } from '../global/constants';

// Crockford base32: no I, L, O, U, so references survive being read aloud.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Human-friendly reference, e.g. TR-20261029-7F3K9QAB. */
export function generateReference(now: Date = new Date()): string {
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  let suffix = '';
  for (let i = 0; i < 8; i++) suffix += ALPHABET[randomInt(ALPHABET.length)];
  return `${TRANSACTION_REFERENCE_PREFIX}-${date}-${suffix}`;
}
