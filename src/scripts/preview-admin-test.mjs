import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../../dist/src/app.js';
import {
  createDataSource,
  databaseUrl,
} from '../../dist/src/infrastructure/database/data-source.js';
import { PasswordService } from '../../dist/src/modules/identity/password.service.js';

if (
  new URL(databaseUrl(process.env, 'MIGRATION_DATABASE_URL')).pathname !== '/commerce_platform_test'
)
  throw new Error('Dedicated test database only');
const source = createDataSource();
await source.initialize();
const id = randomUUID();
const username = 'ui_preview_' + randomBytes(4).toString('hex');
const password = 'Disposable UI preview password 2026!';
const hash = await new PasswordService().hash(password);
await source.transaction(async (manager) => {
  await manager.query(
    'INSERT INTO staff_users(id,username,display_name,password_hash,must_change_password) VALUES ($1,$2,$3,$4,true)',
    [id, username, 'Preview Staff', hash],
  );
  await manager.query(
    "INSERT INTO staff_role_assignments(staff_id,role_id) SELECT $1,id FROM roles WHERE code='owner'",
    [id],
  );
});
const app = await createApp({ ...process.env, STAFF_ORIGIN: 'http://localhost:4001' });
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    await app.close();
    await source.transaction(async (manager) => {
      await manager.query('DELETE FROM audit_events WHERE actor_id=$1', [id]);
      await manager.query('DELETE FROM staff_sessions WHERE staff_id=$1', [id]);
      await manager.query('DELETE FROM staff_role_assignments WHERE staff_id=$1', [id]);
      await manager.query('DELETE FROM staff_users WHERE id=$1', [id]);
      // Only this disposable account's rate bucket is removed; shared IP limits remain.
    });
  } finally {
    await source.destroy();
    process.exit(0);
  }
}
try {
  await app.listen(4001, '127.0.0.1');
  console.info('Disposable UI QA ready: http://localhost:4001/admin; username=' + username);
  console.info(
    'stdin controls: ready (simulate completed onboarding), stop (close and remove fixture).',
  );
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (chunk) => {
    const command = String(chunk).trim();
    if (command === 'ready') {
      await source.query('UPDATE staff_users SET must_change_password=false WHERE id=$1', [id]);
      console.info('Disposable fixture onboarding state updated.');
    }
    if (command === 'stop') await stop();
  });
  process.stdin.resume();
} catch {
  await stop();
}
