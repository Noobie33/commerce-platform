import Link from 'next/link';
export default function Missing() {
  return (
    <main id="main-content" className="message-page">
      <p className="eyebrow">NOT AVAILABLE</p>
      <h1>This piece is currently unavailable.</h1>
      <p>It may have moved or is no longer part of the current collection.</p>
      <Link href="/shop" prefetch={false} className="button button-dark">
        Explore the collection
      </Link>
    </main>
  );
}
