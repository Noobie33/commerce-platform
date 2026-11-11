import { getRelated } from '../lib/catalog-api';
import { ProductCard } from './product-card';
import { ProductRail } from './product-rail';
export async function RelatedProducts({ slug }: { slug: string }) {
  const items = await getRelated(slug);
  if (!items.length) return null;
  return (
    <ProductRail>
      {items.map((p) => (
        <ProductCard key={p.productId} product={p} />
      ))}
    </ProductRail>
  );
}
