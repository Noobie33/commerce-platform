export interface MediaPolicy {
  maxPhotos: number;
  maxUploadBytes: number;
  maxPixels: number;
  uploadConcurrency: number;
  receiveTimeoutSeconds: number;
  processingTimeoutSeconds: number;
  previewMaxEdge: number;
  thumbnailMaxEdge: number;
}
export function readMediaPolicy(env: NodeJS.ProcessEnv = {}): MediaPolicy {
  const integer = (name: string, fallback: number, min: number, max: number) => {
    const raw = env[name];
    if (raw === undefined) return fallback;
    if (
      !/^[1-9]\d*$/.test(raw) ||
      !Number.isSafeInteger(Number(raw)) ||
      Number(raw) < min ||
      Number(raw) > max
    )
      throw Error('Invalid ' + name);
    return Number(raw);
  };
  return {
    maxPhotos: integer('MEDIA_MAX_PHOTOS', 24, 1, 100),
    maxUploadBytes: integer('MEDIA_MAX_UPLOAD_MB', 20, 1, 50) * 1024 * 1024,
    maxPixels: integer('MEDIA_MAX_PIXELS', 64_000_000, 1_000_000, 100_000_000),
    uploadConcurrency: integer('MEDIA_UPLOAD_CONCURRENCY', 1, 1, 2),
    receiveTimeoutSeconds: 30,
    processingTimeoutSeconds: 20,
    previewMaxEdge: 2560,
    thumbnailMaxEdge: 480,
  };
}
