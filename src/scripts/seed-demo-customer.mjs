import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  createDataSource,
  databaseUrl,
} from '../../dist/src/infrastructure/database/data-source.js';
import { PasswordService } from '../../dist/src/modules/identity/password.service.js';
if (
  new URL(databaseUrl(process.env, 'MIGRATION_DATABASE_URL')).pathname !==
    '/commerce_platform_demo' ||
  process.env.CUSTOMER_ACCOUNT_MODE !== 'preview' ||
  process.env.NODE_ENV === 'production'
)
  throw Error('Separate local customer demo required');
const db = createDataSource(),
  file = '.local-setup/demo-customer-login.txt',
  email = 'demo.customer@example.invalid',
  passwords = new PasswordService();
try {
  await db.initialize();
  let saved;
  try {
    saved = await readFile(file, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const [old] = await db.query(
    'SELECT email,password_hash,is_active FROM store_customer_accounts WHERE email=$1',
    [email],
  );
  if (old && !saved)
    throw Error('Existing demo customer has no local credential file; refused reset');
  let password = saved?.match(/^Password: (.+)$/m)?.[1];
  if (saved && (!password || !saved.includes('Email: ' + email)))
    throw Error('Existing demo customer configuration requires inspection');
  if (old) {
    if (!old.is_active || !(await passwords.verify(password, old.password_hash)))
      throw Error('Existing demo login differs; refused overwrite');
    console.log('Existing sample customer retained; no password reset.');
  } else {
    if (!password) {
      password = randomBytes(24).toString('base64url');
      await writeFile(
        file,
        'Local customer demo only\nAddress: http://127.0.0.1:3100/account\nEmail: ' +
          email +
          '\nPassword: ' +
          password +
          '\n',
        { flag: 'wx', mode: 0o600 },
      );
    }
    await db.query(
      "INSERT INTO store_customer_accounts(id,email,display_name,password_hash,is_active)VALUES($1,$2,'Demo customer',$3,true)",
      [randomUUID(), email, await passwords.hash(password)],
    );
    console.log(
      'Prepared one fictional customer account. Local sign-in details saved; secrets not printed.',
    );
  }
} catch {
  console.error('Customer demo preparation stopped; existing data and credentials retained.');
  process.exitCode = 1;
} finally {
  if (db.isInitialized) await db.destroy();
}
