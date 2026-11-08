import { readMediaPolicy } from '../../infrastructure/media/media-policy.js';
import { ProductMediaController } from './media.controller.js';
import { ProductMediaService } from './media.service.js';
import { ImageProcessor } from '../../infrastructure/media/image-processor.js';
import { LocalMediaStore } from '../../infrastructure/media/local-media.store.js';
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATABASE_SOURCE } from '../../infrastructure/database/database.module.js';
import { AuditService } from '../audit/audit.service.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';

@Module({})
export class CatalogModule {
  static forRoot(
    databaseModule: DynamicModule,
    env: NodeJS.ProcessEnv = process.env,
  ): DynamicModule {
    return {
      module: CatalogModule,
      imports: [databaseModule],
      controllers: [CatalogController, ProductMediaController],
      providers: [
        {
          provide: ProductMediaService,
          useFactory: (source: DataSource) =>
            new ProductMediaService(
              source,
              new ImageProcessor(readMediaPolicy(env)),
              new LocalMediaStore(env),
            ),
          inject: [DATABASE_SOURCE],
        },
        {
          provide: CatalogService,
          useFactory: (source: DataSource) => new CatalogService(source, new AuditService()),
          inject: [DATABASE_SOURCE],
        },
      ],
    };
  }
}
