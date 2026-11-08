import { PayablesReportService } from './report.service.js';
import { PayablesReportController } from './report.controller.js';
import { SupplierPaymentService } from './payment.service.js';
import { SupplierPaymentController } from './payment.controller.js';
import { SupplierInvoiceService } from './invoice.service.js';
import { SupplierInvoiceController } from './invoice.controller.js';
import { PurchaseReceiptService } from './receipt.service.js';
import { PurchaseReceiptController } from './receipt.controller.js';
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATABASE_SOURCE } from '../../infrastructure/database/database.module.js';
import { PurchasingStore } from './purchasing.store.js';
import { SupplierService } from './supplier.service.js';
import { PurchaseOrderService } from './purchase-order.service.js';
import { PurchasingController } from './purchasing.controller.js';
@Module({})
export class PurchasingModule {
  static forRoot(databaseModule: DynamicModule): DynamicModule {
    return {
      module: PurchasingModule,
      imports: [databaseModule],
      controllers: [
        PurchasingController,
        PurchaseReceiptController,
        SupplierInvoiceController,
        SupplierPaymentController,
        PayablesReportController,
      ],
      providers: [
        {
          provide: PayablesReportService,
          useFactory: (source: DataSource) => new PayablesReportService(source),
          inject: [DATABASE_SOURCE],
        },
        {
          provide: SupplierPaymentService,
          useFactory: (source: DataSource) => new SupplierPaymentService(source),
          inject: [DATABASE_SOURCE],
        },
        {
          provide: SupplierInvoiceService,
          useFactory: (source: DataSource) => new SupplierInvoiceService(source),
          inject: [DATABASE_SOURCE],
        },
        {
          provide: PurchaseReceiptService,
          useFactory: (source: DataSource) => new PurchaseReceiptService(source),
          inject: [DATABASE_SOURCE],
        },
        {
          provide: PurchasingStore,
          useFactory: (source: DataSource) => new PurchasingStore(source),
          inject: [DATABASE_SOURCE],
        },
        {
          provide: SupplierService,
          useFactory: (store: PurchasingStore) => new SupplierService(store),
          inject: [PurchasingStore],
        },
        {
          provide: PurchaseOrderService,
          useFactory: (store: PurchasingStore) => new PurchaseOrderService(store),
          inject: [PurchasingStore],
        },
      ],
    };
  }
}
