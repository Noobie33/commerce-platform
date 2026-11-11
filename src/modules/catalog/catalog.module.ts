import { StoreSavedController } from './store-saved.controller.js';
import { StoreRelatedController } from './store-related.controller.js';
import { StoreNavigationController } from './store-navigation.controller.js';
import { GalleryPublicController } from './gallery-public.controller.js';
import { GalleryReviewController } from './gallery-release.controller.js';
import { GalleryReleaseService } from './gallery-release.service.js';
import { GalleryController } from './gallery.controller.js';
import { GalleryService } from './gallery.service.js';
import { CatalogVideoController } from './video.controller.js';
import { CatalogVideoService } from './video.service.js';
import { StoreBrowseController } from './store-browse.controller.js';
import { StoreBrowseService } from './store-browse.service.js';
import { PublicationController, StoreProductController } from './publication.controller.js';
import { PublicationService } from './publication.service.js';
import { TaxonomyService } from './presentation.service.js';
import { TaxonomyController } from './presentation.controller.js';
import { MerchController } from './merch.controller.js';
import { MerchService } from './merch.service.js';
import { ProductContentController } from './content.controller.js';
import { ProductContentService } from './content.service.js';
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
      controllers: [
        CatalogController,
        ProductMediaController,
        ProductContentController,
        MerchController,
        TaxonomyController,
        PublicationController,
        StoreProductController,
        StoreBrowseController,
        StoreRelatedController,
        StoreSavedController,
        StoreNavigationController,
        CatalogVideoController,
        GalleryController,
        GalleryReviewController,
        GalleryPublicController,
      ],
      providers: [
        {
          provide: GalleryReleaseService,
          useFactory: (source: DataSource) =>
            new GalleryReleaseService(source, env, new LocalMediaStore(env)),
          inject: [DATABASE_SOURCE],
        },
        {
          provide: GalleryService,
          useFactory: (source: DataSource, release: GalleryReleaseService) =>
            new GalleryService(source, release),
          inject: [DATABASE_SOURCE, GalleryReleaseService],
        },
        {
          provide: CatalogVideoService,
          useFactory: (source: DataSource) => new CatalogVideoService(source, env),
          inject: [DATABASE_SOURCE],
        },
        {
          provide: StoreBrowseService,
          useFactory: (source: DataSource) => new StoreBrowseService(source),
          inject: [DATABASE_SOURCE],
        },
        {
          provide: PublicationService,
          useFactory: (source: DataSource, release: GalleryReleaseService) =>
            new PublicationService(source, new LocalMediaStore(env), release),
          inject: [DATABASE_SOURCE, GalleryReleaseService],
        },
        {
          provide: TaxonomyService,
          useFactory: (source: DataSource) => new TaxonomyService(source),
          inject: [DATABASE_SOURCE],
        },
        {
          provide: MerchService,
          useFactory: (source: DataSource) => new MerchService(source),
          inject: [DATABASE_SOURCE],
        },
        {
          provide: ProductContentService,
          useFactory: (source: DataSource) => new ProductContentService(source),
          inject: [DATABASE_SOURCE],
        },
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
