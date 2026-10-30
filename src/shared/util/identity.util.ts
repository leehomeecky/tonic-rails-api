import { CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js';
import { DEFAULT_PHONE_REGION } from '../global/constants';

/** Normalises to E.164 so "0803 123 4567" and "+2348031234567" are the same wallet. */
export function normalizePhone(
  input: string,
  defaultRegion: CountryCode = DEFAULT_PHONE_REGION,
): string | null {
  const parsed = parsePhoneNumberFromString(input.trim(), defaultRegion);
  return parsed?.isValid() ? parsed.number : null;
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  return `${local[0]}${'*'.repeat(Math.max(local.length - 1, 2))}@${domain}`;
}

export function maskPhone(phone: string): string {
  if (phone.length <= 8) return '***';
  return `${phone.slice(0, 4)}${'*'.repeat(phone.length - 8)}${phone.slice(-4)}`;
}
