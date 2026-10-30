import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EnvService } from './env.service';
import { AppConfig } from './app-config';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Tests inject their own environment; a developer's .env must not leak in.
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validationSchema: EnvService.validationSchema(),
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
  ],
  providers: [EnvService, AppConfig],
  exports: [AppConfig],
})
export class EnvModule {}
