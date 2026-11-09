import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import type { DataSource } from 'typeorm';
import { DATABASE_SOURCE } from '../../infrastructure/database/database.module.js';
import { AuditService } from '../audit/audit.service.js';
import { AUTH_CONFIG, readAuthConfig } from './auth.config.js';
import type { AuthConfig } from './auth.config.js';
import { StaffGuard } from './auth.guard.js';
import { IdentityController } from './identity.controller.js';
import { IdentityService } from './identity.service.js';
import { PasswordService } from './password.service.js';

@Module({})
export class IdentityModule {
  static forRoot(databaseModule: DynamicModule, env: NodeJS.ProcessEnv): DynamicModule {
    return {
      module: IdentityModule,
      imports: [databaseModule],
      controllers: [IdentityController],
      exports: [IdentityService, AUTH_CONFIG],
      providers: [
        { provide: AUTH_CONFIG, useValue: readAuthConfig(env) },
        { provide: PasswordService, useFactory: () => new PasswordService() },
        { provide: AuditService, useFactory: () => new AuditService() },
        {
          provide: IdentityService,
          useFactory: (source: DataSource, passwords: PasswordService, audit: AuditService) =>
            new IdentityService(source, passwords, audit),
          inject: [DATABASE_SOURCE, PasswordService, AuditService],
        },
        {
          provide: APP_GUARD,
          useFactory: (reflector: Reflector, identity: IdentityService, config: AuthConfig) =>
            new StaffGuard(reflector, identity, config),
          inject: [Reflector, IdentityService, AUTH_CONFIG],
        },
      ],
    };
  }
}
