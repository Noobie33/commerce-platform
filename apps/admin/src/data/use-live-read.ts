import { liveConnected } from './live-channel';
import { useEffect, useMemo, useRef, useState } from 'react';
import { LiveRead } from './live-read';
import type { ReadEnvironment, ReadOptions } from './live-read';
export function useLiveRead<T>(
  load: (options: ReadOptions) => Promise<T>,
  {
    enabled = true,
    paused = false,
    revision = 0,
    topics = [],
    allowInDialog = false,
  }: {
    enabled?: boolean;
    paused?: boolean;
    revision?: number;
    topics?: readonly string[];
    allowInDialog?: boolean;
  } = {},
) {
  const topicKey = topics.join(',');
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const resource = useMemo(() => {
    const env: ReadEnvironment = {
      now: () => Date.now(),
      live: liveConnected,
      after: (fn, ms) => {
        const id = window.setTimeout(fn, ms);
        return () => window.clearTimeout(id);
      },
      onInvalidate: (fn) => {
        const changed = (event: Event) => {
          const topics = (event as CustomEvent<string[]>).detail;
          if (topics.includes('all') || topics.some((topic) => topicKey.split(',').includes(topic)))
            fn();
        };
        window.addEventListener('commerce:data-change', changed);
        return () => window.removeEventListener('commerce:data-change', changed);
      },
      visible: () => document.visibilityState === 'visible',
      online: () => navigator.onLine,
      paused: () =>
        pausedRef.current || (!allowInDialog && !!document.querySelector('dialog[open]')),
      every: (fn, ms) => {
        const id = window.setInterval(fn, ms);
        return () => window.clearInterval(id);
      },
      onWake: (fn) => {
        window.addEventListener('commerce:live-state', fn);
        window.addEventListener('focus', fn);
        window.addEventListener('online', fn);
        window.addEventListener('offline', fn);
        document.addEventListener('visibilitychange', fn);
        return () => {
          window.removeEventListener('commerce:live-state', fn);
          window.removeEventListener('focus', fn);
          window.removeEventListener('online', fn);
          window.removeEventListener('offline', fn);
          document.removeEventListener('visibilitychange', fn);
        };
      },
    };
    return new LiveRead(load, env, enabled);
  }, [load, enabled, topicKey, allowInDialog]);
  const [observed, setObserved] = useState({ resource, state: resource.snapshot() });
  const previous = useRef({ resource, revision });
  useEffect(() => {
    const unsubscribe = resource.subscribe((state) => setObserved({ resource, state }));
    resource.start();
    setObserved({ resource, state: resource.snapshot() });
    return () => {
      unsubscribe();
      resource.stop();
    };
  }, [resource]);
  useEffect(() => {
    if (previous.current.resource === resource && previous.current.revision !== revision)
      resource.refresh();
    previous.current = { resource, revision };
  }, [resource, revision]);
  useEffect(() => {
    resource.wake();
  }, [resource, paused]);
  return {
    ...(observed.resource === resource ? observed.state : resource.snapshot()),
    refresh: resource.refresh,
  };
}
