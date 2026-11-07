import { randomBytes, randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { writePrivateFile } from '../infrastructure/security/private-file.js';
import { createDataSource, databaseUrl } from '../infrastructure/database/data-source.js';
import { PasswordService } from '../modules/identity/password.service.js';
import { AuditService } from '../modules/audit/audit.service.js';

const source = createDataSource();
const artifact = '.local-setup/owner-access.json';
try {
  if (
    new URL(databaseUrl(process.env, 'MIGRATION_DATABASE_URL')).pathname !==
    '/commerce_platform_dev'
  )
    throw new Error('Development database only');
  let exists = true;
  try {
    await access(artifact);
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
      throw error;
    exists = false;
  }
  if (exists) throw new Error('Existing owner artifact');
  await source.initialize();
  const password = randomBytes(24).toString('base64url');
  const hash = await new PasswordService().hash(password);
  await source.transaction(async (manager) => {
    await manager.query("SELECT pg_advisory_xact_lock(hashtext('commerce.owner.bootstrap'))");
    const rows: { total: number }[] = await manager.query(
      'SELECT count(*)::int AS total FROM staff_users',
    );
    if (rows[0]!.total !== 0) throw new Error('Staff already exists; refusing duplicate bootstrap');
    // Write before SQL commit: on an interrupted commit preserve this artifact for inspection.
    await writePrivateFile(
      artifact,
      JSON.stringify({ username: 'owner', password, mustChangePassword: true }, null, 2),
    );
    const users: { id: string }[] = await manager.query(
      "INSERT INTO staff_users(username,display_name,password_hash) VALUES ('owner','Owner',$1) RETURNING id",
      [hash],
    );
    const id = users[0]!.id;
    await manager.query(
      "INSERT INTO staff_role_assignments(staff_id,role_id) SELECT $1,id FROM roles WHERE code='owner'",
      [id],
    );
    await new AuditService().append(manager, id, 'staff.bootstrap', randomUUID());
  });
  console.info(
    'Owner created. One-time login is in .local-setup/owner-access.json; password change is mandatory.',
  );
} catch {
  console.error(
    'Owner bootstrap refused or failed. Inspect existing staff/artifact state; no credentials logged or overwritten.',
  );
  process.exitCode = 1;
} finally {
  if (source.isInitialized) await source.destroy();
}
