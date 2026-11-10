import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
export class MediaProcessError extends Error {
  constructor(readonly reason: 'start' | 'exit' | 'timeout' | 'output' | 'abort') {
    super('Media process failed: ' + reason);
  }
}
export async function runMediaProcess(
  executable: string,
  args: readonly string[],
  timeoutMs: number,
  maxOutputBytes = 262144,
  signal?: AbortSignal,
  environment?: NodeJS.ProcessEnv,
): Promise<string> {
  if (
    !isAbsolute(executable) ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    !Number.isInteger(maxOutputBytes) ||
    maxOutputBytes < 1
  )
    throw Error('Invalid media process configuration');
  if (signal?.aborted) throw new MediaProcessError('abort');
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(environment ? { env: environment } : {}),
    });
    let stdoutBytes = 0,
      stderrBytes = 0;
    const chunks: Buffer[] = [];
    let failure: MediaProcessError | undefined;
    const stop = (reason: 'timeout' | 'output' | 'abort') => {
      if (!failure) {
        failure = new MediaProcessError(reason);
        child.kill('SIGKILL');
      }
    };
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    timer.unref();
    const abort = () => stop('abort');
    signal?.addEventListener('abort', abort, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    };
    child.stdout.on('data', (b: Buffer) => {
      stdoutBytes += b.length;
      if (stdoutBytes > maxOutputBytes) stop('output');
      else if (!failure) chunks.push(b);
    });
    child.stderr.on('data', (b: Buffer) => {
      stderrBytes += b.length;
      if (stderrBytes > maxOutputBytes) stop('output');
    });
    child.once('error', () => {
      cleanup();
      reject(new MediaProcessError('start'));
    });
    child.once('close', (code) => {
      cleanup();
      if (failure) reject(failure);
      else if (code !== 0) reject(new MediaProcessError('exit'));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    // Abort can race with spawn/listener registration.
    if (signal?.aborted) abort();
  });
}
