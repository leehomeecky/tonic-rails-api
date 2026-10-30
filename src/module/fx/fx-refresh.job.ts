import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AppConfig } from '../../shared/config/env/app-config';
import { RedisService } from '../../shared/config/cache/redis.service';
import {
  FX_REFRESH_JOB_NAME,
  FX_REFRESH_LOCK_KEY,
} from '../../shared/global/constants';
import { FxService } from './fx.service';

/**
 * Refreshes rates in the background so user requests normally hit the cache.
 * A Redis lock (held for ~one interval) makes a single replica do the work.
 */
@Injectable()
export class FxRefreshJob
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(FxRefreshJob.name);

  constructor(
    private readonly fx: FxService,
    private readonly redis: RedisService,
    private readonly scheduler: SchedulerRegistry,
    private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    const { refreshEnabled, refreshIntervalSeconds } = this.config.fx;
    if (!refreshEnabled) return;

    const interval = setInterval(
      () => void this.run(),
      refreshIntervalSeconds * 1000,
    );
    this.scheduler.addInterval(FX_REFRESH_JOB_NAME, interval);
  }

  onApplicationShutdown(): void {
    if (this.scheduler.doesExist('interval', FX_REFRESH_JOB_NAME)) {
      this.scheduler.deleteInterval(FX_REFRESH_JOB_NAME);
    }
  }

  async run(): Promise<void> {
    const lockTtlMs = this.config.fx.refreshIntervalSeconds * 900;
    if (
      this.redis.isConnected &&
      !(await this.redis.acquireLock(FX_REFRESH_LOCK_KEY, lockTtlMs))
    ) {
      return;
    }
    try {
      const snapshot = await this.fx.refresh();
      this.logger.log(`FX rates refreshed from ${snapshot.provider}`);
    } catch (error) {
      this.logger.warn(
        `FX refresh failed; serving cached/fallback rates: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
