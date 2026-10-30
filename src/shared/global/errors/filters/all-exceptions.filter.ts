import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { IDEMPOTENT_REPLAYED_HEADER } from '../../constants';
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

/**
 * Single place that turns any error into the API error shape:
 * { statusCode, code, message, details?, path, requestId, timestamp }.
 * Unexpected errors are logged with their stack and returned as INTERNAL_ERROR.
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

    response.status(body.statusCode).json({
      ...body,
      path: request.url,
      requestId: request.id,
      timestamp: new Date().toISOString(),
    });
  }

  private toBody(exception: unknown): ErrorBody {
    if (exception instanceof DomainException) return exception.toPayload();

    if (exception instanceof ZodValidationException) {
      const issues = (exception.getZodError() as ZodError).issues.map(
        (issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        }),
      );
      return this.catalogue(ErrorCodeEnum.VALIDATION_FAILED, { issues });
    }

    if (isPgError(exception, PgErrorCode.CHECK_VIOLATION)) {
      // Only reachable if application guards regress; the DB still refuses the overdraft.
      return this.catalogue(ErrorCodeEnum.INSUFFICIENT_FUNDS);
    }
    if (isPgError(exception, PgErrorCode.UNIQUE_VIOLATION)) {
      return this.catalogue(ErrorCodeEnum.CONFLICT);
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
        message: statusCode >= 500 ? ErrorMessage[code] : exception.message,
      };
    }

    // body-parser errors (too large, malformed JSON) are plain errors with a 4xx status.
    const status = (exception as { status?: unknown } | null)?.status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      const code = HTTP_STATUS_TO_CODE[status] ?? ErrorCodeEnum.BAD_REQUEST;
      return { statusCode: status, code, message: ErrorMessage[code] };
    }

    return this.catalogue(ErrorCodeEnum.INTERNAL_ERROR);
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
