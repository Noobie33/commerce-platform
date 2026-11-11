import { useEffect, useState } from 'react';
import type { Profile } from './types';
export function Avatar({ user, className = 'avatar' }: { user: Profile; className?: string }) {
  const [failed, setFailed] = useState(false),
    photo = user.profilePhoto;
  useEffect(() => setFailed(false), [photo?.version, photo?.hasPhoto, user.id]);
  return (
    <span className={className}>
      {photo?.hasPhoto && !failed ? (
        <img
          src={'/api/v1/staff/me/photo/' + photo.version}
          alt=""
          onError={() => setFailed(true)}
        />
      ) : (
        user.displayName.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
