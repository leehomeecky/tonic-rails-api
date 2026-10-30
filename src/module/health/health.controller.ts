import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { RedisService } from '../../shared/config/cache/redis.service';

@ApiTags('Health')
@SkipThrottle()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly indicators: HealthIndicatorService,
    private readonly redis: RedisService,
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness: the process is up' })
  live() {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  /** Readiness fails only on Postgres. Redis being down is reported as degraded, not down. */
  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness: database reachable (Redis optional)' })
  ready() {
    return this.health.check([
      () => this.db.pingCheck('database', { timeout: 2000 }),
      async () => {
        const connected = await this.redis.ping();
        return this.indicators.check('redis').up({
          enabled: this.redis.isEnabled,
          connected,
          mode: connected || !this.redis.isEnabled ? 'ok' : 'degraded',
        });
      },
    ]);
  }
}
