import Link from 'next/link';
import { getBrowse } from '../lib/catalog-api';
import { money, photoLink } from '../lib/catalog-contract';
import { ProductCard } from '../components/product-card';
import { Icon } from '../components/icon';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const data = await getBrowse('pageSize=12&sort=name'),
    focus = data.items[0];
  return (
    <main id="main-content">
      <section className="editorial-hero">
        <div className="hero-copy">
          <p className="eyebrow">THE EVERYDAY EDIT</p>
          <h1>
            Find your
            <br />
            <em>everyday.</em>
          </h1>
          <p className="hero-description">
            Clothing and lifestyle pieces to discover in your own rhythm.
          </p>
          <Link href="/shop" prefetch={false} className="button button-dark">
            Explore the collection <Icon name="arrow" />
          </Link>
          <div className="hero-footnote">
            <span className="fine-rule" />A little more you. Every day.
          </div>
        </div>
        <div className="hero-visual">
          {focus ? (
            <>
              <Link href={'/products/' + focus.slug} prefetch={false} className="hero-product">
                <img
                  src={photoLink(focus.photo.id, 'image')}
                  width={focus.photo.width}
                  height={focus.photo.height}
                  alt={focus.photo.alt}
                  fetchPriority="high"
                />
              </Link>
              <div className="hero-product-note">
                <span>IN FOCUS</span>
                <Link href={'/products/' + focus.slug} prefetch={false}>
                  {focus.name}
                </Link>
                <small>{money(focus.matchingPriceMinMinor)}</small>
              </div>
            </>
          ) : (
            <div className="textile-art" aria-hidden="true">
              <div className="textile-panel textile-panel-one" />
              <div className="textile-panel textile-panel-two" />
              <div className="textile-panel textile-panel-three" />
              <span>A considered wardrobe.</span>
            </div>
          )}
          <span className="hero-edge-label">CLOTHING &amp; LIFESTYLE</span>
        </div>
      </section>
      <section className="collection-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">PIECES TO DISCOVER</p>
            <h2>The collection</h2>
          </div>
          <Link href="/shop" prefetch={false} className="text-link">
            Explore all <Icon name="arrow" />
          </Link>
        </div>
        {data.items.length ? (
          <div className="home-product-grid">
            {data.items.slice(0, 8).map((p, i) => (
              <ProductCard key={p.productId} product={p} priority={i < 4} />
            ))}
          </div>
        ) : (
          <div className="collection-empty">
            <p className="eyebrow">COMING INTO VIEW</p>
            <h3>A new collection is taking shape.</h3>
            <p>Discover the pieces here as they arrive.</p>
          </div>
        )}
      </section>
      <section className="editorial-note">
        <p className="eyebrow">YOUR OWN PERSPECTIVE</p>
        <h2>
          A wardrobe that
          <br />
          <em>feels like you.</em>
        </h2>
        <Link href="/shop" prefetch={false} className="text-link">
          Discover the collection <Icon name="arrow" />
        </Link>
      </section>
    </main>
  );
}
