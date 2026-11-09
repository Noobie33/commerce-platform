import {
  ForbiddenException,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { Customer, CustomerInput, CustomerResult, CreditHistory } from './customer.types.js';
import { listQuery, matchQuery } from './customer.validation.js';
const columns = `id,code,kind AS "customerKind",segment,name,contact_name AS "contactName",phone,email,billing_address AS "billingAddress",delivery_address AS "deliveryAddress",notes,is_active AS "isActive",version,credit_enabled AS "creditEnabled",credit_limit_minor::text AS "creditMinor",payment_terms_days AS "paymentTermsDays",created_at AS "createdAt",updated_at AS "updatedAt"`;
function customer(row: Record<string, unknown>): Customer {
  const { creditMinor, ...rest } = row;
  const n = BigInt(String(creditMinor));
  return {
    ...rest,
    creditLimit: (n / 100n).toString() + '.' + (n % 100n).toString().padStart(2, '0'),
  } as unknown as Customer;
}
export class CustomerService {
  constructor(private readonly db: DataSource) {}
  async list(q: ReturnType<typeof listQuery>) {
    const needle = q.search.replace(/[\\%_]/g, '\\$&');
    const normalized = q.search
      .replace(/[০-৯]/g, (c) => String(c.charCodeAt(0) - 2534))
      .replace(/[\s()\-]/g, '');
    const args = [`%${needle}%`, q.status, q.segment, q.kind, normalized];
    const where = `($1='%%' OR name ILIKE $1 OR code ILIKE $1 OR contact_name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1 OR ($5<>'' AND position($5 IN phone)>0)) AND($2='all' OR is_active=($2='active')) AND($3='all' OR segment=$3) AND($4='all' OR kind=$4)`;
    return this.db.transaction('REPEATABLE READ', async (m) => {
      const total = Number(
        (await m.query('SELECT count(*)::int AS n FROM customers WHERE ' + where, args))[0].n,
      );
      const rows = await m.query(
        'SELECT ' +
          columns +
          ' FROM customers WHERE ' +
          where +
          ' ORDER BY lower(name),id LIMIT 20 OFFSET $6',
        [...args, (q.page - 1) * 20],
      );
      return { items: rows.map(customer), total, page: q.page, pageSize: 20 };
    });
  }
  async read(id: string) {
    const rows = await this.db.query('SELECT ' + columns + ' FROM customers WHERE id=$1', [id]);
    if (!rows[0]) throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND' });
    return customer(rows[0]);
  }
  async matches(q: ReturnType<typeof matchQuery>) {
    if (!q.phone && !q.email) return { items: [] };
    return {
      items: await this.db.query(
        `SELECT id,code,name FROM customers WHERE ($3::uuid IS NULL OR id<>$3) AND(($1<>'' AND phone=$1) OR($2<>'' AND lower(email)=lower($2))) ORDER BY code LIMIT 5`,
        [q.phone, q.email, q.excludeId],
      ),
    };
  }
  async history(id: string, page: number) {
    await this.read(id);
    return this.db.transaction('REPEATABLE READ', async (m) => ({
      items: await m.query(
        `SELECT h.id,h.version,h.previous_policy AS "previousPolicy",h.current_policy AS "currentPolicy",h.reason,u.display_name AS "actorName",h.created_at AS "createdAt" FROM customer_credit_history h JOIN staff_users u ON u.id=h.actor_id WHERE h.customer_id=$1 ORDER BY h.version DESC LIMIT 20 OFFSET $2`,
        [id, (page - 1) * 20],
      ),
      page,
      total: Number(
        (
          await m.query(
            'SELECT count(*)::int AS n FROM customer_credit_history WHERE customer_id=$1',
            [id],
          )
        )[0].n,
      ),
      pageSize: 20,
    })) as Promise<CreditHistory>;
  }
  async save(
    kind: 'create' | 'update',
    id: string | null,
    input: CustomerInput,
    key: string,
    actor: string,
    requestId: string,
  ): Promise<CustomerResult> {
    try {
      return (
        await this.db.query('SELECT public.customer_save($1,$2,$3,$4::jsonb) AS result', [
          key,
          actor,
          requestId,
          JSON.stringify({ kind, ...(id ? { id } : {}), ...input }),
        ])
      )[0].result;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const code = [
        'CUSTOMER_PERMISSION',
        'CUSTOMER_IDEMPOTENCY',
        'CUSTOMER_NOT_FOUND',
        'CUSTOMER_STALE',
        'CUSTOMER_INACTIVE',
        'CUSTOMER_INVALID',
      ].find((c) => message === c);
      if (message === 'CUSTOMER_RETAIL_ONLY')
        throw new ConflictException({
          code: message,
          message:
            'Only retail customer profiles can be changed. Historical trade records are read-only.',
        });
      if (code === 'CUSTOMER_PERMISSION') throw new ForbiddenException({ code: 'FORBIDDEN' });
      if (code === 'CUSTOMER_NOT_FOUND') throw new NotFoundException({ code });
      if (code === 'CUSTOMER_INVALID')
        throw new BadRequestException({
          code: 'INVALID_CUSTOMER_INPUT',
          message: 'Check customer details',
        });
      if (code) throw new ConflictException({ code });
      throw error;
    }
  }
}
