import { jsonLd, productSelection } from '../../../lib/catalog-contract';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProduct, storeSettings } from '../../../lib/catalog-api';
import { ProductExperience } from '../../../components/product-experience';
import type { SearchValues } from '../../../lib/store-query';
export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<SearchValues> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await getProduct((await params).slug);
  if (!p) return { title: 'Product unavailable' };
  return {
    title: p.seo.title || p.name,
    description: p.seo.description || p.description,
    alternates: { canonical: storeSettings().site + '/products/' + p.slug },
    openGraph: {
      title: p.name,
      description: p.description,
      images: [
        {
          url: storeSettings().site + p.gallery[0]!.url,
          width: p.gallery[0]!.width,
          height: p.gallery[0]!.height,
          alt: p.gallery[0]!.label,
        },
      ],
    },
  };
}
export default async function ProductPage({ params, searchParams }: Props) {
  const p = await getProduct((await params).slug);
  if (!p) notFound();
  const initial = productSelection(p, await searchParams);
  const prices = p.variants.map((v) => BigInt(v.priceMinor)),
    decimal = (n: bigint) => (n / 100n).toString() + '.' + (n % 100n).toString().padStart(2, '0'),
    structured = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: p.name,
      sku: p.styleCode,
      description: p.description,
      image: p.gallery.filter((m) => m.kind === 'photo').map((m) => storeSettings().site + m.url),
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: 'BDT',
        lowPrice: decimal(prices.reduce((a, b) => (a < b ? a : b))),
        highPrice: decimal(prices.reduce((a, b) => (a > b ? a : b))),
        offerCount: p.variants.length,
      },
    },
    json = jsonLd(structured);
  return (
    <main id="main-content" className="product-page">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/" prefetch={false}>
          Home
        </Link>
        {p.categoryPath.map((c) => (
          <span key={c.id}>
            <span aria-hidden="true"> / </span>
            <Link href={'/shop?category=' + c.slug} prefetch={false}>
              {c.name}
            </Link>
          </span>
        ))}
        <span aria-hidden="true">/</span>
        <span>{p.name}</span>
      </nav>
      <ProductExperience key={p.releaseVersion} product={p} initialSelection={initial} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
    </main>
  );
}
