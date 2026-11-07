import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATABASE_SOURCE } from '../../infrastructure/database/database.module.js';
import { OrganizationController } from './organization.controller.js';
import { OrganizationService } from './organization.service.js';

@Module({})
export class OrganizationModule {
  static forRoot(databaseModule: DynamicModule): DynamicModule {
    return {
      module: OrganizationModule,
      imports: [databaseModule],
      controllers: [OrganizationController],
      providers: [
        {
          provide: OrganizationService,
          useFactory: (source: DataSource) => new OrganizationService(source),
          inject: [DATABASE_SOURCE],
        },
      ],
    };
  }
}
