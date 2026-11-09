export interface ReadOptions {
  signal?: AbortSignal;
  background?: boolean;
}
export interface ReadSnapshot<T> {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: string;
  refreshError: string;
  checkedAt: number | null;
  online: boolean;
  paused: boolean;
  accessDenied: boolean;
  live: boolean;
}
export interface ReadEnvironment {
  now: () => number;
  visible: () => boolean;
  online: () => boolean;
  paused: () => boolean;
  every: (fn: () => void, ms: number) => () => void;
  onWake: (fn: () => void) => () => void;
  onInvalidate?: (fn: () => void) => () => void;
  live?: () => boolean;
  after: (fn: () => void, ms: number) => () => void;
}
// One active generation per resource. Quiet refreshes never erase its last
// successful result; changing the query creates a separate resource instead.
export class LiveRead<T> {
  private listeners = new Set<(state: ReadSnapshot<T>) => void>();
  private active = false;
  private generation = 0;
  private controller: AbortController | null = null;
  private cancelTimer: (() => void) | null = null;
  private cancelWake: (() => void) | null = null;
  private lastAttempt = -Infinity;
  private dirty = false;
  private cancelPush: (() => void) | null = null;
  private cancelPending: (() => void) | null = null;
  private state: ReadSnapshot<T>;
  constructor(
    private readonly load: (options: ReadOptions) => Promise<T>,
    private readonly env: ReadEnvironment,
    private readonly enabled = true,
    private readonly interval = 30000,
  ) {
    this.state = {
      data: null,
      loading: enabled,
      refreshing: false,
      error: '',
      refreshError: '',
      checkedAt: null,
      online: env.online(),
      paused: env.paused(),
      accessDenied: false,
      live: env.live?.() ?? false,
    };
  }
  snapshot = () => this.state;
  subscribe = (listener: (state: ReadSnapshot<T>) => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(change: Partial<ReadSnapshot<T>>) {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener(this.state);
  }
  start() {
    if (this.active) return;
    this.active = true;
    if (!this.enabled) return;
    this.cancelTimer = this.env.every(() => this.wake(), this.interval);
    this.cancelWake = this.env.onWake(() => this.wake());
    this.cancelPush = this.env.onInvalidate?.(this.invalidate) ?? null;
    if (this.env.visible() && this.env.online()) void this.run(false);
  }
  stop() {
    this.active = false;
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.cancelPending?.();
    this.cancelPush?.();
    this.cancelPending = this.cancelPush = null;
    this.cancelTimer?.();
    this.cancelWake?.();
    this.cancelTimer = this.cancelWake = null;
  }
  wake = () => {
    if (!this.active || !this.enabled) return;
    const online = this.env.online(),
      paused = this.env.paused();
    this.publish({ online, paused, live: this.env.live?.() ?? false });
    if (this.dirty) {
      this.schedule();
      return;
    }
    if (
      this.state.accessDenied ||
      !online ||
      paused ||
      !this.env.visible() ||
      this.controller ||
      this.env.now() - this.lastAttempt < 1000
    )
      return;
    void this.run(true);
  };
  invalidate = () => {
    if (!this.active || !this.enabled || this.state.accessDenied) return;
    this.dirty = true;
    this.schedule();
  };
  private schedule() {
    if (
      !this.active ||
      !this.dirty ||
      this.state.accessDenied ||
      this.controller ||
      this.cancelPending ||
      !this.env.visible() ||
      !this.env.online() ||
      this.env.paused()
    )
      return;
    this.cancelPending = this.env.after(
      () => {
        this.cancelPending = null;
        if (
          !this.active ||
          !this.dirty ||
          this.controller ||
          !this.env.visible() ||
          !this.env.online() ||
          this.env.paused()
        )
          return;
        void this.run(true);
      },
      Math.max(100, this.lastAttempt + 250 - this.env.now()),
    );
  }
  refresh = () => {
    if (this.active && this.enabled) void this.run(false);
  };
  private async run(background: boolean) {
    if (!this.env.online()) {
      this.publish({ online: false });
      return;
    }
    if (background && this.controller) return;
    this.dirty = false;
    // An explicit retry/save invalidation supersedes any older in-flight read.
    this.controller?.abort();
    const controller = new AbortController(),
      ticket = ++this.generation;
    this.controller = controller;
    this.lastAttempt = this.env.now();
    this.publish({
      loading: this.state.data === null,
      refreshing: this.state.data !== null,
      error: '',
      refreshError: '',
      online: true,
      paused: this.env.paused(),
      accessDenied: false,
    });
    try {
      const data = await this.load({ signal: controller.signal, background });
      if (this.active && ticket === this.generation)
        this.publish({ data, error: '', refreshError: '', checkedAt: this.env.now() });
    } catch (error) {
      if (this.active && ticket === this.generation && !controller.signal.aborted) {
        const message = error instanceof Error ? error.message : 'Unable to update this view.';
        const status =
          error && typeof error === 'object' && 'status' in error ? error.status : null;
        if (status === 401 || status === 403)
          this.publish({
            data: null,
            checkedAt: null,
            error: message,
            refreshError: '',
            accessDenied: true,
          });
        else
          this.publish(this.state.data === null ? { error: message } : { refreshError: message });
      }
    } finally {
      if (this.active && ticket === this.generation) {
        this.controller = null;
        this.publish({ loading: false, refreshing: false });
        this.schedule();
      }
    }
  }
}
