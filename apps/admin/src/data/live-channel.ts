import { LiveConnection } from './live-connection';
let connected = false;
export const liveConnected = () => connected;
export function startStaffUpdates(expired: () => void) {
  const connection = new LiveConnection(
    () => new EventSource('/api/v1/staff/events'),
    (value) => {
      if (value !== connected) {
        connected = value;
        window.dispatchEvent(new Event('commerce:live-state'));
      }
    },
    (topics) => window.dispatchEvent(new CustomEvent('commerce:data-change', { detail: topics })),
    expired,
  );
  connection.start();
  return () => connection.stop();
}
