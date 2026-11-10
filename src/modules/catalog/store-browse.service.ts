import type { StoreBrowseResult, StoreProductCard } from './store-browse.types.js';
import { ServiceUnavailableException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { StoreBrowseQuery } from './store-browse.validation.js';
// Match catalog fold() for the supported size/color keys without changing stored SKU values.
const folded = (expression: string) =>
  'lower(regexp_replace(btrim(normalize(' + expression + ",NFKC)), '[[:space:]]+', ' ', 'g'))";
const variantSize = folded("v->'attributes'->>'size'"),
  variantColor = folded("v->'attributes'->>'color'");
export class StoreBrowseService {
  constructor(private readonly db: DataSource) {}
  async browse(q: StoreBrowseQuery): Promise<StoreBrowseResult> {
    const order = {
      name: 'lower(name),slug',
      price_asc: 'min_price,lower(name),slug',
      price_desc: 'min_price DESC,lower(name),slug',
    }[q.sort];
    try {
      return await this.db.transaction('REPEATABLE READ', async (m) => {
        await m.query('SET TRANSACTION READ ONLY');
        await m.query("SET LOCAL statement_timeout='3000ms'");
        const [result] = await m.query(
          `
WITH eligible AS MATERIALIZED (
 SELECT r.snapshot AS s,r.version FROM public.catalog_releases r
 WHERE r.state='published' AND public.catalog_release_eligible(r.product_id)
), matching AS MATERIALIZED (
 SELECT s,version,v, (v->>'priceMinor')::bigint AS price,
 ${variantSize} AS size,${variantColor} AS color
 FROM eligible CROSS JOIN LATERAL jsonb_array_elements(s->'variants') v
 WHERE ($1='' OR position($1 in ${folded("(s->>'name') || ' ' || (s->>'styleCode')")} )>0)
 AND ($2::text IS NULL OR s->'categoryPath' @> jsonb_build_array(jsonb_build_object('slug',$2::text)))
 AND ($3::text IS NULL OR ${variantSize}=$3)
 AND ($4::text IS NULL OR ${variantColor}=$4)
 AND ($5::text IS NULL OR s->'specifications'->>'fit'=$5)
 AND ($6::bigint IS NULL OR (v->>'priceMinor')::bigint >= $6)
 AND ($7::bigint IS NULL OR (v->>'priceMinor')::bigint <= $7)
), products AS MATERIALIZED (
 SELECT s,version,s->>'name' AS name,s->>'slug' AS slug,min(price) AS min_price,max(price) AS max_price,count(*)::int AS matches
 FROM matching GROUP BY s,version
), cards AS (
 SELECT row_number() OVER (ORDER BY ${order}) AS ordinal,jsonb_build_object('productId',s->>'productId','slug',slug,'name',name,'styleCode',s->>'styleCode','currency','BDT',
 'releaseVersion',version,'matchingVariantCount',matches,'matchingPriceMinMinor',min_price::text,'matchingPriceMaxMinor',max_price::text,
 'photo',(SELECT jsonb_build_object('id',p->>'id','alt',p->>'alt','width',p->'width','height',p->'height',
 'thumbnailUrl','/api/v1/store/photos/'||(p->>'id')||'/thumbnail') FROM jsonb_array_elements(s->'photos') p WHERE (p->>'primary')::boolean LIMIT 1)) AS card
 FROM products ORDER BY ${order} LIMIT $8 OFFSET $9
), facet_values AS (
 SELECT 'size' AS kind,size AS value,s->>'productId' AS pid FROM matching WHERE size IS NOT NULL
 UNION ALL SELECT 'color',color,s->>'productId' FROM matching WHERE color IS NOT NULL
 UNION ALL SELECT 'fit',s->'specifications'->>'fit',s->>'productId' FROM matching WHERE s->'specifications'->>'fit' IS NOT NULL
), facet_counts AS (
 SELECT kind,value,count(DISTINCT pid)::int AS count FROM facet_values GROUP BY kind,value
), ranked_facets AS (
 SELECT *,row_number() OVER(PARTITION BY kind ORDER BY count DESC,value) AS rank FROM facet_counts
)
SELECT coalesce((SELECT jsonb_agg(card ORDER BY ordinal) FROM cards),'[]'::jsonb) AS items,
 (SELECT count(*)::int FROM products) AS total,
 coalesce((SELECT jsonb_agg(jsonb_build_object('kind',kind,'value',value,'count',count) ORDER BY kind,rank) FROM ranked_facets WHERE rank<=101),'[]'::jsonb) AS facets
`,
          [
            q.q,
            q.category,
            q.size,
            q.color,
            q.fit,
            q.minPriceMinor,
            q.maxPriceMinor,
            q.pageSize,
            (q.page - 1) * q.pageSize,
          ],
        );
        const facets: StoreBrowseResult['facets'] = {
          size: { items: [], truncated: false },
          color: { items: [], truncated: false },
          fit: { items: [], truncated: false },
        };
        for (const kind of ['size', 'color', 'fit'] as const) {
          const values = (result.facets as { kind: string; value: string; count: number }[]).filter(
            (v) => v.kind === kind,
          );
          facets[kind] = {
            items: values.slice(0, 100).map(({ value, count }) => ({ value, count })),
            truncated: values.length > 100,
          };
        }
        return {
          items: result.items as StoreProductCard[],
          total: result.total,
          page: q.page,
          pageSize: q.pageSize,
          hasMore: q.page * q.pageSize < result.total,
          currency: 'BDT' as const,
          facets,
        };
      });
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'driverError' in error &&
        (error.driverError as { code?: string })?.code === '57014'
      )
        throw new ServiceUnavailableException({
          code: 'STORE_BROWSE_BUSY',
          message: 'Search is temporarily busy. Please retry.',
        });
      throw error;
    }
  }
}
