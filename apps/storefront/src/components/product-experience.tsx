'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import type { Media, Product } from '../lib/catalog-contract';
import { money } from '../lib/catalog-contract';
import { Icon } from './icon';
function Gallery({
  media,
  onUnavailable,
}: {
  media: Media[];
  onUnavailable?: (() => void) | undefined;
}) {
  const [index, setIndex] = useState(0),
    [error, setError] = useState(false),
    video = useRef<HTMLVideoElement>(null),
    buttons = useRef<(HTMLButtonElement | null)[]>([]),
    refreshed = useRef(false),
    router = useRouter(),
    signature = media.map((x) => x.id).join('|'),
    item = media[index] ?? media[0]!;
  useEffect(() => {
    setIndex(0);
    setError(false);
    refreshed.current = false;
  }, [signature]);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const pause = () => {
        if (document.visibilityState !== 'visible') v.pause();
      },
      observer = new IntersectionObserver(([entry]) => {
        if (entry && !entry.isIntersecting) v.pause();
      });
    observer.observe(v);
    document.addEventListener('visibilitychange', pause);
    return () => {
      v.pause();
      observer.disconnect();
      document.removeEventListener('visibilitychange', pause);
    };
  }, [item.id]);
  function select(i: number, focus = false) {
    video.current?.pause();
    setError(false);
    setIndex(i);
    if (focus) buttons.current[i]?.focus();
  }
  function unavailable() {
    setError(true);
    if (!refreshed.current) {
      refreshed.current = true;
      if (onUnavailable) onUnavailable();
      else router.refresh();
    }
  }
  return (
    <section className="product-gallery" aria-label="Product photos and videos">
      <div className="media-shell">
        <div
          className="native-media"
          style={{ '--media-ratio': String(item.width / item.height) } as CSSProperties}
        >
          {error ? (
            <p role="status">This media is currently unavailable.</p>
          ) : item.kind === 'video' ? (
            <video
              ref={video}
              key={item.url}
              controls
              playsInline
              preload="none"
              poster={item.thumbnailUrl}
              width={item.width}
              height={item.height}
              aria-label={item.label}
              onError={unavailable}
            >
              <source src={item.url} type="video/mp4" />
            </video>
          ) : (
            <img
              key={item.url}
              src={item.url}
              alt={item.label}
              width={item.width}
              height={item.height}
              fetchPriority="high"
              onError={unavailable}
            />
          )}
        </div>
      </div>
      <div
        className="media-thumbnails"
        role="group"
        aria-label="Choose a product view"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            select((index + (e.key === 'ArrowRight' ? 1 : media.length - 1)) % media.length, true);
          }
          if (e.key === 'Home') {
            e.preventDefault();
            select(0, true);
          }
          if (e.key === 'End') {
            e.preventDefault();
            select(media.length - 1, true);
          }
        }}
      >
        {media.map((m, i) => (
          <button
            type="button"
            key={m.id}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            aria-label={(m.kind === 'video' ? 'Play video: ' : 'View photo: ') + m.label}
            aria-pressed={i === index}
            onClick={() => select(i)}
          >
            <img src={m.thumbnailUrl} alt="" width={m.width} height={m.height} loading="lazy" />
            {m.kind === 'video' && (
              <span className="thumbnail-play">
                <Icon name="play" />
              </span>
            )}
          </button>
        ))}
      </div>
      <p className="media-caption">{item.label}</p>
    </section>
  );
}
export function ProductExperience({
  product: p,
  initialSelection = {},
  preview = false,
  onViewDetails,
  onMediaUnavailable,
  onSelectionChange,
}: {
  product: Product;
  initialSelection?: Record<string, string>;
  preview?: boolean;
  onViewDetails?: () => void;
  onMediaUnavailable?: () => void;
  onSelectionChange?: (selection: Record<string, string>) => void;
}) {
  const [selection, setSelection] = useState(initialSelection);
  const Title = preview ? 'h2' : 'h1';
  const detailQuery = new URLSearchParams();
  for (const k of ['size', 'color']) if (selection[k]) detailQuery.set(k, selection[k]);
  const detailsHref =
    '/products/' + p.slug + (detailQuery.size ? '?' + detailQuery.toString() : '');
  const keys = [...new Set(p.variants.flatMap((v) => Object.keys(v.attributes)))],
    matches = (attrs: Record<string, string>, s: Record<string, string>) =>
      Object.entries(s).every(([k, v]) => attrs[k] === v),
    candidates = p.variants.filter((v) => matches(v.attributes, selection)),
    selected = p.variants.find((v) => keys.every((k) => selection[k] === v.attributes[k])),
    prices = (candidates.length ? candidates : p.variants).map((v) => BigInt(v.priceMinor)),
    low = prices.reduce((a, b) => (a < b ? a : b)),
    high = prices.reduce((a, b) => (a > b ? a : b)),
    media = p.gallery.filter((m) => !selected || !m.variantId || m.variantId === selected.id);
  function choose(k: string, value: string) {
    const next = { ...selection, [k]: value },
      valid = p.variants.some((v) => matches(v.attributes, next)) ? next : { [k]: value };
    setSelection(valid);
    onSelectionChange?.(valid);
  }
  return (
    <div className={preview ? 'product-layout product-preview-layout' : 'product-layout'}>
      <Gallery media={media.length ? media : p.gallery} onUnavailable={onMediaUnavailable} />
      <section className="product-info">
        <Title>{p.name}</Title>
        <p className="product-price">
          {low === high
            ? money(low.toString())
            : money(low.toString()) + ' - ' + money(high.toString())}
        </p>
        <div className="product-options">
          {keys.map((k) => (
            <fieldset key={k}>
              <legend>
                {k === 'color' ? 'Colour' : k.charAt(0).toUpperCase() + k.slice(1)}
                {selection[k] && <span> / {selection[k]}</span>}
              </legend>
              <div className="option-buttons">
                {[
                  ...new Set(
                    p.variants.map((v) => v.attributes[k]).filter((x): x is string => !!x),
                  ),
                ].map((value) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={selection[k] === value}
                    onClick={() => choose(k, value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        {Object.keys(selection).length > 0 && (
          <button
            className="clear-options"
            onClick={() => {
              setSelection({});
              onSelectionChange?.({});
            }}
          >
            Clear selections
          </button>
        )}
        <dl className="product-code">
          <div>
            <dt>Product Code</dt>
            <dd>{p.styleCode}</dd>
          </div>
          {selected && (
            <div>
              <dt>SKU</dt>
              <dd>{selected.sku}</dd>
            </div>
          )}
        </dl>
        <p className="ordering-note">Online ordering is not open yet.</p>
        {!preview && (
          <>
            <details className="product-details">
              <summary>Product Description</summary>
              <p className="product-description">{p.description}</p>
            </details>
            <details className="product-details">
              <summary>Details &amp; care</summary>
              <dl>
                {Object.entries(p.specifications)
                  .filter(([, v]) => !!v)
                  .map(([k, v]) => (
                    <div key={k}>
                      <dt>{k.replace(/([A-Z])/g, ' $1').replaceAll('_', ' ')}</dt>
                      <dd>{v.replaceAll('_', ' ')}</dd>
                    </div>
                  ))}
              </dl>
            </details>
          </>
        )}
        {preview && (
          <Link
            href={detailsHref}
            prefetch={false}
            className="button button-outline view-product-details"
            onClick={() => onViewDetails?.()}
          >
            View details
          </Link>
        )}
      </section>
    </div>
  );
}
