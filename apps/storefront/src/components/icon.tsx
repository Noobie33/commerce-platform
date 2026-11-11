export function Icon({
  name,
}: {
  name: 'search' | 'arrow' | 'menu' | 'close' | 'play' | 'chevron' | 'filter';
}) {
  const paths = {
    filter: 'M3 6h5m4 0h9M3 12h11m4 0h3M3 18h3m4 0h11M8 3v6m6 0v6M6 15v6',
    search: 'M21 21l-5-5m2-6a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    arrow: 'M4 12h16m-6-6 6 6-6 6',
    menu: 'M3 6h18M3 12h18M3 18h18',
    close: 'm5 5 14 14M19 5 5 19',
    play: 'm8 4 12 8-12 8Z',
    chevron: 'm9 5 7 7-7 7',
  };
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
