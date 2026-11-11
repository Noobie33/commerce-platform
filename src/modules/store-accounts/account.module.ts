import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATABASE_SOURCE } from '../../infrastructure/database/database.module.js';
import { PasswordService } from '../identity/password.service.js';
import { StoreAccountService } from './account.service.js';
import { StoreAccountController } from './account.controller.js';
import { StoreAccountBoundaryGuard } from './account.guard.js';
import { accountMode } from './account.config.js';
@Module({})
export class StoreAccountModule {
  static forRoot(databaseModule: DynamicModule, env: NodeJS.ProcessEnv): DynamicModule {
    return {
      module: StoreAccountModule,
      imports: [databaseModule],
      controllers: [StoreAccountController],
      providers: [
        { provide: StoreAccountBoundaryGuard, useFactory: () => new StoreAccountBoundaryGuard() },
        {
          provide: StoreAccountService,
          useFactory: (db: DataSource) =>
            new StoreAccountService(db, new PasswordService(), accountMode(env)),
          inject: [DATABASE_SOURCE],
        },
      ],
    };
  }
}
