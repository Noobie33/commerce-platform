import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
export const escapeSearch = (s: string) => '%' + s.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
export class PurchasingStore {
  constructor(readonly source: DataSource) {}
  async write<T>(
    actor: string,
    key: string,
    requestId: string,
    payload: unknown,
    operation: (m: EntityManager) => Promise<{
      value: T;
      id: string;
      entity: 'supplier' | 'order';
      action: string;
      version: number;
    }>,
  ): Promise<T> {
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    try {
      return await this.source.transaction(async (m) => {
        await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,6))', [
          'purchasing-request:' + key,
        ]);
        const previous = await m.query(
          'SELECT actor_id,request_hash,response FROM purchasing_requests WHERE key=$1',
          [key],
        );
        if (previous.length) {
          if (previous[0].actor_id !== actor || previous[0].request_hash !== hash)
            throw new ConflictException({ code: 'IDEMPOTENCY_MISMATCH' });
          return previous[0].response as T;
        }
        const result = await operation(m);
        await m.query(
          'INSERT INTO audit_events(actor_id,action,request_id,metadata) VALUES($1,$2,$3,$4::jsonb)',
          [
            actor,
            result.action,
            requestId,
            JSON.stringify({ entityId: result.id, version: result.version }),
          ],
        );
        await m.query(
          'INSERT INTO purchasing_requests(key,actor_id,request_hash,supplier_id,order_id,response) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
          [
            key,
            actor,
            hash,
            result.entity === 'supplier' ? result.id : null,
            result.entity === 'order' ? result.id : null,
            JSON.stringify(result.value),
          ],
        );
        return result.value;
      });
    } catch (error) {
      const detail =
        error && typeof error === 'object' && 'driverError' in error ? error.driverError : error;
      if (detail && typeof detail === 'object' && 'code' in detail) {
        if (detail.code === '23505')
          throw new ConflictException({ code: 'PURCHASING_CODE_EXISTS' });
        if (detail.code === '57014' || detail.code === '40P01')
          throw new ServiceUnavailableException({ code: 'PURCHASING_BUSY' });
      }
      throw error;
    }
  }
}
