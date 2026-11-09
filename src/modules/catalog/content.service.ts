import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { ContentInput, ContentRecord, ContentResult, ContentView } from './content.types.js';
export class ProductContentService {
  constructor(private readonly db: DataSource) {}
  async read(id: string, page: number): Promise<ContentView> {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      const [p] = await m.query('SELECT id,version FROM catalog_products WHERE id=$1', [id]);
      if (!p) throw new NotFoundException({ code: 'CONTENT_NOT_FOUND' });
      const [record] = await m.query(
        `SELECT profile_code AS profile,slug,description,specifications,state,version,updated_at AS "updatedAt",submitted_snapshot AS "submittedSnapshot" FROM catalog_product_content WHERE product_id=$1`,
        [id],
      );
      const [projection] = await m.query(
        `SELECT public.catalog_content_snapshot($1) AS preview,public.catalog_content_issues($1) AS issues,coalesce(c.fingerprint=encode(sha256(convert_to(public.catalog_content_snapshot($1)::text,'UTF8')),'hex'),false) AS current FROM (SELECT 1) x LEFT JOIN catalog_product_content c ON c.product_id=$1`,
        [id],
      );
      const profiles = await m.query(
        'SELECT code,label,fields FROM catalog_content_profiles ORDER BY code',
      );
      const history = {
        items: await m.query(
          `SELECT h.version,h.state,h.action,h.reason,u.display_name AS "actorName",h.created_at AS "createdAt",h.snapshot FROM catalog_content_events h JOIN staff_users u ON u.id=h.actor_id WHERE h.product_id=$1 ORDER BY h.version DESC LIMIT 20 OFFSET $2`,
          [id, (page - 1) * 20],
        ),
        total: (
          await m.query(
            'SELECT count(*)::int AS total FROM catalog_content_events WHERE product_id=$1',
            [id],
          )
        )[0].total,
        page,
        pageSize: 20,
      };
      return {
        productId: id,
        productVersion: p.version,
        record: (record as ContentRecord | undefined) ?? null,
        profiles,
        ...projection,
        history,
      };
    });
  }
  async post(
    id: string,
    input: ContentInput,
    key: string,
    actor: string,
    requestId: string,
  ): Promise<ContentResult> {
    try {
      return (
        await this.db.query('SELECT public.catalog_content_post($1,$2,$3,$4::jsonb) AS result', [
          key,
          actor,
          requestId,
          JSON.stringify({ ...input, productId: id }),
        ])
      )[0].result;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'CONTENT_PERMISSION') throw new ForbiddenException({ code: 'FORBIDDEN' });
      if (message === 'CONTENT_NOT_FOUND') throw new NotFoundException({ code: message });
      if (message === 'CONTENT_INVALID')
        throw new BadRequestException({
          code: 'INVALID_CONTENT_INPUT',
          message: 'Check the selected product type and its field values.',
        });
      if (
        [
          'CONTENT_IDEMPOTENCY',
          'CONTENT_STALE',
          'CONTENT_STATE',
          'CONTENT_INCOMPLETE',
          'CONTENT_CHANGED',
          'CONTENT_SELF_REVIEW',
        ].includes(message)
      )
        throw new ConflictException({ code: message });
      const driver =
        error && typeof error === 'object' && 'driverError' in error ? error.driverError : null;
      if (driver && typeof driver === 'object' && 'code' in driver && driver.code === '23505')
        throw new ConflictException({ code: 'CONTENT_SLUG_EXISTS' });
      throw error;
    }
  }
}
