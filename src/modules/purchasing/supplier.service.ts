import { ConflictException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { PurchasingStore, escapeSearch } from './purchasing.store.js';
import type { Supplier, SupplierInput, PageQuery, Page } from './purchasing.types.js';
export class SupplierService {
  constructor(private readonly store: PurchasingStore) {}
  private columns =
    'id,code,name,contact_name AS "contactName",phone,email,address,tax_reference AS "taxReference",notes,is_active AS "isActive",version,created_at AS "createdAt",updated_at AS "updatedAt"';
  async read(id: string, m: Pick<EntityManager, 'query'> = this.store.source): Promise<Supplier> {
    const rows = await m.query(
      'SELECT ' + this.columns + ' FROM purchasing_suppliers WHERE id=$1',
      [id],
    );
    if (!rows[0]) throw new NotFoundException({ code: 'SUPPLIER_NOT_FOUND' });
    return {
      ...rows[0],
      createdAt: new Date(rows[0].createdAt).toISOString(),
      updatedAt: new Date(rows[0].updatedAt).toISOString(),
    };
  }
  async list(q: PageQuery): Promise<Page<Supplier>> {
    return this.store.source.transaction('REPEATABLE READ', async (m) => {
      const args = [escapeSearch(q.search), q.status],
        where =
          "($1='%%' OR name ILIKE $1 OR code ILIKE $1 OR contact_name ILIKE $1 OR phone ILIKE $1) AND ($2='all' OR ($2='active' AND is_active) OR ($2='inactive' AND NOT is_active))";
      const total = (
        await m.query('SELECT count(*)::int AS n FROM purchasing_suppliers WHERE ' + where, args)
      )[0].n;
      const rows = await m.query(
        'SELECT ' +
          this.columns +
          ' FROM purchasing_suppliers WHERE ' +
          where +
          ' ORDER BY name,id LIMIT 20 OFFSET $3',
        [...args, (q.page - 1) * 20],
      );
      return {
        items: rows.map((r: Supplier) => ({
          ...r,
          createdAt: new Date(r.createdAt).toISOString(),
          updatedAt: new Date(r.updatedAt).toISOString(),
        })),
        total,
        page: q.page,
        pageSize: 20,
      };
    });
  }
  save(id: string | null, input: SupplierInput, actor: string, key: string, requestId: string) {
    return this.store.write(
      actor,
      key,
      requestId,
      { operation: 'supplier.save', id, input },
      async (m) => {
        let target = id;
        if (id) {
          const previous = await m.query(
            'SELECT code,version FROM purchasing_suppliers WHERE id=$1 FOR UPDATE',
            [id],
          );
          if (!previous[0]) throw new NotFoundException({ code: 'SUPPLIER_NOT_FOUND' });
          if (previous[0].version !== input.expectedVersion)
            throw new ConflictException({ code: 'STALE_PURCHASING_RECORD' });
          if (previous[0].code !== input.code)
            throw new ConflictException({ code: 'SUPPLIER_CODE_IMMUTABLE' });
          await m.query(
            'UPDATE purchasing_suppliers SET name=$2,contact_name=$3,phone=$4,email=$5,address=$6,tax_reference=$7,notes=$8,is_active=$9,version=version+1,updated_at=now() WHERE id=$1',
            [
              id,
              input.name,
              input.contactName,
              input.phone,
              input.email,
              input.address,
              input.taxReference,
              input.notes,
              input.isActive,
            ],
          );
        } else {
          const rows = await m.query(
            'INSERT INTO purchasing_suppliers(code,name,contact_name,phone,email,address,tax_reference,notes,is_active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
            [
              input.code,
              input.name,
              input.contactName,
              input.phone,
              input.email,
              input.address,
              input.taxReference,
              input.notes,
              input.isActive,
            ],
          );
          target = rows[0].id;
        }
        const value = await this.read(target!, m);
        return {
          value,
          id: value.id,
          entity: 'supplier',
          action: id ? 'purchasing.supplier_updated' : 'purchasing.supplier_created',
          version: value.version,
        };
      },
    );
  }
}
