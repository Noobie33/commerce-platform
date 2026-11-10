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
    await manager.query(
      'GRANT SELECT ON purchase_receipts,purchase_receipt_lines,purchase_receipt_reversals,purchase_receipt_state TO "' +
        role +
        '"',
    );
    await manager.query(
      'REVOKE ALL ON FUNCTION public.inventory_post_core(uuid,uuid,uuid,jsonb) FROM "' + role + '"',
    );
    await manager.query(
      'GRANT EXECUTE ON FUNCTION public.purchase_receipt_post(uuid,uuid,uuid,jsonb) TO "' +
        role +
        '"',
    );
    await manager.query(
      'GRANT SELECT ON supplier_invoices,supplier_invoice_lines,supplier_invoice_state TO "' +
        role +
        '"',
    );
    await manager.query(
      'GRANT EXECUTE ON FUNCTION public.supplier_invoice_post(uuid,uuid,uuid,jsonb) TO "' +
        role +
        '"',
    );
    await manager.query(
      'GRANT SELECT ON supplier_payments,supplier_payment_allocations,supplier_payment_state,supplier_invoice_balances TO "' +
        role +
        '"',
    );
    await manager.query(
      'GRANT EXECUTE ON FUNCTION public.supplier_payment_post(uuid,uuid,uuid,jsonb) TO "' +
        role +
        '"',
    );
    await manager.query(
      'GRANT SELECT ON customers,customer_credit_history,customer_requests TO "' + role + '"',
    );
    await manager.query(
      'GRANT EXECUTE ON FUNCTION public.customer_save(uuid,uuid,uuid,jsonb) TO "' + role + '"',
    );
    await manager.query(
      'GRANT SELECT ON sales_orders,sales_order_lines,sales_requests TO "' + role + '"',
    );
    await manager.query(
      'GRANT EXECUTE ON FUNCTION public.sales_draft_save(uuid,uuid,uuid,jsonb) TO "' + role + '"',
    );
    await manager.query(
      'GRANT SELECT ON inventory_availability,sales_reservation_state,sales_reservations,sales_reservation_lines,sales_reservation_requests TO "' +
        role +
        '"',
    );
    await manager.query(
      'GRANT EXECUTE ON FUNCTION public.sales_reservation_post(uuid,uuid,uuid,jsonb) TO "' +
        role +
        '"',
    );
    await manager.query('GRANT INSERT ON locations TO "' + role + '"');
    await manager.query(
      'GRANT SELECT ON inventory_postings,inventory_entries,inventory_balances,inventory_requests TO "' +
        role +
        '"',
    );
    await manager.query(
      'GRANT EXECUTE ON FUNCTION public.inventory_post(uuid,uuid,uuid,jsonb) TO "' + role + '"',
    );
    const privateAccess = await manager.query(
      "SELECT has_function_privilege($1,'public.inventory_post_core(uuid,uuid,uuid,jsonb)','EXECUTE') AS allowed",
      [role],
    );
    if (privateAccess[0]?.allowed)
      throw new Error('Runtime role must not execute the private stock posting function');
    await manager.query(
      'GRANT SELECT ON catalog_content_profiles,catalog_product_content,catalog_content_events,catalog_content_requests TO "' +
        role +
        '"',
    );
    await manager.query(
      'GRANT EXECUTE ON FUNCTION public.catalog_content_snapshot(uuid),public.catalog_content_issues(uuid),public.catalog_content_post(uuid,uuid,uuid,jsonb) TO "' +
        role +
        '"',
    );
    await manager.query(
      'GRANT SELECT ON catalog_merch_items,catalog_merch_versions,catalog_merch_links,catalog_merch_requests TO "' +
        role +
        '"',
    );
    await manager.query(
      'GRANT EXECUTE ON FUNCTION public.catalog_merch_post(uuid,uuid,uuid,jsonb) TO "' + role + '"',
    );
    await manager.query(
      'REVOKE ALL ON FUNCTION public.catalog_content_post_v14(uuid,uuid,uuid,jsonb),public.catalog_content_snapshot_v14(uuid),public.catalog_content_issues_v14(uuid) FROM "' +
        role +
        '"',
    );
    await manager.query(
      'GRANT SELECT ON catalog_category_presentation,catalog_category_routes,catalog_category_events,catalog_product_seo,catalog_presentation_requests TO "' +
        role +
        '"',
    );
    await manager.query(
      'GRANT EXECUTE ON FUNCTION public.catalog_category_post(uuid,uuid,uuid,jsonb),public.catalog_category_active(uuid) TO "' +
        role +
        '"',
    );
    await manager.query(
      'REVOKE ALL ON FUNCTION public.catalog_content_post_v17(uuid,uuid,uuid,jsonb),public.catalog_content_snapshot_v17(uuid) FROM "' +
        role +
        '"',
    );
    await manager.query(
      'GRANT SELECT ON catalog_media_reviews,catalog_releases,catalog_publication_events,catalog_publication_requests TO "' +
        role +
        '"',
    );
    await manager.query(
      'GRANT EXECUTE ON FUNCTION public.catalog_release_basis(uuid),public.catalog_release_eligible(uuid),public.catalog_publication_post(uuid,uuid,uuid,jsonb) TO "' +
        role +
        '"',
    );
    await manager.query(
      'GRANT SELECT ON access_permission_policy,staff_access_versions,role_access_profiles,staff_access_events,staff_access_requests TO "' +
        role +
        '"',
    );
    await manager.query(
      'GRANT EXECUTE ON FUNCTION public.staff_access_owner(uuid),public.staff_access_snapshot(text,uuid),public.staff_access_post(uuid,uuid,uuid,jsonb) TO "' +
        role +
        '"',
    );
    await manager.query(
      'GRANT SELECT ON staff_onboarding,staff_onboarding_events,staff_onboarding_requests TO "' +
        role +
        '"',
    );
    await manager.query(
      'GRANT EXECUTE ON FUNCTION public.staff_onboarding_owner_post(uuid,uuid,uuid,uuid,text,text,jsonb),public.staff_onboarding_activate(text,text,text,uuid) TO "' +
        role +
        '"',
    );
    await manager.query(
      'REVOKE ALL ON FUNCTION public.staff_access_post_v20(uuid,uuid,uuid,jsonb) FROM "' +
        role +
        '"',
    );
    await manager.query(
      'GRANT SELECT ON catalog_video_policy,catalog_product_videos,catalog_video_events,catalog_video_requests TO "' +
        role +
        '"',
    );
    await manager.query(
      'GRANT EXECUTE ON FUNCTION public.catalog_video_post(uuid,uuid,uuid,jsonb) TO "' + role + '"',
    );
    const worker =
      'commerce_' + (migration.pathname.endsWith('_test') ? 'test' : 'dev') + '_video_worker';
    if ((await manager.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [worker])).length) {
      await manager.query('GRANT USAGE ON SCHEMA public TO "' + worker + '"');
      await manager.query('GRANT SELECT ON app_schema_version TO "' + worker + '"');
      await manager.query(
        'GRANT EXECUTE ON FUNCTION public.catalog_video_storage_refs(),public.catalog_video_claim(uuid,uuid),public.catalog_video_heartbeat(uuid,uuid),public.catalog_video_finish(uuid,uuid,uuid,jsonb,text) TO "' +
          worker +
          '"',
      );
    }
    await manager.query('GRANT INSERT, SELECT ON audit_events TO "' + role + '"');
  });
}
