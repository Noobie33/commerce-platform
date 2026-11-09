import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { Principal } from '../identity/http.types.js';
import { permits } from '../authorization/policy.js';
import type {
  ReservationInput,
  ReservationPage,
  ReservationRecord,
  ReservationResult,
} from './reservation.types.js';
export class ReservationService {
  constructor(private readonly db: DataSource) {}
  async read(orderId: string, page: number, user: Principal): Promise<ReservationPage> {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      const orders = await m.query('SELECT location_id,version FROM sales_orders WHERE id=$1', [
        orderId,
      ]);
      if (!orders[0]) throw new NotFoundException({ code: 'RESERVATION_NOT_FOUND' });
      const loc = orders[0].location_id,
        revision = Number(
          (
            await m.query(
              'SELECT coalesce((SELECT version FROM sales_reservation_state WHERE order_id=$1),1) AS version',
              [orderId],
            )
          )[0].version,
        ),
        asOf = (await m.query('SELECT CURRENT_TIMESTAMP AS time'))[0].time.toISOString();
      const empty = {
        visible: false,
        canManage: false,
        revision,
        asOf,
        current: null,
        items: [],
        page,
        pageSize: 20,
        total: 0,
        lines: [],
      };
      if (!permits(user.grants, 'inventory.read', loc)) return empty;
      const global = permits(user.grants, 'inventory.read'),
        ids = user.grants
          .filter((g) => g.code === 'inventory.read' && g.locationId)
          .map((g) => g.locationId);
      const args = [orderId, global, ids];
      const where = ' h.order_id=$1 AND($2::boolean OR h.location_id=ANY($3::uuid[]))';
      const select = `SELECT h.id,h.order_id AS "orderId",h.order_version AS "orderVersion",h.location_id AS "locationId",l.name AS "locationName",u.display_name AS "actorName",h.reason,h.created_at AS "createdAt",h.expires_at AS "expiresAt",h.closed_at AS "closedAt",x.display_name AS "closedBy",h.close_kind AS "closeKind",h.close_reason AS "closeReason",CASE WHEN h.close_kind='release' THEN 'released' WHEN h.close_kind='expiry' OR h.expires_at<=CURRENT_TIMESTAMP THEN 'expired' ELSE 'active' END AS status,(SELECT jsonb_agg(jsonb_build_object('variantId',d.variant_id,'sku',d.sku,'productName',d.product_name,'quantity',d.quantity::text) ORDER BY d.sku) FROM sales_reservation_lines d WHERE d.reservation_id=h.id) AS lines FROM sales_reservations h JOIN locations l ON l.id=h.location_id JOIN staff_users u ON u.id=h.actor_id LEFT JOIN staff_users x ON x.id=h.closed_by WHERE `;
      const enrich = (h: ReservationRecord) => ({
        ...h,
        canRelease: !h.closedAt && permits(user.grants, 'sales.reserve', h.locationId),
      });
      const items = (
        await m.query(select + where + ' ORDER BY h.created_at DESC,h.id DESC LIMIT 20 OFFSET $4', [
          ...args,
          (page - 1) * 20,
        ])
      ).map(enrich);
      const current =
        (
          await m.query(
            select +
              where +
              ' AND h.closed_at IS NULL ORDER BY h.created_at DESC,h.id DESC LIMIT 1',
            args,
          )
        ).map(enrich)[0] ?? null;
      const total = Number(
        (
          await m.query('SELECT count(*)::int AS n FROM sales_reservations h WHERE ' + where, args)
        )[0].n,
      );
      const lines = await m.query(
        'SELECT l.variant_id AS "variantId",l.sku,l.quantity::text AS quantity,coalesce(a.on_hand,0)::text AS "onHand",coalesce(a.reserved,0)::text AS reserved,coalesce(a.available,0)::text AS available FROM sales_order_lines l LEFT JOIN inventory_availability a ON a.variant_id=l.variant_id AND a.location_id=$2 WHERE l.order_id=$1 ORDER BY l.sku',
        [orderId, loc],
      );
      return {
        ...empty,
        visible: true,
        canManage: permits(user.grants, 'sales.reserve', loc),
        items,
        current,
        total,
        lines,
      };
    });
  }
  async post(
    kind: 'hold' | 'release',
    orderId: string,
    input: ReservationInput,
    key: string,
    actor: string,
    requestId: string,
  ): Promise<ReservationResult> {
    try {
      return (
        await this.db.query('SELECT public.sales_reservation_post($1,$2,$3,$4::jsonb) AS result', [
          key,
          actor,
          requestId,
          JSON.stringify({ kind, orderId, ...input }),
        ])
      )[0].result;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'RESERVATION_PERMISSION') throw new ForbiddenException({ code: message });
      if (message === 'RESERVATION_NOT_FOUND') throw new NotFoundException({ code: message });
      if (message === 'RESERVATION_INVALID')
        throw new BadRequestException({
          code: 'INVALID_SALES_INPUT',
          message: 'Check stock hold details',
        });
      if (
        [
          'RESERVATION_STALE',
          'RESERVATION_IDEMPOTENCY',
          'RESERVATION_EXISTS',
          'RESERVATION_CLOSED',
          'RESERVATION_UNAVAILABLE',
          'RESERVATION_INSUFFICIENT',
        ].includes(message)
      )
        throw new ConflictException({ code: message });
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
      if (['40001', '40P01', '55P03', '57014'].includes(String(code)))
        throw new ServiceUnavailableException({ code: 'RESERVATION_BUSY' });
      throw error;
    }
  }
}
