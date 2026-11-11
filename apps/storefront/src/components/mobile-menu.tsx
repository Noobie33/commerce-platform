'use client';
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { Icon } from './icon';
import type { Category } from '../lib/catalog-contract';
export function MobileMenu({ categories }: { categories: Category[] }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  const close = () => {
    if (ref.current) ref.current.open = false;
  };
  return (
    <details
      className="mobile-menu"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          close();
          ref.current?.querySelector('summary')?.focus();
        }
      }}
    >
      <summary aria-label="Open menu">
        <Icon name="menu" />
      </summary>
      <nav aria-label="Mobile navigation">
        <Link href="/" prefetch={false} onClick={close}>
          The edit
        </Link>
        <Link href="/shop" prefetch={false} onClick={close}>
          Shop all
        </Link>
        <Link href="/account" prefetch={false} onClick={close}>
          My account
        </Link>
        {categories
          .filter((c) => c.parentSlug === null)
          .map((c) => (
            <Link key={c.id} href={'/shop?category=' + c.slug} prefetch={false} onClick={close}>
              {c.name}
            </Link>
          ))}
      </nav>
    </details>
  );
}
