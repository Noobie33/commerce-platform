import type { Metadata } from 'next';
import Link from 'next/link';
import { getBrowse, getNavigation, CatalogError } from '../../lib/catalog-api';
import { shopQuery, shopLink, StoreQueryError } from '../../lib/store-query';
import type { SearchValues } from '../../lib/store-query';
import { Filters } from '../../components/filters';
import { ProductCard } from '../../components/product-card';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Explore the collection' };
export default async function Shop({ searchParams }: { searchParams: Promise<SearchValues> }) {
  let query;
  try {
    query = shopQuery(await searchParams);
  } catch (e) {
    if (!(e instanceof StoreQueryError)) throw e;
    return (
      <main id="main-content" className="message-page">
        <p className="eyebrow">LET'S FIND YOUR EDIT</p>
        <h1>Check your filters.</h1>
        <p>{e.message}</p>
        <Link href="/shop" prefetch={false} className="button button-dark">
          Clear filters
        </Link>
      </main>
    );
  }
  let view;
  try {
    view = await getBrowse(query.api);
  } catch (e) {
    if (!(e instanceof CatalogError) || e.status !== 400) throw e;
    return (
      <main id="main-content" className="message-page">
        <h1>Those filters aren't available.</h1>
        <p>Choose a different search or explore the full collection.</p>
        <Link href="/shop" prefetch={false} className="button button-dark">
          Explore all
        </Link>
      </main>
    );
  }
  const categories = await getNavigation(),
    category = categories.find((c) => c.slug === query.values.category);
  return (
    <main id="main-content" className="shop-page">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/" prefetch={false}>
          Home
        </Link>
        <span>/</span>
        <span>{category?.name ?? 'The collection'}</span>
      </nav>
      <div className="shop-heading">
        <div>
          <p className="eyebrow">FIND YOUR EVERYDAY</p>
          <h1>{query.values.q ? 'Search results' : (category?.name ?? 'The collection')}</h1>
          {query.values.q && <p>For &ldquo;{query.values.q}&rdquo;</p>}
        </div>
        <p className="result-count">
          {view.total} {view.total === 1 ? 'piece' : 'pieces'}
        </p>
      </div>
      <div className="shop-layout">
        <Filters
          key={JSON.stringify(query.values)}
          view={view}
          categories={categories}
          values={query.values}
        />
        <section className="shop-results" aria-label="Product collection">
          {Object.entries(query.values).filter(([k]) => !['sort', 'page'].includes(k)).length >
            0 && (
            <div className="active-filters" aria-label="Active filters">
              {Object.entries(query.values)
                .filter(([k]) => !['sort', 'page'].includes(k))
                .map(([k, v]) => (
                  <Link
                    href={shopLink(query.values, { [k]: null, page: null })}
                    prefetch={false}
                    key={k}
                    aria-label={'Remove ' + k + ' filter'}
                  >
                    {v.replaceAll('_', ' ')} <span aria-hidden="true">&times;</span>
                  </Link>
                ))}
            </div>
          )}
          {view.items.length ? (
            <div className="shop-product-grid">
              {view.items.map((p, i) => (
                <ProductCard
                  key={p.productId}
                  product={p}
                  priority={i < 3}
                  selection={query.values}
                />
              ))}
            </div>
          ) : (
            <div className="collection-empty">
              <p className="eyebrow">ROOM FOR DISCOVERY</p>
              <h2>
                {Object.keys(query.values).length
                  ? 'No pieces match this edit.'
                  : 'The collection is taking shape.'}
              </h2>
              <p>
                {Object.keys(query.values).length
                  ? 'Try changing a filter or explore the full collection.'
                  : 'Discover the pieces here as they arrive.'}
              </p>
              {Object.keys(query.values).length > 0 && (
                <Link href="/shop" prefetch={false} className="text-link">
                  Explore all pieces &rarr;
                </Link>
              )}
            </div>
          )}
          <nav className="pagination" aria-label="Collection pages">
            {view.page > 1 ? (
              <Link href={shopLink(query.values, { page: String(view.page - 1) })} prefetch={false}>
                Previous
              </Link>
            ) : (
              <span />
            )}
            <span>Page {view.page}</span>
            {view.hasMore ? (
              <Link href={shopLink(query.values, { page: String(view.page + 1) })} prefetch={false}>
                Next &rarr;
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </section>
      </div>
    </main>
  );
}
