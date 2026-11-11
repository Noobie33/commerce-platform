export function accountMode(env: NodeJS.ProcessEnv): 'closed' | 'preview' {
  const mode = env.CUSTOMER_ACCOUNT_MODE ?? 'closed';
  if (mode === 'closed') return mode;
  if (mode !== 'preview' || env.NODE_ENV === 'production')
    throw Error('Customer sign-in preview requires a local nonproduction environment');
  const u = new URL(env.DATABASE_URL ?? '');
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) ||
    !['/commerce_platform_dev', '/commerce_platform_test', '/commerce_platform_demo'].includes(
      u.pathname,
    )
  )
    throw Error('Customer preview database target is not allowed');
  return 'preview';
}
