import { Injectable, Provider } from '@nestjs/common';
import {
  FALLBACK_FX_PROVIDER,
  PRIMARY_FX_PROVIDER,
} from '../../global/constants';
import { FxProviderNameEnum } from '../../global/enums';
import { OpenErApiFxUtil } from '../../util/open-er-api.util';
import { StaticFxUtil } from '../../util/static-fx.util';
import { AppConfig } from '../env/app-config';

const fxProviders = {
  [FxProviderNameEnum.openErApi]: OpenErApiFxUtil,
  [FxProviderNameEnum.static]: StaticFxUtil,
};

/** Binds the provider tokens: primary comes from FX_PROVIDER, fallback is always static. */
@Injectable()
export class FxProviderService {
  static providers(): Provider[] {
    return [
      OpenErApiFxUtil,
      StaticFxUtil,
      {
        provide: PRIMARY_FX_PROVIDER,
        inject: [AppConfig, OpenErApiFxUtil, StaticFxUtil],
        useFactory: (
          config: AppConfig,
          ...instances: [OpenErApiFxUtil, StaticFxUtil]
        ) =>
          instances.find(
            (instance) => instance instanceof fxProviders[config.fx.provider],
          ),
      },
      { provide: FALLBACK_FX_PROVIDER, useExisting: StaticFxUtil },
    ];
  }
}
