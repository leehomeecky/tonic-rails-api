import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';
import { IDEMPOTENCY_KEY_HEADER, IDEMPOTENCY_KEY_PATTERN } from '../constants';
import { ErrorCodeEnum } from '../enums';
import { DomainException } from '../errors';

/** Reads and validates the Idempotency-Key header (required on money-moving POSTs). */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const value = request.headers[IDEMPOTENCY_KEY_HEADER];
    const key = Array.isArray(value) ? value[0] : value;

    if (key === undefined || key.trim() === '') {
      throw new DomainException(ErrorCodeEnum.IDEMPOTENCY_KEY_REQUIRED);
    }
    if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
      throw new DomainException(ErrorCodeEnum.IDEMPOTENCY_KEY_INVALID);
    }
    return key;
  },
);
