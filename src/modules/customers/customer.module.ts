import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATABASE_SOURCE } from '../../infrastructure/database/database.module.js';
import { CustomerService } from './customer.service.js';
import { CustomerController } from './customer.controller.js';
@Module({})
export class CustomerModule {
  static forRoot(databaseModule: DynamicModule): DynamicModule {
    return {
      module: CustomerModule,
      imports: [databaseModule],
      controllers: [CustomerController],
      providers: [
        {
          provide: CustomerService,
          useFactory: (source: DataSource) => new CustomerService(source),
          inject: [DATABASE_SOURCE],
        },
      ],
    };
  }
}
