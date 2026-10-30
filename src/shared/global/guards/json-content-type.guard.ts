import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { ErrorCodeEnum } from '../enums';
import { DomainException } from '../errors';

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH']);

/**
 * A body sent with another content type is never parsed, so without this the
 * client would get "field is required" for fields it did send.
 */
@Injectable()
export class JsonContentTypeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const hasBody =
      Number(request.headers['content-length'] ?? 0) > 0 ||
      request.headers['transfer-encoding'] !== undefined;

    if (
      METHODS_WITH_BODY.has(request.method) &&
      hasBody &&
      !request.is('application/json')
    ) {
      throw new DomainException(ErrorCodeEnum.UNSUPPORTED_MEDIA_TYPE, {
        received: request.headers['content-type'] ?? null,
      });
    }
    return true;
  }
}
