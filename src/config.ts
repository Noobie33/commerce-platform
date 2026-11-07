export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const port = Number(env.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  const mode = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(mode)) {
    throw new Error('NODE_ENV must be development, test, or production');
  }
  const host = env.HOST ?? '127.0.0.1';
  if (!host.trim()) throw new Error('HOST must not be empty');
  return { port, host, mode } as const;
}
