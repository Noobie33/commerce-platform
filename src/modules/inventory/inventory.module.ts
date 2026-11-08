import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATABASE_SOURCE } from '../../infrastructure/database/database.module.js';
import { InventoryService } from './inventory.service.js';
import { InventoryController } from './inventory.controller.js';
@Module({})
export class InventoryModule {
  static forRoot(databaseModule: DynamicModule): DynamicModule {
    return {
      module: InventoryModule,
      imports: [databaseModule],
      controllers: [InventoryController],
      providers: [
        {
          provide: InventoryService,
          useFactory: (source: DataSource) => new InventoryService(source),
          inject: [DATABASE_SOURCE],
        },
      ],
    };
  }
}
