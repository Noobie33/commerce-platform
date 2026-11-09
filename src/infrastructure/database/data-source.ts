import { CustomerFoundation1794108000000 } from '../../database/migrations/1794108000000-customer-foundation.js';
import { SupplierPayments1794107000000 } from '../../database/migrations/1794107000000-supplier-payments.js';
import { SupplierInvoices1794106000000 } from '../../database/migrations/1794106000000-supplier-invoices.js';
import { PurchaseReceipts1794105000000 } from '../../database/migrations/1794105000000-purchase-receipts.js';
import { PurchasingFoundation1794104000000 } from '../../database/migrations/1794104000000-purchasing-foundation.js';
import { InventoryFoundation1794103000000 } from '../../database/migrations/1794103000000-inventory-foundation.js';
import { OriginalMedia1794102000000 } from '../../database/migrations/1794102000000-original-media.js';
import { ProductMedia1794101000000 } from '../../database/migrations/1794101000000-product-media.js';
import { CatalogFoundation1794100000000 } from '../../database/migrations/1794100000000-catalog-foundation.js';
import { IdentityFoundation1794096000000 } from '../../database/migrations/1794096000000-identity-foundation.js';
import 'reflect-metadata';
import { DataSource } from 'typeorm';

export function databaseUrl(
  env: NodeJS.ProcessEnv,
  key: 'DATABASE_URL' | 'MIGRATION_DATABASE_URL',
): string {
  const value = env[key];
  if (!value) throw new Error(key + ' is required');
  try {
    const url = new URL(value);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      !url.password ||
      !url.pathname ||
      url.pathname === '/'
    )
      throw new Error();
    // Remote TLS policy will be added before remote deployments are enabled.
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error();
    return value;
  } catch {
    throw new Error(key + ' must be a local PostgreSQL URL with user, password and database');
  }
}

export function createDataSource(env: NodeJS.ProcessEnv = process.env) {
  return new DataSource({
    type: 'postgres',
    url: databaseUrl(env, 'MIGRATION_DATABASE_URL'),
    synchronize: false,
    migrationsRun: false,
    logging: false,
    entities: [],
    migrations: [
      IdentityFoundation1794096000000,
      CatalogFoundation1794100000000,
      ProductMedia1794101000000,
      OriginalMedia1794102000000,
      InventoryFoundation1794103000000,
      PurchasingFoundation1794104000000,
      PurchaseReceipts1794105000000,
      SupplierInvoices1794106000000,
      SupplierPayments1794107000000,
      CustomerFoundation1794108000000,
    ],
    migrationsTableName: 'schema_migrations',
    migrationsTransactionMode: 'all',
    connectTimeoutMS: 5000,
  });
}

export function createRuntimeDataSource(env: NodeJS.ProcessEnv = process.env) {
  return new DataSource({
    type: 'postgres',
    url: databaseUrl(env, 'DATABASE_URL'),
    synchronize: false,
    migrationsRun: false,
    logging: false,
    entities: [],
    migrations: [],
    connectTimeoutMS: 5000,
    extra: { max: 10, query_timeout: 2000, statement_timeout: 2000 },
  });
}
