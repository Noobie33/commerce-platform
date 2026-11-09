import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { Client } from 'pg';
import { databaseUrl } from '../../infrastructure/database/data-source.js';
import { IdentityService } from '../identity/identity.service.js';
import { LiveUpdatesController } from './live-updates.controller.js';
import { LiveUpdatesService } from './live-updates.service.js';
@Module({})
export class LiveUpdatesModule {
  static forRoot(identity: DynamicModule, env: NodeJS.ProcessEnv, enabled = true): DynamicModule {
    return {
      module: LiveUpdatesModule,
      imports: [identity],
      controllers: [LiveUpdatesController],
      providers: [
        {
          provide: LiveUpdatesService,
          useFactory: (auth: IdentityService) =>
            new LiveUpdatesService(
              auth,
              enabled
                ? () =>
                    new Client({
                      connectionString: databaseUrl(env, 'DATABASE_URL'),
                      connectionTimeoutMillis: 5000,
                      query_timeout: 3000,
                      application_name: 'commerce_staff_notifications',
                    })
                : null,
            ),
          inject: [IdentityService],
        },
      ],
    };
  }
}
