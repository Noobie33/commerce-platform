import { MobileMenu } from './mobile-menu';
import Link from 'next/link';
import Form from 'next/form';
import type { Category } from '../lib/catalog-contract';
import { Icon } from './icon';
export function Header({ brand, categories }: { brand: string; categories: Category[] }) {
  const roots = categories.filter((c) => c.parentSlug === null);
  return (
    <>
      <div className="preview-strip">
        Store preview <span aria-hidden="true">/</span> Online ordering is not open yet
      </div>
      <header className="store-header">
        <div className="header-main">
          <Link href="/" prefetch={false} className="wordmark" aria-label={brand + ' home'}>
            {brand}
            <span className="wordmark-dot" />
          </Link>
          <nav className="desktop-nav" aria-label="Main navigation">
            <Link href="/shop" prefetch={false}>
              Shop all
            </Link>
            {roots.slice(0, 5).map((c) => (
              <Link key={c.id} href={'/shop?category=' + c.slug} prefetch={false}>
                {c.name}
              </Link>
            ))}
          </nav>
          <Form action="/shop" className="header-search" role="search">
            <label className="sr-only" htmlFor="store-search">
              Search products
            </label>
            <input
              id="store-search"
              name="q"
              type="search"
              maxLength={80}
              placeholder="Find your next favourite"
            />
            <button type="submit" aria-label="Search products">
              <Icon name="search" />
            </button>
          </Form>
          <MobileMenu categories={categories} />
        </div>
      </header>
    </>
  );
}
