import { ErrorCodeEnum } from '../global/enums';
import { DomainException } from '../global/errors';

export interface KeysetCursor {
  createdAt: Date;
  id: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Opaque base64url cursor over (created_at, id); created_at has millisecond precision. */
export function encodeCursor({ createdAt, id }: KeysetCursor): string {
  return Buffer.from(
    JSON.stringify({ t: createdAt.toISOString(), id }),
  ).toString('base64url');
}

export function decodeCursor(cursor: string): KeysetCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as { t?: unknown; id?: unknown };
    const createdAt = new Date(String(parsed.t));
    if (
      typeof parsed.id !== 'string' ||
      !UUID_PATTERN.test(parsed.id) ||
      Number.isNaN(createdAt.getTime())
    ) {
      throw new Error('malformed');
    }
    return { createdAt, id: parsed.id };
  } catch {
    throw new DomainException(ErrorCodeEnum.INVALID_CURSOR);
  }
}
