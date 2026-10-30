import { Module } from '@nestjs/common';
import { FxProviderModule } from '../../shared/config/fx/fx-provider.module';
import { FxRateSnapshotRepository } from '../../shared/global/model/repositories';
import { FxController } from './fx.controller';
import { FxRefreshJob } from './fx-refresh.job';
import { FxService } from './fx.service';

@Module({
  imports: [FxProviderModule],
  controllers: [FxController],
  providers: [FxService, FxRefreshJob, FxRateSnapshotRepository],
  exports: [FxService],
})
export class FxModule {}
