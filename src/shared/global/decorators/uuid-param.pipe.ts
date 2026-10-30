import { ParseUUIDPipe } from '@nestjs/common';
import { ErrorCodeEnum } from '../enums';
import { DomainException } from '../errors';

/** ParseUUIDPipe that fails with the API's own INVALID_ID error. */
export const UuidParamPipe = new ParseUUIDPipe({
  exceptionFactory: () => new DomainException(ErrorCodeEnum.INVALID_ID),
});
