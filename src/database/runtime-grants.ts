import type { DataSource } from 'typeorm';
import { databaseUrl } from '../infrastructure/database/data-source.js';

export async function grantRuntime(source: DataSource, env: NodeJS.ProcessEnv): Promise<void> {
  const runtime = new URL(databaseUrl(env, 'DATABASE_URL'));
  const migration = new URL(databaseUrl(env, 'MIGRATION_DATABASE_URL'));
  if (
    runtime.hostname !== migration.hostname ||
    runtime.port !== migration.port ||
    runtime.pathname !== migration.pathname
  ) {
    throw new Error('Runtime and migration connections must target the same database');
  }
  const role = decodeURIComponent(runtime.username);
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(role) || role === decodeURIComponent(migration.username))
    throw new Error('Separate valid runtime role required');
  const rows: {
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolbypassrls: boolean;
  }[] = await source.query(
    'SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname=$1',
    [role],
  );
  if (rows.length !== 1 || Object.values(rows[0]!).some(Boolean))
    throw new Error('Runtime role must be restricted');
  await source.transaction(async (manager) => {
    await manager.query('GRANT USAGE ON SCHEMA public TO "' + role + '"');
    await manager.query(
      'GRANT SELECT ON app_schema_version, locations, staff_users, roles, permissions, role_permissions, staff_role_assignments TO "' +
        role +
        '"',
    );
    await manager.query(
      'GRANT UPDATE (password_hash, must_change_password) ON staff_users TO "' + role + '"',
    );
    await manager.query(
      'GRANT SELECT, INSERT, UPDATE ON staff_sessions, login_rate_limits TO "' + role + '"',
    );
    await manager.query(
      'GRANT SELECT, INSERT ON catalog_categories, catalog_products, catalog_variants TO ' +
        '"' +
        role +
        '"',
    );
    await manager.query(
      'GRANT UPDATE (name,description,category_id,status,version,updated_at) ON catalog_products TO ' +
        '"' +
        role +
        '"',
    );
    await manager.query(
      'GRANT UPDATE (barcode,price_minor,is_active) ON catalog_variants TO ' + '"' + role + '"',
    );
    await manager.query('GRANT SELECT, INSERT ON catalog_requests TO ' + '"' + role + '"');
    await manager.query(
      'GRANT SELECT,INSERT ON catalog_product_photos,catalog_media_requests TO "' + role + '"',
    );
    await manager.query(
      'GRANT UPDATE (is_primary,is_active) ON catalog_product_photos TO "' + role + '"',
    );
    await manager.query(
      'GRANT SELECT,INSERT ON purchasing_suppliers,purchase_orders,purchasing_requests TO "' +
        role +
        '"',
    );
    await manager.query(
      'GRANT UPDATE(name,contact_name,phone,email,address,tax_reference,notes,is_active,version,updated_at) ON purchasing_suppliers TO "' +
        role +
        '"',
    );
    await manager.query(
      'GRANT UPDATE(supplier_id,location_id,status,expected_on,reference,notes,total_minor,supplier_snapshot,version,issued_at,cancelled_at,cancellation_reason,updated_at) ON purchase_orders TO "' +
        role +
        '"',
    );
    await manager.query(
      'GRANT SELECT,INSERT,UPDATE,DELETE ON purchase_order_lines TO "' + role + '"',
    );
    await manager.query('GRANT USAGE ON SEQUENCE purchasing_order_number TO "' + role + '"');
    await manager.query('GRANT INSERT ON locations TO "' + role + '"');
    await manager.query(
      'GRANT SELECT ON inventory_postings,inventory_entries,inventory_balances,inventory_requests TO "' +
        role +
        '"',
    );
    await manager.query(
      'GRANT EXECUTE ON FUNCTION public.inventory_post(uuid,uuid,uuid,jsonb) TO "' + role + '"',
    );
    await manager.query('GRANT INSERT, SELECT ON audit_events TO "' + role + '"');
  });
}
