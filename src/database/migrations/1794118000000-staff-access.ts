import type { MigrationInterface, QueryRunner } from 'typeorm';
import { staffAccessV1 } from '../staff-access-v1.js';
export class StaffAccess1794118000000 implements MigrationInterface {
  async up(r: QueryRunner) {
    if ((await r.query('SELECT version FROM app_schema_version'))[0]?.version !== 19)
      throw Error('Schema 19 required');
    const name = (await r.query('SELECT current_schema() AS name'))[0].name as string;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw Error('Unsupported schema');
    await r.query(staffAccessV1('"' + name + '"'));
  }
  async down(r: QueryRunner) {
    for (const table of [
      'staff_access_versions',
      'role_access_profiles',
      'staff_access_events',
      'staff_access_requests',
    ])
      if ((await r.query('SELECT 1 FROM ' + table + ' LIMIT 1')).length)
        throw Error('Cannot discard access history');
    await r.query(
      'DROP FUNCTION staff_access_post(uuid,uuid,uuid,jsonb),staff_access_snapshot(text,uuid),staff_access_owner(uuid);DROP TABLE staff_access_requests,staff_access_events,staff_access_versions,role_access_profiles,access_permission_policy;UPDATE app_schema_version SET version=19 WHERE singleton;',
    );
  }
}
