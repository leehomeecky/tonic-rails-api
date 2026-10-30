/**
 * Writes docs/openapi.json from the live route and schema metadata.
 * Nest runs in preview mode: modules are scanned but no provider is
 * instantiated, so no database or Redis is needed.
 */
import './openapi-env';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import {
  buildOpenApiDocument,
  configureRouting,
} from '../src/bootstrap/setup-app';

async function main(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    preview: true,
    logger: false,
  });
  configureRouting(app);

  const document = buildOpenApiDocument(app);
  const target = resolve(__dirname, '..', 'docs', 'openapi.json');
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();

  console.log(
    `OpenAPI spec written to ${target} (${Object.keys(document.paths).length} paths)`,
  );
}

void main();
