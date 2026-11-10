import type { MigrationInterface, QueryRunner } from 'typeorm';
import { onboardingV1 } from '../staff-onboarding-v1.js';
export class StaffOnboarding1794119000000 implements MigrationInterface {
  async up(r: QueryRunner) {
    if ((await r.query('SELECT version FROM app_schema_version'))[0]?.version !== 20)
      throw Error('Schema 20 required');
    const name = (await r.query('SELECT current_schema() AS name'))[0].name as string;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw Error('Unsupported schema');
    await r.query(onboardingV1('"' + name + '"'));
  }
  async down(r: QueryRunner) {
    for (const t of ['staff_onboarding', 'staff_onboarding_events', 'staff_onboarding_requests'])
      if ((await r.query('SELECT 1 FROM ' + t + ' LIMIT 1')).length)
        throw Error('Cannot discard onboarding history');
    await r.query(
      'DROP FUNCTION staff_access_post(uuid,uuid,uuid,jsonb),staff_onboarding_activate(text,text,text,uuid),staff_onboarding_owner_post(uuid,uuid,uuid,uuid,text,text,jsonb),staff_onboarding_log(uuid,uuid,uuid,text,text);ALTER FUNCTION staff_access_post_v20(uuid,uuid,uuid,jsonb) RENAME TO staff_access_post;DROP TABLE staff_onboarding_requests,staff_onboarding_events,staff_onboarding;UPDATE app_schema_version SET version=20 WHERE singleton;',
    );
  }
}
