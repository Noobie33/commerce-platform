import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type {
  TaxonomyInput,
  TaxonomyItem,
  TaxonomyPage,
  WebsitePreparation,
} from './presentation.types.js';
import type { taxonomyQuery } from './presentation.validation.js';
import type { ContentSnapshot } from './content.types.js';
// Shared read projection; operational IDs and parent relationships remain authoritative.
const tree = `WITH RECURSIVE tree AS(SELECT c.id,c.name,c.parent_id,c.is_active,1 AS depth,jsonb_build_array(jsonb_build_object('id',c.id,'name',c.name,'slug',p.slug,'active',c.is_active)) AS path FROM catalog_categories c LEFT JOIN catalog_category_presentation p ON p.category_id=c.id WHERE c.parent_id IS NULL UNION ALL SELECT c.id,c.name,c.parent_id,c.is_active,t.depth+1,t.path||jsonb_build_array(jsonb_build_object('id',c.id,'name',c.name,'slug',p.slug,'active',c.is_active)) FROM catalog_categories c JOIN tree t ON c.parent_id=t.id LEFT JOIN catalog_category_presentation p ON p.category_id=c.id WHERE t.depth<12) `;
const select = `SELECT t.id,t.name,t.parent_id AS "parentId",t.is_active AS active,coalesce(p.version,0) AS version,p.slug,jsonb_build_object('title',coalesce(p.seo_title,''),'description',coalesce(p.seo_description,'')) AS seo,t.path,(SELECT count(*)::int FROM catalog_products WHERE category_id=t.id AND status='active') AS "activeProducts" FROM tree t LEFT JOIN catalog_category_presentation p ON p.category_id=t.id `;
export async function websitePreparation(
  sql: Pick<EntityManager, 'query'>,
  preview: ContentSnapshot,
  current: boolean,
): Promise<WebsitePreparation> {
  const rows = preview.category
    ? await sql.query(tree + 'SELECT path FROM tree WHERE id=$1', [preview.category.id])
    : [];
  const path = rows[0]?.path ?? [];
  return {
    categoryPath: path,
    searchTitle: preview.seo?.title || preview.name,
    searchDescription: preview.seo?.description || preview.description || '',
    checks: [
      {
        code: 'content_approval',
        passed: current,
        message: current
          ? 'Current product content is approved.'
          : 'Save, submit and approve the current product content.',
      },
      {
        code: 'category_urls',
        passed:
          path.length > 0 &&
          path.every((x: { active: boolean; slug: string | null }) => x.active && !!x.slug),
        message:
          path.length > 0 &&
          path.every((x: { active: boolean; slug: string | null }) => x.active && !!x.slug)
            ? 'Category and ancestor URL names are prepared.'
            : 'Set active category and ancestor URL names in Categories & SEO.',
      },
      {
        code: 'product_url',
        passed: !!preview.slug,
        message: preview.slug ? 'Product URL name is prepared.' : 'Add a product URL name.',
      },
    ],
  };
}
export class TaxonomyService {
  constructor(private readonly db: DataSource) {}
  async list(q: ReturnType<typeof taxonomyQuery>): Promise<TaxonomyPage> {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      const params = ['%' + q.search.replace(/[\\%_]/g, '\\$&') + '%', q.status];
      const where =
        "WHERE (t.name ILIKE $1 OR coalesce(p.slug,'') ILIKE $1) AND ($2='all' OR($2='active' AND t.is_active) OR($2='retired' AND NOT t.is_active))";
      const [count] = await m.query(
        tree +
          'SELECT count(*)::int AS total FROM tree t LEFT JOIN catalog_category_presentation p ON p.category_id=t.id ' +
          where,
        params,
      );
      const items = await m.query(
        tree + select + where + ' ORDER BY lower(t.name),t.id LIMIT 20 OFFSET $3',
        [...params, (q.page - 1) * 20],
      );
      return { items, total: count.total, page: q.page, pageSize: 20 };
    });
  }
  async read(id: string, page: number) {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      const [item]: TaxonomyItem[] = await m.query(tree + select + 'WHERE t.id=$1', [id]);
      if (!item) throw new NotFoundException({ code: 'CATEGORY_NOT_FOUND' });
      const history = await m.query(
        'SELECT version,reason,before_snapshot AS "before",snapshot,created_at AS "createdAt" FROM catalog_category_events WHERE category_id=$1 ORDER BY version DESC LIMIT 20 OFFSET $2',
        [id, (page - 1) * 20],
      );
      const [count] = await m.query(
        'SELECT count(*)::int AS total FROM catalog_category_routes WHERE category_id=$1',
        [id],
      );
      const routes = await m.query(
        'SELECT slug FROM catalog_category_routes WHERE category_id=$1 ORDER BY slug LIMIT 20 OFFSET $2',
        [id, (page - 1) * 20],
      );
      return {
        item,
        history,
        routes: routes.map((x: { slug: string }) => x.slug),
        routeTotal: count.total,
        page,
        pageSize: 20,
        total: item.version,
      };
    });
  }
  async save(input: TaxonomyInput, key: string, actor: string, requestId: string) {
    try {
      return (
        await this.db.query('SELECT public.catalog_category_post($1,$2,$3,$4::jsonb) AS result', [
          key,
          actor,
          requestId,
          JSON.stringify(input),
        ])
      )[0].result as { id: string; version: number };
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg === 'CONTENT_PERMISSION') throw new ForbiddenException({ code: 'FORBIDDEN' });
      if (
        ['TAXONOMY_INVALID', 'TAXONOMY_PARENT', 'TAXONOMY_GRAPH', 'TAXONOMY_URL_REQUIRED'].includes(
          msg,
        )
      )
        throw new BadRequestException({ code: msg });
      if (
        [
          'TAXONOMY_SLUG_EXISTS',
          'TAXONOMY_IN_USE',
          'CONTENT_STALE',
          'CONTENT_IDEMPOTENCY',
        ].includes(msg)
      )
        throw new ConflictException({
          code:
            msg === 'CONTENT_STALE'
              ? 'TAXONOMY_STALE'
              : msg === 'CONTENT_IDEMPOTENCY'
                ? 'TAXONOMY_IDEMPOTENCY'
                : msg,
        });
      const d = e && typeof e === 'object' && 'driverError' in e ? e.driverError : null;
      if (d && typeof d === 'object' && 'code' in d && d.code === '23505')
        throw new ConflictException({ code: 'CATEGORY_EXISTS' });
      throw e;
    }
  }
}
