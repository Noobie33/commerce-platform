import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATABASE_SOURCE } from '../../infrastructure/database/database.module.js';
import { AuditService } from '../audit/audit.service.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';

@Module({})
export class CatalogModule {
  static forRoot(databaseModule: DynamicModule): DynamicModule {
    return {
      module: CatalogModule,
      imports: [databaseModule],
      controllers: [CatalogController],
      providers: [
        {
          provide: CatalogService,
          useFactory: (source: DataSource) => new CatalogService(source, new AuditService()),
          inject: [DATABASE_SOURCE],
        },
      ],
    };
  }
}
