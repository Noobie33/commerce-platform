'use client';
import { useEffect, useRef, useState } from 'react';
import { Icon } from './icon';
export function ProductRail({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null),
    [edges, setEdges] = useState({ start: true, end: true, overflow: false });
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const update = () => {
      const inset = Number.parseFloat(getComputedStyle(v).paddingLeft) || 0,
        next = {
          start: v.scrollLeft <= inset + 2,
          end: v.scrollLeft + v.clientWidth >= v.scrollWidth - 2,
          overflow: v.scrollWidth > v.clientWidth + 2,
        };
      setEdges((old) =>
        old.start === next.start && old.end === next.end && old.overflow === next.overflow
          ? old
          : next,
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(v);
    v.addEventListener('scroll', update, { passive: true });
    return () => {
      ro.disconnect();
      v.removeEventListener('scroll', update);
    };
  }, []);
  const move = (sign: number) => {
    const v = ref.current;
    if (v)
      v.scrollBy({
        left: sign * v.clientWidth * 0.85,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
  };
  return (
    <section className="related-products" aria-label="Similar products">
      <h2>SIMILAR PRODUCTS</h2>
      <div
        ref={ref}
        className="related-product-rail"
        tabIndex={0}
        role="region"
        aria-label="Similar product cards"
      >
        {children}
      </div>
      <div
        className="related-product-controls"
        style={{ visibility: edges.overflow ? 'visible' : 'hidden' }}
        aria-hidden={!edges.overflow}
      >
        <button
          type="button"
          className="icon-button previous-related"
          aria-label="Previous similar products"
          disabled={edges.start}
          onClick={() => move(-1)}
        >
          <Icon name="chevron" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Next similar products"
          disabled={edges.end}
          onClick={() => move(1)}
        >
          <Icon name="chevron" />
        </button>
      </div>
    </section>
  );
}
