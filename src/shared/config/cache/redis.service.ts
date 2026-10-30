import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig } from '../env/app-config';

/**
 * Thin ioredis wrapper. Redis is an optimisation here, never a correctness
 * dependency: when it is disabled or unreachable every call degrades to a
 * cache miss / lock-not-acquired instead of throwing.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;

  constructor(private readonly config: AppConfig) {}

  onModuleInit(): void {
    const { enabled, host, port, password } = this.config.redis;
    if (!enabled) return;

    this.client = new Redis({
      host,
      port,
      password,
      lazyConnect: false,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });
    this.client.on('error', (error: Error) =>
      this.logger.warn(`Redis unavailable: ${error.message}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }

  get isEnabled(): boolean {
    return this.client !== null;
  }

  get isConnected(): boolean {
    return this.client?.status === 'ready';
  }

  async ping(): Promise<boolean> {
    if (!this.isConnected) return false;
    try {
      return (await this.client!.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    if (!this.isConnected) return null;
    try {
      const raw = await this.client!.get(key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch (error) {
      this.logger.warn(`Redis GET ${key} failed: ${String(error)}`);
      return null;
    }
  }

  async setJson(
    key: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<void> {
    if (!this.isConnected) return;
    try {
      await this.client!.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(`Redis SET ${key} failed: ${String(error)}`);
    }
  }

  /** SET NX PX: true when this caller now holds the lock. */
  async acquireLock(key: string, ttlMs: number): Promise<boolean> {
    if (!this.isConnected) return false;
    try {
      return (await this.client!.set(key, '1', 'PX', ttlMs, 'NX')) === 'OK';
    } catch {
      return false;
    }
  }

  async releaseLock(key: string): Promise<void> {
    if (!this.isConnected) return;
    await this.client!.del(key).catch(() => undefined);
  }
}
