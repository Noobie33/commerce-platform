export default function Loading() {
  return (
    <main
      id="main-content"
      className="loading-page"
      aria-busy="true"
      aria-label="Loading the collection"
    >
      <div className="loading-line" />
      <div className="loading-grid">
        {Array.from({ length: 4 }, (_, i) => (
          <div className="loading-card" key={i} />
        ))}
      </div>
      <p role="status">Bringing the collection into view...</p>
    </main>
  );
}
