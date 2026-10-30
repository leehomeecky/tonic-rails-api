import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { IDEMPOTENT_REPLAYED_HEADER, REQUEST_ID_HEADER } from '../../constants';
import { ErrorCodeEnum } from '../../enums';
import { DomainException, ErrorDetails } from '../domain.exception';
import { ErrorMessage, ErrorStatus } from '../message.error';
import { PgErrorCode, isPgError } from '../../../util/pg-error.util';

interface ErrorBody {
  statusCode: number;
  code: ErrorCodeEnum;
  message: string;
  details?: ErrorDetails;
}

const HTTP_STATUS_TO_CODE: Partial<Record<number, ErrorCodeEnum>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCodeEnum.BAD_REQUEST,
  [HttpStatus.NOT_FOUND]: ErrorCodeEnum.ROUTE_NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCodeEnum.CONFLICT,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCodeEnum.PAYLOAD_TOO_LARGE,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCodeEnum.RATE_LIMITED,
};

/** Codes whose framework message is useful to the client (e.g. "Cannot DELETE /api/v1/wallets"). */
const KEEP_FRAMEWORK_MESSAGE = new Set<ErrorCodeEnum>([
  ErrorCodeEnum.ROUTE_NOT_FOUND,
  ErrorCodeEnum.BAD_REQUEST,
]);

/** Errors meaning Postgres is unreachable or refusing connections: retryable, not a bug. */
const DB_UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  '57P01', // admin_shutdown
  '57P03', // cannot_connect_now
  '53300', // too_many_connections
]);

/**
 * Single place that turns any error into the API error shape:
 * { statusCode, code, message, details?, path, requestId, timestamp }.
 * 500s never carry internal details to the client; they are logged instead.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request & { id?: string }>();
    const response = ctx.getResponse<Response>();

    // Health probes keep terminus' own report (which component is down).
    if (
      exception instanceof HttpException &&
      request.url.startsWith('/health')
    ) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    const body = this.toBody(exception);
    if (body.statusCode >= 500) {
      this.logger.error(
        { err: exception, path: request.url },
        exception instanceof Error ? exception.message : 'Unhandled error',
      );
    }
    if (exception instanceof DomainException && exception.replayed) {
      response.setHeader(IDEMPOTENT_REPLAYED_HEADER, 'true');
    }

    // Body-parse failures happen before the logger assigns request.id; fall back to the client's id.
    const clientRequestId = request.headers[REQUEST_ID_HEADER];
    response.status(body.statusCode).json({
      ...body,
      path: request.url,
      requestId:
        request.id ??
        (typeof clientRequestId === 'string' ? clientRequestId : undefined),
      timestamp: new Date().toISOString(),
    });
  }

  private toBody(exception: unknown): ErrorBody {
    if (exception instanceof DomainException) {
      const payload = exception.toPayload();
      // An internal invariant must not leak its reason; it is logged above.
      return exception.getStatus() >= 500
        ? this.catalogue(ErrorCodeEnum.INTERNAL_ERROR)
        : payload;
    }

    if (exception instanceof ZodValidationException) {
      return this.validationBody(exception.getZodError() as ZodError);
    }

    if (isPgError(exception, PgErrorCode.CHECK_VIOLATION)) {
      // Only reachable if application guards regress; the DB still refuses the overdraft.
      return this.catalogue(ErrorCodeEnum.INSUFFICIENT_FUNDS);
    }
    if (isPgError(exception, PgErrorCode.UNIQUE_VIOLATION)) {
      return this.catalogue(ErrorCodeEnum.CONFLICT);
    }
    if (this.isDatabaseUnavailable(exception)) {
      return this.catalogue(ErrorCodeEnum.SERVICE_UNAVAILABLE);
    }

    // Nest maps body-parser SyntaxErrors to BadRequestException(err.message);
    // V8's JSON parse messages always mention JSON.
    if (
      exception instanceof BadRequestException &&
      exception.message.includes('JSON')
    ) {
      return this.catalogue(ErrorCodeEnum.INVALID_JSON, {
        reason: exception.message,
      });
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const code =
        HTTP_STATUS_TO_CODE[statusCode] ??
        (statusCode >= 500
          ? ErrorCodeEnum.INTERNAL_ERROR
          : ErrorCodeEnum.BAD_REQUEST);
      return {
        statusCode,
        code,
        message: KEEP_FRAMEWORK_MESSAGE.has(code)
          ? exception.message
          : ErrorMessage[code],
      };
    }

    // body-parser errors that bypass Nest's mapping (e.g. payload too large) carry a 4xx status.
    const status = (exception as { status?: unknown } | null)?.status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      const code = HTTP_STATUS_TO_CODE[status] ?? ErrorCodeEnum.BAD_REQUEST;
      return { statusCode: status, code, message: ErrorMessage[code] };
    }

    return this.catalogue(ErrorCodeEnum.INTERNAL_ERROR);
  }

  /** The message names every problem ("amount: is required; currency: …"), details lists them. */
  private validationBody(error: ZodError): ErrorBody {
    const issues = error.issues.map((issue) => ({
      path: issue.path.length ? issue.path.join('.') : 'body',
      message: issue.message,
    }));
    return {
      statusCode: ErrorStatus[ErrorCodeEnum.VALIDATION_FAILED],
      code: ErrorCodeEnum.VALIDATION_FAILED,
      message: `Validation failed: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`,
      details: { issues },
    };
  }

  private isDatabaseUnavailable(exception: unknown): boolean {
    if (!(exception instanceof Error)) return false;
    const candidates = [
      exception,
      (exception as { driverError?: unknown }).driverError,
      exception.cause,
    ];
    return candidates.some((candidate) => {
      const code = (candidate as { code?: unknown } | undefined)?.code;
      return typeof code === 'string' && DB_UNAVAILABLE_CODES.has(code);
    });
  }

  private catalogue(code: ErrorCodeEnum, details?: ErrorDetails): ErrorBody {
    return {
      statusCode: ErrorStatus[code],
      code,
      message: ErrorMessage[code],
      ...(details ? { details } : {}),
    };
  }
}
