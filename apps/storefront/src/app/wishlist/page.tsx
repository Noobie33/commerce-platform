import type { Metadata } from 'next';
import { SavedProductsPage } from '../../components/saved-products-page';
export const metadata: Metadata = { title: 'Wishlist' };
export default function Wishlist() {
  return <SavedProductsPage />;
}
