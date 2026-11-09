import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { MerchInput, MerchItem, MerchPage } from './merch.types.js';
import type { merchQuery } from './merch.validation.js';
export class MerchService {
  constructor(private readonly db: DataSource) {}
  async list(q: ReturnType<typeof merchQuery>): Promise<MerchPage> {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      const params = [q.kind, '%' + q.search.replace(/[\\%_]/g, '\\$&') + '%', q.status];
      const where =
        "WHERE ($1='all' OR h.kind=$1) AND (v.definition->>'title' ILIKE $2 OR h.slug ILIKE $2) AND ($3='all' OR(v.definition->>'active')::boolean)";
      const [count] = await m.query(
        'SELECT count(*)::int AS total FROM catalog_merch_items h JOIN catalog_merch_versions v ON v.item_id=h.id AND v.version=h.version ' +
          where,
        params,
      );
      const items = await m.query(
        'SELECT h.id,h.kind,h.slug,h.version,v.definition,v.created_at AS "updatedAt" FROM catalog_merch_items h JOIN catalog_merch_versions v ON v.item_id=h.id AND v.version=h.version ' +
          where +
          " ORDER BY lower(v.definition->>'title'),h.id LIMIT 20 OFFSET $4",
        [...params, (q.page - 1) * 20],
      );
      return { items, total: count.total, page: q.page, pageSize: 20 };
    });
  }
  async read(id: string, page: number) {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      const [item]: MerchItem[] = await m.query(
        'SELECT h.id,h.kind,h.slug,h.version,v.definition,v.created_at AS "updatedAt" FROM catalog_merch_items h JOIN catalog_merch_versions v ON v.item_id=h.id AND v.version=h.version WHERE h.id=$1',
        [id],
      );
      if (!item) throw new NotFoundException({ code: 'MERCH_NOT_FOUND' });
      const history = await m.query(
        'SELECT version,definition,reason,created_at AS "createdAt" FROM catalog_merch_versions WHERE item_id=$1 ORDER BY version DESC LIMIT 20 OFFSET $2',
        [id, (page - 1) * 20],
      );
      return { item, history, page, pageSize: 20, total: item.version };
    });
  }
  async save(input: MerchInput, key: string, actor: string, requestId: string) {
    try {
      return (
        await this.db.query('SELECT public.catalog_merch_post($1,$2,$3,$4::jsonb) AS result', [
          key,
          actor,
          requestId,
          JSON.stringify(input),
        ])
      )[0].result as { id: string; version: number };
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg === 'CONTENT_PERMISSION') throw new ForbiddenException({ code: 'FORBIDDEN' });
      if (msg === 'MERCH_INVALID') throw new BadRequestException({ code: 'INVALID_MERCH_INPUT' });
      if (['CONTENT_STALE', 'CONTENT_IDEMPOTENCY'].includes(msg))
        throw new ConflictException({
          code: msg === 'CONTENT_STALE' ? 'MERCH_STALE' : 'MERCH_IDEMPOTENCY',
        });
      if (
        e &&
        typeof e === 'object' &&
        'driverError' in e &&
        e.driverError &&
        typeof e.driverError === 'object' &&
        'code' in e.driverError &&
        e.driverError.code === '23505'
      )
        throw new ConflictException({ code: 'MERCH_IDENTIFIER_EXISTS' });
      throw e;
    }
  }
}
