import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { createRuntimeDataSource } from './data-source.js';
import { DatabaseService } from './database.service.js';
import type { DatabaseDriver } from './database.service.js';

export const DATABASE_SOURCE = Symbol('DATABASE_SOURCE');

@Module({})
export class DatabaseModule {
  static forRoot(env: NodeJS.ProcessEnv, driver?: DatabaseDriver): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        { provide: DATABASE_SOURCE, useFactory: () => driver ?? createRuntimeDataSource(env) },
        {
          provide: DatabaseService,
          useFactory: (source: DatabaseDriver) => new DatabaseService(source),
          inject: [DATABASE_SOURCE],
        },
      ],
      exports: [DatabaseService, DATABASE_SOURCE],
    };
  }
}
