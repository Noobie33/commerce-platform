import type { ReadSnapshot } from './live-read';
import './read-status.css';
export function ReadStatus({ read }: { read: ReadSnapshot<unknown> }) {
  const time =
    read.checkedAt !== null
      ? new Date(read.checkedAt).toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Dhaka',
        })
      : null;
  return (
    <div className={'read-status' + (read.refreshError ? ' read-status-warning' : '')}>
      <span>
        {read.accessDenied
          ? 'Access changed; use Refresh to check again'
          : !read.online
            ? 'Offline — automatic updates paused'
            : read.paused
              ? 'Automatic updates paused while editing or viewing a record'
              : read.refreshing
                ? 'Checking for updates…'
                : read.live
                  ? 'Live updates connected'
                  : 'Live updates reconnecting; automatic checks every 30 seconds'}
        {time ? ' · Last checked ' + time + ' (Dhaka)' : ''}
      </span>
      {read.refreshError && (
        <span role="status">
          Could not update. Showing the last loaded data; use Refresh to retry.
        </span>
      )}
    </div>
  );
}
