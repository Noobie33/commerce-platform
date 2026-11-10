import Link from 'next/link';
import type { Card } from '../lib/catalog-contract';
import { money } from '../lib/catalog-contract';
export function ProductCard({
  product: p,
  priority = false,
  selection = {},
}: {
  product: Card;
  priority?: boolean;
  selection?: Record<string, string>;
}) {
  const options = new URLSearchParams();
  for (const k of ['color', 'size']) if (selection[k]) options.set(k, selection[k]);
  const href = '/products/' + p.slug + (options.size ? '?' + options.toString() : '');
  return (
    <article className="product-card">
      <Link href={href} prefetch={false} className="product-card-link">
        <div className="card-image">
          <img
            src={p.photo.thumbnailUrl}
            alt={p.photo.alt}
            width={p.photo.width}
            height={p.photo.height}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
          />
        </div>
        <div className="card-caption">
          <h3>{p.name}</h3>
          <p>
            {p.matchingPriceMinMinor !== p.matchingPriceMaxMinor ? 'From ' : ''}
            {money(p.matchingPriceMinMinor)}
          </p>
          <span className="card-explore" aria-hidden="true">
            View piece &rarr;
          </span>
        </div>
      </Link>
    </article>
  );
}
