export interface PushStream {
  addEventListener(type: string, listener: (event: { data?: string }) => void): void;
  close(): void;
}
const topics = new Set(['all', 'catalog', 'customers', 'inventory', 'purchasing', 'sales', 'team']);
export class LiveConnection {
  private source: PushStream | null = null;
  constructor(
    private readonly create: () => PushStream,
    private readonly status: (connected: boolean) => void,
    private readonly invalidate: (topics: string[]) => void,
    private readonly expired: () => void,
  ) {}
  start() {
    if (this.source) return;
    let source: PushStream;
    try {
      source = this.create();
    } catch {
      this.status(false);
      return;
    }
    this.source = source;
    const active = () => this.source === source;
    source.addEventListener('ready', () => {
      if (active()) this.status(true);
    });
    for (const event of ['error', 'degraded'])
      source.addEventListener(event, () => {
        if (active()) this.status(false);
      });
    source.addEventListener('invalidate', (event) => {
      if (!active()) return;
      try {
        const data: unknown = JSON.parse(event.data ?? '');
        if (
          !data ||
          typeof data !== 'object' ||
          !('topics' in data) ||
          !Array.isArray(data.topics) ||
          data.topics.length > 7
        )
          return;
        const safe = data.topics.filter((v): v is string => typeof v === 'string' && topics.has(v));
        if (safe.length) this.invalidate([...new Set(safe)]);
      } catch {
        /* A malformed hint is never interpreted as data or executable content. */
      }
    });
    source.addEventListener('session-ended', () => {
      if (active()) {
        this.stop();
        this.expired();
      }
    });
  }
  stop() {
    const source = this.source;
    this.source = null;
    source?.close();
    this.status(false);
  }
}
