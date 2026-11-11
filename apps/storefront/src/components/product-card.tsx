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
            src={p.photo.thumbnailUrl.replace(/\/thumbnail$/, '/image')}
            srcSet={
              p.photo.width > 480
                ? p.photo.thumbnailUrl +
                  ' 480w, ' +
                  p.photo.thumbnailUrl.replace(/\/thumbnail$/, '/image') +
                  ' ' +
                  p.photo.width +
                  'w'
                : undefined
            }
            sizes="(max-width: 700px) 50vw, (max-width: 1100px) 33vw, 25vw"
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
        </div>
      </Link>
    </article>
  );
}
