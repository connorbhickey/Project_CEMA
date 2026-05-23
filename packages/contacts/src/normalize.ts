import { parsePhoneNumberFromString } from 'libphonenumber-js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lower = raw.trim().toLowerCase();
  if (!EMAIL_RE.test(lower)) return null;
  const [local, domain] = lower.split('@');
  if (!local || !domain) return null;
  const baseLocal = local.split('+')[0] ?? local;
  return `${baseLocal}@${domain}`;
}

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = parsePhoneNumberFromString(trimmed, 'US');
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

export function normalizeSlackUser(teamId: string, userId: string): string {
  return `${teamId.toLowerCase()}:${userId.toLowerCase()}`;
}
