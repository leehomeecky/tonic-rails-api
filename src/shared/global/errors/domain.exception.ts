import { HttpException } from '@nestjs/common';
import { ErrorCodeEnum } from '../enums';
import { ErrorMessage, ErrorStatus } from './message.error';

export type ErrorDetails = Record<string, unknown>;

export interface DomainErrorPayload {
  statusCode: number;
  code: ErrorCodeEnum;
  message: string;
  details?: ErrorDetails;
}

/**
 * Business error with a stable machine-readable code. The HTTP status and
 * default message come from the catalogue in message.error.ts.
 */
export class DomainException extends HttpException {
  /** Set when this error is a stored outcome replayed for an idempotent retry. */
  public replayed = false;

  constructor(
    public readonly code: ErrorCodeEnum,
    public readonly details?: ErrorDetails,
    message: string = ErrorMessage[code],
  ) {
    super(message, ErrorStatus[code]);
  }

  toPayload(): DomainErrorPayload {
    return {
      statusCode: this.getStatus(),
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }

  static fromPayload(payload: DomainErrorPayload): DomainException {
    const exception = new DomainException(
      payload.code,
      payload.details,
      payload.message,
    );
    exception.replayed = true;
    return exception;
  }
}
