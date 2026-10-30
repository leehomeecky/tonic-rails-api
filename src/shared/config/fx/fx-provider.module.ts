import { Module } from '@nestjs/common';
import {
  FALLBACK_FX_PROVIDER,
  PRIMARY_FX_PROVIDER,
} from '../../global/constants';
import { FxProviderService } from './fx-provider.service';

@Module({
  providers: FxProviderService.providers(),
  exports: [PRIMARY_FX_PROVIDER, FALLBACK_FX_PROVIDER],
})
export class FxProviderModule {}
