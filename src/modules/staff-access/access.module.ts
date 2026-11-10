import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATABASE_SOURCE } from '../../infrastructure/database/database.module.js';
import { StaffAccessController } from './access.controller.js';
import { StaffAccessService } from './access.service.js';
@Module({})
export class StaffAccessModule {
  static forRoot(databaseModule: DynamicModule): DynamicModule {
    return {
      module: StaffAccessModule,
      imports: [databaseModule],
      controllers: [StaffAccessController],
      providers: [
        {
          provide: StaffAccessService,
          useFactory: (db: DataSource) => new StaffAccessService(db),
          inject: [DATABASE_SOURCE],
        },
      ],
    };
  }
}
