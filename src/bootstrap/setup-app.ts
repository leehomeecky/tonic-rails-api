import { RequestMethod, VersioningType } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppConfig } from '../shared/config/env/app-config';
import { REQUEST_BODY_LIMIT } from '../shared/global/constants';

export const API_PREFIX = 'api';

/** HTTP-level setup shared by main.ts, the e2e tests and the OpenAPI generator. */
export function setupApp(app: NestExpressApplication): void {
  const config = app.get(AppConfig);

  app.use(helmet());
  app.enableCors({
    origin: config.allowedOrigins,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['Idempotent-Replayed', 'X-Request-Id'],
  });
  app.useBodyParser('json', { limit: REQUEST_BODY_LIMIT });
  configureRouting(app);
  app.enableShutdownHooks();
}

/** /api/v1/... for the API; health probes stay at the root for orchestrators. */
export function configureRouting(app: NestExpressApplication): void {
  app.setGlobalPrefix(API_PREFIX, {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
}

export function buildOpenApiDocument(
  app: NestExpressApplication,
): OpenAPIObject {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Tonic Rails API')
      .setDescription(
        'Multi-currency stablecoin wallet sandbox: wallets, deposits, swaps, cross-border transfers and FX rates. ' +
          'Amounts are decimal strings with up to 6 decimal places. Money-moving POSTs require an Idempotency-Key header.',
      )
      .setVersion('1.0.0')
      .build(),
  );
  return cleanupOpenApiDoc(document);
}

export function setupSwagger(app: NestExpressApplication): void {
  SwaggerModule.setup('docs', app, buildOpenApiDocument(app), {
    jsonDocumentUrl: 'docs-json',
  });
}
