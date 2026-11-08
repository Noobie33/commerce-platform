import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { permits } from '../authorization/policy.js';
import type { Principal } from '../identity/http.types.js';
import type {
  ReversalPreview,
  InventoryLocation,
  StockInput,
  ReversalInput,
  StockPosting,
  StockPage,
  StockRow,
  InventoryQuery,
  HistoryRow,
} from './inventory.types.js';
import { invalid } from './inventory.validation.js';
export class InventoryService {
  constructor(private readonly source: DataSource) {}
  async locations(user: Principal): Promise<InventoryLocation[]> {
    const global = permits(user.grants, 'inventory.read'),
      ids = user.grants
        .filter((g) => g.code === 'inventory.read' && g.locationId)
        .map((g) => g.locationId);
    if (!global && !ids.length) throw new ForbiddenException('Inventory access required');
    const rows: Omit<InventoryLocation, 'canReceive' | 'canAdjust' | 'canTransfer'>[] =
      await this.source.query(
        'SELECT id,code,name,kind FROM locations WHERE is_active AND ($1::boolean OR id=ANY($2::uuid[])) ORDER BY name,id',
        [global, ids],
      );
    return rows.map((row) => ({
      ...row,
      canReceive: permits(user.grants, 'inventory.receive', row.id),
      canAdjust: permits(user.grants, 'inventory.adjust', row.id),
      canTransfer: permits(user.grants, 'inventory.transfer', row.id),
    }));
  }
  async createLocation(
    input: { code: string; name: string; kind: string },
    actor: string,
    requestId: string,
  ) {
    try {
      return await this.source.transaction(async (m) => {
        const rows = await m.query(
          'INSERT INTO locations(code,name,kind) VALUES ($1,$2,$3) RETURNING id,code,name,kind',
          [input.code, input.name, input.kind],
        );
        const row = rows[0];
        await m.query(
          'INSERT INTO audit_events(actor_id,action,request_id,metadata) VALUES ($1,$2,$3,$4::jsonb)',
          [
            actor,
            'inventory.location_created',
            requestId,
            JSON.stringify({ locationId: row.id, code: row.code, kind: row.kind }),
          ],
        );
        return row;
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
        throw new ConflictException({ code: 'LOCATION_CODE_EXISTS' });
      throw error;
    }
  }
  private async active(id: string) {
    if (
      !(await this.source.query('SELECT id FROM locations WHERE id=$1 AND is_active', [id])).length
    )
      throw new NotFoundException({ code: 'LOCATION_NOT_FOUND' });
  }
  private escape(search: string) {
    return '%' + search.replace(/[\\%_]/g, (value) => '\\' + value) + '%';
  }
  async variants(locationId: string, search: string): Promise<StockRow[]> {
    await this.active(locationId);
    if (search.length < 2) return [];
    return this.source.query(
      `
 SELECT v.id AS "variantId",v.sku,p.name AS "productName",p.style_code AS "styleCode",v.attributes,v.is_active AS "isActive",p.status AS "productStatus",coalesce(b.quantity,0)::text AS quantity
 FROM catalog_variants v JOIN catalog_products p ON p.id=v.product_id LEFT JOIN inventory_balances b ON b.variant_id=v.id AND b.location_id=$1
 WHERE v.sku ILIKE $2 OR p.name ILIKE $2 OR p.style_code ILIKE $2 ORDER BY v.sku,v.id LIMIT 20`,
      [locationId, this.escape(search)],
    );
  }
  async stock(locationId: string, query: InventoryQuery): Promise<StockPage> {
    await this.active(locationId);
    return this.source.transaction('REPEATABLE READ', async (m) => {
      const summary = (
        await m.query(
          'SELECT count(*)::int AS "recordedSkus",count(*) FILTER(WHERE quantity>0)::int AS "positiveSkus",count(*) FILTER(WHERE quantity=0)::int AS "zeroSkus",coalesce(sum(quantity),0)::text AS units FROM inventory_balances WHERE location_id=$1',
          [locationId],
        )
      )[0];
      const values = [locationId, this.escape(query.search), query.stock],
        where =
          "b.location_id=$1 AND ($2='%%' OR v.sku ILIKE $2 OR p.name ILIKE $2 OR p.style_code ILIKE $2) AND ($3='all' OR ($3='positive' AND b.quantity>0) OR ($3='zero' AND b.quantity=0))";
      const total = (
        await m.query(
          'SELECT count(*)::int AS total FROM inventory_balances b JOIN catalog_variants v ON v.id=b.variant_id JOIN catalog_products p ON p.id=v.product_id WHERE ' +
            where,
          values,
        )
      )[0].total;
      const items: StockRow[] = await m.query(
        'SELECT v.id AS "variantId",v.sku,p.name AS "productName",p.style_code AS "styleCode",v.attributes,v.is_active AS "isActive",p.status AS "productStatus",b.quantity::text AS quantity FROM inventory_balances b JOIN catalog_variants v ON v.id=b.variant_id JOIN catalog_products p ON p.id=v.product_id WHERE ' +
          where +
          ' ORDER BY p.name,v.sku,v.id LIMIT $4 OFFSET $5',
        [...values, query.pageSize, (query.page - 1) * query.pageSize],
      );
      return { items, total, page: query.page, pageSize: query.pageSize, summary };
    });
  }
  async history(locationId: string, query: InventoryQuery, user: Principal) {
    await this.active(locationId);
    return this.source.transaction('REPEATABLE READ', async (m) => {
      const values = [locationId, this.escape(query.search), query.variantId];
      const where =
        "EXISTS(SELECT 1 FROM inventory_entries e WHERE e.posting_id=p.id AND e.location_id=$1 AND ($3::uuid IS NULL OR e.variant_id=$3) AND ($2='%%' OR e.sku ILIKE $2 OR e.product_name ILIKE $2 OR p.reason ILIKE $2 OR p.reference ILIKE $2))";
      const total = (
        await m.query(
          'SELECT count(*)::int AS total FROM inventory_postings p WHERE ' + where,
          values,
        )
      )[0].total;
      const rows: (Omit<HistoryRow, 'canReverse'> & {
        locationId: string;
        destinationId: string | null;
      })[] = await m.query(
        `
 SELECT p.id,p.kind,p.reason,p.reference,p.created_at AS "createdAt",u.display_name AS "actorName",p.reversal_of AS "reversalOf",r.id AS "reversedBy",p.location_id AS "locationId",p.destination_id AS "destinationId",
 (SELECT jsonb_agg(jsonb_build_object('variantId',e.variant_id,'sku',e.sku,'productName',e.product_name,'delta',e.delta::text,'quantityBefore',e.quantity_before::text,'quantityAfter',e.quantity_after::text) ORDER BY e.sku) FROM inventory_entries e WHERE e.posting_id=p.id AND e.location_id=$1) AS lines
 FROM inventory_postings p JOIN staff_users u ON u.id=p.actor_id LEFT JOIN inventory_postings r ON r.reversal_of=p.id
 WHERE ` +
          where +
          ' ORDER BY p.created_at DESC,p.id DESC LIMIT $4 OFFSET $5',
        [...values, query.pageSize, (query.page - 1) * query.pageSize],
      );
      const items = rows.map(({ locationId: source, destinationId, ...row }) => {
        const action = row.kind === 'transfer' ? 'inventory.transfer' : 'inventory.adjust';
        const canReverse =
          row.kind !== 'reversal' &&
          !row.reversedBy &&
          [source, ...(destinationId ? [destinationId] : [])].every(
            (id) => permits(user.grants, 'inventory.read', id) && permits(user.grants, action, id),
          );
        return { ...row, createdAt: new Date(row.createdAt).toISOString(), canReverse };
      });
      return { items, total, page: query.page, pageSize: query.pageSize };
    });
  }
  async reversalPreview(id: string, user: Principal): Promise<ReversalPreview[]> {
    const rows: { kind: string; location_id: string; destination_id: string | null }[] =
      await this.source.query(
        'SELECT kind,location_id,destination_id FROM inventory_postings WHERE id=$1',
        [id],
      );
    const row = rows[0];
    if (!row) throw new NotFoundException({ code: 'INVENTORY_RECORD_NOT_FOUND' });
    const action = row.kind === 'transfer' ? 'inventory.transfer' : 'inventory.adjust';
    const affected = [row.location_id, ...(row.destination_id ? [row.destination_id] : [])];
    // Check every endpoint before reading or returning ANY cross-location lines/names.
    if (
      !affected.every(
        (location) =>
          permits(user.grants, 'inventory.read', location) &&
          permits(user.grants, action, location),
      )
    )
      throw new ForbiddenException({ code: 'INVENTORY_PERMISSION' });
    if (row.kind === 'reversal') throw new ConflictException({ code: 'CANNOT_REVERSE_REVERSAL' });
    for (const location of affected) await this.active(location);
    if (
      (await this.source.query('SELECT id FROM inventory_postings WHERE reversal_of=$1', [id]))
        .length
    )
      throw new ConflictException({ code: 'POSTING_ALREADY_REVERSED' });
    return this.source.query(
      'SELECT e.variant_id AS "variantId",e.location_id AS "locationId",l.name AS "locationName",e.sku,e.product_name AS "productName",(-e.delta)::text AS delta,coalesce(b.quantity,0)::text AS "quantityBefore",(coalesce(b.quantity,0)-e.delta)::text AS "quantityAfter" FROM inventory_entries e JOIN locations l ON l.id=e.location_id LEFT JOIN inventory_balances b ON b.location_id=e.location_id AND b.variant_id=e.variant_id WHERE e.posting_id=$1 ORDER BY l.name,e.sku',
      [id],
    );
  }
  async post(
    input: StockInput | ReversalInput,
    key: string,
    user: Principal,
    requestId: string,
  ): Promise<StockPosting> {
    try {
      return (
        await this.source.query(
          'SELECT public.inventory_post($1::uuid,$2::uuid,$3::uuid,$4::jsonb) AS result',
          [key, user.id, requestId, JSON.stringify(input)],
        )
      )[0].result;
    } catch (error) {
      const details =
        error && typeof error === 'object' && 'driverError' in error ? error.driverError : error;
      const message =
        details && typeof details === 'object' && 'message' in details
          ? String(details.message)
          : '';
      const codes: Record<string, string> = {
        INVENTORY_INSUFFICIENT: 'INSUFFICIENT_STOCK',
        INVENTORY_ALREADY_REVERSED: 'POSTING_ALREADY_REVERSED',
        INVENTORY_REVERSE_REVERSAL: 'CANNOT_REVERSE_REVERSAL',
        INVENTORY_IDEMPOTENCY_MISMATCH: 'IDEMPOTENCY_MISMATCH',
        INVENTORY_OPENING_EXISTS: 'OPENING_STOCK_EXISTS',
        INVENTORY_VARIANT_INACTIVE: 'INACTIVE_STOCK_VARIANT',
        INVENTORY_QUANTITY_LIMIT: 'STOCK_QUANTITY_LIMIT',
      };
      if (message === 'INVENTORY_PERMISSION')
        throw new ForbiddenException({ code: 'INVENTORY_PERMISSION' });
      if (
        [
          'INVENTORY_POSTING_NOT_FOUND',
          'INVENTORY_VARIANT_NOT_FOUND',
          'INVENTORY_LOCATION_INACTIVE',
        ].includes(message)
      )
        throw new NotFoundException({ code: 'INVENTORY_RECORD_NOT_FOUND' });
      if (message === 'INVENTORY_INVALID_INPUT')
        invalid('Check the stock action, SKUs and whole-piece quantities');
      if (codes[message]) throw new ConflictException({ code: codes[message] });
      if (details && typeof details === 'object' && 'code' in details && details.code === '57014')
        throw new ServiceUnavailableException({ code: 'INVENTORY_BUSY' });
      throw error;
    }
  }
}
