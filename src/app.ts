import { CatalogModule } from './modules/catalog/catalog.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { ADMIN_ASSET_ROOT } from './modules/admin/admin.controller.js';
import { SafeExceptionFilter } from './infrastructure/security/safe-exception.filter.js';
import { OrganizationModule } from './modules/organization/organization.module.js';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import type { DatabaseDriver } from './infrastructure/database/database.service.js';
import { HealthController } from './modules/health/health.controller.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import type { StaffRequest, StaffResponse } from './modules/identity/http.types.js';

export async function createApp(env: NodeJS.ProcessEnv = process.env, driver?: DatabaseDriver) {
  const databaseModule = DatabaseModule.forRoot(env, driver);
  @Module({
    imports: [
      CatalogModule.forRoot(databaseModule, env),
      AdminModule,
      databaseModule,
      IdentityModule.forRoot(databaseModule, env),
      OrganizationModule.forRoot(databaseModule),
    ],
    controllers: [HealthController],
  })
  class AppModule {}

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    abortOnError: false,
    bodyParser: false,
  });

  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use((req: StaffRequest, res: StaffResponse, next: () => void) => {
    req.requestId = randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.useStaticAssets(ADMIN_ASSET_ROOT, {
    prefix: '/admin/assets/',
    index: false,
    dotfiles: 'deny',
    fallthrough: false,
  });
  app.useBodyParser('json', { limit: '16kb' });
  app.useGlobalFilters(new SafeExceptionFilter());
  app.enableShutdownHooks();
  return app;
}
