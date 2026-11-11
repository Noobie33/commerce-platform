import type { StoreBrowseResult, StoreProductCard } from './store-browse.types.js';
import { ServiceUnavailableException, NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { StoreBrowseQuery } from './store-browse.validation.js';
// Match catalog fold() for the supported size/color keys without changing stored SKU values.
const folded = (expression: string) =>
  'lower(regexp_replace(btrim(normalize(' + expression + ",NFKC)), '[[:space:]]+', ' ', 'g'))";
const variantSize = folded("v->'attributes'->>'size'"),
  variantColor = folded("v->'attributes'->>'color'");
export class StoreBrowseService {
  constructor(private readonly db: DataSource) {}
  async navigation() {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      await m.query('SET TRANSACTION READ ONLY');
      await m.query("SET LOCAL statement_timeout='3000ms'");
      const items = await m.query(
        `WITH eligible AS(SELECT snapshot AS s FROM catalog_releases WHERE state='published' AND public.catalog_release_eligible(product_id)),nodes AS(SELECT n.value->>'id' AS id,n.value->>'slug' AS slug,n.value->>'name' AS name,CASE WHEN n.ord=1 THEN NULL ELSE s->'categoryPath'->(n.ord::int-2)->>'slug' END AS "parentSlug" FROM eligible CROSS JOIN LATERAL jsonb_array_elements(s->'categoryPath') WITH ORDINALITY n(value,ord)) SELECT DISTINCT id,slug,name,"parentSlug" FROM nodes ORDER BY name,slug LIMIT 201`,
      );
      if (items.length > 200)
        throw new ServiceUnavailableException({ code: 'STORE_NAVIGATION_BUSY' });
      return { items };
    });
  }

  async related(slug: string): Promise<{ items: StoreProductCard[] }> {
    try {
      return await this.db.transaction('REPEATABLE READ', async (m) => {
        await m.query('SET TRANSACTION READ ONLY');
        await m.query("SET LOCAL statement_timeout='3000ms'");
        const [result] = await m.query(
          `WITH source AS MATERIALIZED(SELECT snapshot AS s,version,(SELECT min((v->>'priceMinor')::bigint) FROM jsonb_array_elements(snapshot->'variants')v) AS price FROM public.catalog_releases WHERE snapshot->>'slug'=$1 AND state='published' AND public.catalog_release_eligible(product_id)),priced AS(SELECT r.snapshot AS s,r.version,(SELECT min((v->>'priceMinor')::bigint) FROM jsonb_array_elements(r.snapshot->'variants')v) AS price FROM public.catalog_releases r CROSS JOIN source src WHERE r.state='published' AND r.product_id::text<>src.s->>'productId' AND r.snapshot->'categoryPath' -> -1->>'id'=src.s->'categoryPath' -> -1->>'id' AND public.catalog_release_eligible(r.product_id)),candidates AS(SELECT p.*,3*CASE WHEN nullif(src.s->'specifications'->>'materialGroup','')=p.s->'specifications'->>'materialGroup' THEN 1 ELSE 0 END+2*CASE WHEN nullif(src.s->'specifications'->>'occasion','')=p.s->'specifications'->>'occasion' THEN 1 ELSE 0 END+CASE WHEN nullif(src.s->'specifications'->>'fit','')=p.s->'specifications'->>'fit' THEN 1 ELSE 0 END AS score,abs(p.price-src.price) AS distance FROM priced p CROSS JOIN source src WHERE p.s->>'productId'<>src.s->>'productId' AND p.s->'categoryPath' -> -1->>'id'=src.s->'categoryPath' -> -1->>'id' ORDER BY score DESC,distance,lower(p.s->>'name'),p.s->>'slug' LIMIT 8),cards AS(SELECT score,distance,s->>'name' AS name,s->>'slug' AS slug,jsonb_build_object('productId',s->>'productId','slug',s->>'slug','name',s->>'name','styleCode',s->>'styleCode','currency','BDT','releaseVersion',version,'matchingVariantCount',jsonb_array_length(s->'variants'),'matchingPriceMinMinor',price::text,'matchingPriceMaxMinor',(SELECT max((v->>'priceMinor')::bigint)::text FROM jsonb_array_elements(s->'variants')v),'photo',(SELECT jsonb_build_object('id',p->>'id','alt',p->>'alt','width',p->'width','height',p->'height','thumbnailUrl','/api/v1/store/photos/'||(p->>'id')||'/thumbnail') FROM jsonb_array_elements(s->'photos')p WHERE (p->>'primary')::boolean LIMIT 1)) AS card FROM candidates) SELECT EXISTS(SELECT 1 FROM source) AS found,coalesce((SELECT jsonb_agg(card ORDER BY score DESC,distance,lower(name),slug) FROM cards),'[]'::jsonb) AS items`,
          [slug],
        );
        if (!result.found) throw new NotFoundException({ code: 'PUBLIC_PRODUCT_UNAVAILABLE' });
        return { items: result.items as StoreProductCard[] };
      });
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      throw new ServiceUnavailableException({ code: 'STORE_RELATED_BUSY' });
    }
  }
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
 AND ($10::text IS NULL OR s->'specifications'->>'materialGroup'=$10)
 AND ($11::text IS NULL OR s->'specifications'->>'occasion'=$11)
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
 UNION ALL SELECT 'materialGroup',s->'specifications'->>'materialGroup',s->>'productId' FROM matching WHERE nullif(s->'specifications'->>'materialGroup','') IS NOT NULL
 UNION ALL SELECT 'occasion',s->'specifications'->>'occasion',s->>'productId' FROM matching WHERE nullif(s->'specifications'->>'occasion','') IS NOT NULL
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
            q.materialGroup,
            q.occasion,
          ],
        );
        const facets: StoreBrowseResult['facets'] = {
          size: { items: [], truncated: false },
          color: { items: [], truncated: false },
          fit: { items: [], truncated: false },
          materialGroup: { items: [], truncated: false },
          occasion: { items: [], truncated: false },
        };
        for (const kind of ['size', 'color', 'fit', 'materialGroup', 'occasion'] as const) {
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
