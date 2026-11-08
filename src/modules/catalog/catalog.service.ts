import { ConflictException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import { decimal, invalid } from './catalog.validation.js';
import type {
  Category,
  CatalogQuery,
  Product,
  ProductInput,
  ProductPage,
} from './catalog.types.js';

type Sql = Pick<EntityManager, 'query'>;
interface StoredVariant {
  id: string;
  sku: string;
  optionsKey: string;
  attributes: Record<string, string>;
}
export class CatalogService {
  constructor(
    private readonly source: DataSource,
    private readonly audit: AuditService,
  ) {}

  private databaseError(error: unknown): never {
    const detail =
      error && typeof error === 'object' && 'driverError' in error ? error.driverError : error;
    if (detail && typeof detail === 'object' && 'code' in detail && detail.code === '23505') {
      const constraint = 'constraint' in detail ? String(detail.constraint) : '';
      const code = constraint.includes('style_code')
        ? 'STYLE_CODE_EXISTS'
        : constraint.includes('sku')
          ? 'SKU_EXISTS'
          : constraint.includes('barcode')
            ? 'BARCODE_EXISTS'
            : constraint.includes('options')
              ? 'VARIANT_OPTIONS_EXIST'
              : constraint.includes('name_key')
                ? 'CATEGORY_EXISTS'
                : 'CATALOG_CONFLICT';
      throw new ConflictException({ code, message: 'This catalog identifier is already in use' });
    }
    throw error;
  }

  categories(): Promise<Category[]> {
    return this.source.query(
      'SELECT id,name,parent_id AS "parentId" FROM catalog_categories WHERE is_active ORDER BY name,id',
    );
  }

  async createCategory(
    input: { name: string; nameKey: string; parentId: string | null },
    actor: string,
    requestId: string,
  ): Promise<Category> {
    try {
      return await this.source.transaction(async (manager) => {
        if (input.parentId) await this.checkCategory(manager, input.parentId);
        const rows: Category[] = await manager.query(
          'INSERT INTO catalog_categories(name,name_key,parent_id) VALUES ($1,$2,$3) RETURNING id,name,parent_id AS "parentId"',
          [input.name, input.nameKey, input.parentId],
        );
        const row = rows[0]!;
        await this.audit.catalog(manager, actor, 'catalog.category_created', requestId, {
          entityId: row.id,
          version: 1,
          variantCount: 0,
        });
        return row;
      });
    } catch (error) {
      this.databaseError(error);
    }
  }

  private async checkCategory(sql: Sql, id: string): Promise<void> {
    const rows: { id: string }[] = await sql.query(
      'SELECT id FROM catalog_categories WHERE id=$1 AND is_active',
      [id],
    );
    if (!rows.length) invalid('Choose an active category');
  }

  read(id: string): Promise<Product> {
    return this.source.transaction('REPEATABLE READ', (manager) => this.detail(id, manager));
  }

  async detail(id: string, sql: Sql = this.source): Promise<Product> {
    const rows: Omit<Product, 'variants'>[] = await sql.query(
      `
      SELECT p.id,p.style_code AS "styleCode",p.name,p.description,p.category_id AS "categoryId",
        c.name AS "categoryName",p.status,p.currency,p.version,p.created_at AS "createdAt",p.updated_at AS "updatedAt"
      FROM catalog_products p LEFT JOIN catalog_categories c ON c.id=p.category_id WHERE p.id=$1
    `,
      [id],
    );
    const row = rows[0];
    if (!row)
      throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });
    const variants: {
      id: string;
      sku: string;
      attributes: Record<string, string>;
      barcode: string | null;
      priceMinor: string;
      isActive: boolean;
    }[] = await sql.query(
      'SELECT id,sku,attributes,barcode,price_minor::text AS "priceMinor",is_active AS "isActive" FROM catalog_variants WHERE product_id=$1 ORDER BY sku',
      [id],
    );
    return {
      ...row,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      variants: variants.map(({ priceMinor, ...variant }) => ({
        ...variant,
        price: decimal(priceMinor),
      })),
    };
  }

  async list(query: CatalogQuery): Promise<ProductPage> {
    const escaped = query.search.replace(/[\\%_]/g, (match) => '\\' + match);
    const values = ['%' + escaped + '%', query.status, query.categoryId];
    const where = `($1='%%' OR p.name ILIKE $1 OR p.style_code ILIKE $1 OR EXISTS (
      SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND (v.sku ILIKE $1 OR v.barcode ILIKE $1)
    )) AND ($2='all' OR p.status=$2) AND ($3::uuid IS NULL OR p.category_id=$3)`;
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      const count: { total: number }[] = await manager.query(
        'SELECT count(*)::int AS total FROM catalog_products p WHERE ' + where,
        values,
      );
      const rows: (Omit<ProductPage['items'][number], 'fromPrice'> & { minimum: string | null })[] =
        await manager.query(
          `
        SELECT p.id,p.style_code AS "styleCode",p.name,p.category_id AS "categoryId",c.name AS "categoryName",
          p.status,p.currency,p.version,p.updated_at AS "updatedAt",v.total AS "variantCount",
          v.active AS "activeVariantCount",v.minimum
        FROM catalog_products p LEFT JOIN catalog_categories c ON c.id=p.category_id
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS total,count(*) FILTER (WHERE is_active)::int AS active,
            (min(price_minor) FILTER (WHERE is_active))::text AS minimum
          FROM catalog_variants WHERE product_id=p.id
        ) v ON true
        WHERE ${where} ORDER BY p.created_at DESC,p.id DESC LIMIT $4 OFFSET $5
      `,
          [...values, query.pageSize, (query.page - 1) * query.pageSize],
        );
      return {
        total: count[0]!.total,
        page: query.page,
        pageSize: query.pageSize,
        items: rows.map(({ minimum, ...row }) => ({
          ...row,
          updatedAt: new Date(row.updatedAt).toISOString(),
          fromPrice: minimum === null ? null : decimal(minimum),
        })),
      };
    });
  }

  async save(
    input: ProductInput,
    productId: string | null,
    actor: string,
    requestId: string,
    key: string,
  ): Promise<Product> {
    const hash = createHash('sha256').update(JSON.stringify({ productId, input })).digest('hex');
    try {
      return await this.source.transaction(async (manager) => {
        await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))', [key]);
        const requests: { actorId: string; hash: string; response: Product }[] =
          await manager.query(
            'SELECT actor_id AS "actorId",request_hash AS hash,response FROM catalog_requests WHERE key=$1',
            [key],
          );
        const previous = requests[0];
        if (previous) {
          if (previous.actorId !== actor || previous.hash !== hash)
            throw new ConflictException({
              code: 'IDEMPOTENCY_MISMATCH',
              message: 'This save key belongs to a different request',
            });
          return previous.response;
        }
        // Lock desired and existing identifiers in one deterministic order before any product row lock.
        const oldIdentifiers: { sku: string; barcode: string | null }[] = productId
          ? await manager.query('SELECT sku,barcode FROM catalog_variants WHERE product_id=$1', [
              productId,
            ])
          : [];
        const identifiers = [
          ...new Set(
            [...oldIdentifiers, ...input.variants].flatMap((row) => [
              'sku:' + row.sku,
              ...(row.barcode ? ['barcode:' + row.barcode] : []),
            ]),
          ),
        ].sort();
        for (const identifier of identifiers)
          await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,1))', [
            identifier,
          ]);
        let before: Product | null = null;
        let id = productId;
        if (id) {
          const locked: { version: number; styleCode: string }[] = await manager.query(
            'SELECT version,style_code AS "styleCode" FROM catalog_products WHERE id=$1 FOR UPDATE',
            [id],
          );
          if (!locked[0])
            throw new NotFoundException({
              code: 'PRODUCT_NOT_FOUND',
              message: 'Product not found',
            });
          if (locked[0].version !== input.expectedVersion)
            throw new ConflictException({
              code: 'STALE_PRODUCT',
              message: 'Reload the product before saving',
            });
          if (locked[0].styleCode !== input.styleCode)
            invalid('A saved style code cannot be renamed');
          before = await this.detail(id, manager);
        }
        if (input.categoryId) await this.checkCategory(manager, input.categoryId);
        if (!id) {
          const products: { id: string }[] = await manager.query(
            'INSERT INTO catalog_products(style_code,name,description,category_id,status,currency) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
            [
              input.styleCode,
              input.name,
              input.description,
              input.categoryId,
              input.status,
              input.currency,
            ],
          );
          id = products[0]!.id;
        } else {
          await manager.query(
            'UPDATE catalog_products SET name=$1,description=$2,category_id=$3,status=$4,version=version+1,updated_at=now() WHERE id=$5',
            [input.name, input.description, input.categoryId, input.status, id],
          );
        }
        const stored: StoredVariant[] = await manager.query(
          'SELECT id,sku,attributes,options_key AS "optionsKey" FROM catalog_variants WHERE product_id=$1',
          [id],
        );
        const byId = new Map(stored.map((row) => [row.id, row]));
        const provided = new Set(input.variants.flatMap((row) => (row.id ? [row.id] : [])));
        if (stored.some((row) => !provided.has(row.id)))
          invalid('Keep saved variants in this edit; deactivate them instead of removing');
        for (const row of input.variants) {
          if (row.id) {
            const old = byId.get(row.id);
            if (
              !old ||
              old.sku !== row.sku ||
              old.optionsKey !== row.optionsKey ||
              Object.keys(old.attributes).length !== Object.keys(row.attributes).length ||
              Object.entries(row.attributes).some(([key, value]) => old.attributes[key] !== value)
            )
              invalid(
                'Saved SKU and variant attributes cannot change; deactivate it and add a replacement',
              );
          }
        }
        // Vacate barcodes within this transaction so legitimate barcode moves cannot depend on row order.
        if (stored.length)
          await manager.query('UPDATE catalog_variants SET barcode=NULL WHERE product_id=$1', [id]);
        // Release active option combinations first, then upsert in deterministic SKU order.
        for (const row of input.variants.filter((row) => row.id && !row.isActive)) {
          await manager.query(
            'UPDATE catalog_variants SET is_active=false WHERE id=$1 AND product_id=$2',
            [row.id, id],
          );
        }
        for (const row of input.variants) {
          if (row.id) {
            await manager.query(
              'UPDATE catalog_variants SET barcode=$1,price_minor=$2,is_active=$3 WHERE id=$4 AND product_id=$5',
              [row.barcode, row.priceMinor, row.isActive, row.id, id],
            );
          } else {
            await manager.query(
              'INSERT INTO catalog_variants(product_id,sku,attributes,options_key,barcode,price_minor,is_active) VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7)',
              [
                id,
                row.sku,
                JSON.stringify(row.attributes),
                row.optionsKey,
                row.barcode,
                row.priceMinor,
                row.isActive,
              ],
            );
          }
        }
        const after = await this.detail(id, manager);
        await this.audit.catalog(
          manager,
          actor,
          before ? 'catalog.product_updated' : 'catalog.product_created',
          requestId,
          {
            entityId: id,
            version: after.version,
            variantCount: after.variants.length,
            before: before ? this.snapshot(before) : null,
            after: this.snapshot(after),
          },
        );
        await manager.query(
          'INSERT INTO catalog_requests(key,actor_id,resource_id,request_hash,response) VALUES ($1,$2,$3,$4,$5::jsonb)',
          [key, actor, id, hash, JSON.stringify(after)],
        );
        return after;
      });
    } catch (error) {
      this.databaseError(error);
    }
  }

  private snapshot(product: Product) {
    return {
      styleCode: product.styleCode,
      name: product.name,
      categoryId: product.categoryId,
      status: product.status,
      variants: product.variants.map((row) => ({
        sku: row.sku,
        attributes: row.attributes,
        barcode: row.barcode,
        price: row.price,
        isActive: row.isActive,
      })),
    };
  }
}
