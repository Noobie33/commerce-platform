import { useEffect, useRef, useState } from 'react';
import { StaffApi, ApiError } from '../api';
import { Avatar } from '../avatar';
import type { Profile } from '../types';
export function ProfilePhoto({
  api,
  user,
  onRefresh,
}: {
  api: StaffApi;
  user: Profile;
  onRefresh: () => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!file) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function save(remove = false) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (remove) await api.removeProfilePhoto(user.profilePhoto?.version ?? 0);
      else if (file) await api.saveProfilePhoto(file, user.profilePhoto?.version ?? 0);
      else return;
      setFile(null);
      if (input.current) input.current.value = '';
      await onRefresh();
      setNotice(remove ? 'Profile photo removed.' : 'Profile photo updated.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to change your photo.');
      if (e instanceof ApiError && e.status === 409) await onRefresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="profile-photo-editor">
      {preview ? (
        <span className="avatar avatar-large">
          <img src={preview} alt="Selected profile photo preview" />
        </span>
      ) : (
        <Avatar user={user} className="avatar avatar-large" />
      )}
      <label className="profile-photo-label">
        Choose profile photo
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(e) => {
            setError('');
            setNotice('');
            const f = e.target.files?.[0] ?? null;
            if (
              f &&
              (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type) ||
                f.size > 5 * 1024 * 1024 ||
                f.size === 0)
            ) {
              setFile(null);
              e.target.value = '';
              setError('Choose a JPEG, PNG or WebP up to 5 MB.');
            } else setFile(f);
          }}
        />
      </label>
      <p className="muted small">
        JPEG, PNG or WebP, up to 5 MB / 16 million pixels. A square, 256px avatar is saved; the
        original profile upload is not retained.
      </p>
      <div className="profile-photo-actions">
        <button
          className="button button-primary"
          disabled={!file || busy}
          onClick={() => void save()}
        >
          {busy ? 'Saving...' : 'Save photo'}
        </button>
        {file && (
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={() => {
              setFile(null);
              if (input.current) input.current.value = '';
            }}
          >
            Cancel selection
          </button>
        )}
        {user.profilePhoto?.hasPhoto && (
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={() => void save(true)}
          >
            Remove photo
          </button>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
