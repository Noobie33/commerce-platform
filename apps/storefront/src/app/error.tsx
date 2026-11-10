'use client';
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="main-content" className="message-page">
      <p className="eyebrow">A MOMENT, PLEASE</p>
      <h1>We couldn't load the collection.</h1>
      <p>Please try again in a moment.</p>
      <button className="button button-dark" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
