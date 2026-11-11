export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

export interface AuthConfig {
  demo?: boolean;
  origin: string;
  cookieName: string;
  secure: boolean;
}

export function readAuthConfig(env: NodeJS.ProcessEnv): AuthConfig {
  const secure = env.NODE_ENV === 'production';
  if (
    env.DEMO_MODE === '1' &&
    (secure ||
      new URL(env.DATABASE_URL ?? 'postgresql://none@localhost/none').pathname !==
        '/commerce_platform_demo')
  )
    throw Error('Demo mode requires its own local demo database');
  const origin = env.STAFF_ORIGIN ?? 'http://127.0.0.1:4000';
  try {
    const url = new URL(origin);
    if (
      url.origin !== origin ||
      !['http:', 'https:'].includes(url.protocol) ||
      (secure && url.protocol !== 'https:')
    )
      throw new Error();
  } catch {
    throw new Error('STAFF_ORIGIN must be a single valid origin; production requires HTTPS');
  }
  return {
    demo: env.DEMO_MODE === '1',
    origin,
    secure,
    cookieName:
      env.DEMO_MODE === '1'
        ? 'commerce_demo_session'
        : secure
          ? '__Host-commerce_session'
          : 'commerce_session',
  };
}
