import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATABASE_SOURCE } from '../../infrastructure/database/database.module.js';
import { SalesService } from './sales.service.js';
import { SalesController } from './sales.controller.js';
@Module({})
export class SalesModule {
  static forRoot(databaseModule: DynamicModule): DynamicModule {
    return {
      module: SalesModule,
      imports: [databaseModule],
      controllers: [SalesController],
      providers: [
        {
          provide: SalesService,
          useFactory: (db: DataSource) => new SalesService(db),
          inject: [DATABASE_SOURCE],
        },
      ],
    };
  }
}
