import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { setupApp, setupSwagger } from './bootstrap/setup-app';
import { AppConfig } from './shared/config/env/app-config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  setupApp(app);
  setupSwagger(app);

  const config = app.get(AppConfig);
  await app.listen(config.port, '0.0.0.0');
  app.get(Logger).log(`Tonic Rails API listening on port ${config.port}`);
}

void bootstrap();
