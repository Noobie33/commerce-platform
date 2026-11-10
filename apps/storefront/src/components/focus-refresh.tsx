'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export function FocusRefresh() {
  const router = useRouter();
  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      if (document.visibilityState === 'visible' && navigator.onLine && Date.now() - last > 1500) {
        last = Date.now();
        router.refresh();
      }
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [router]);
  return null;
}
