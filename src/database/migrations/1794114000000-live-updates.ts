import type { MigrationInterface, QueryRunner } from 'typeorm';
// Notifications are disposable cache-invalidation hints, never business messages.
const tables: Record<string, string> = {
  catalog_categories: 'catalog',
  catalog_products: 'catalog',
  catalog_variants: 'catalog',
  catalog_product_photos: 'catalog',
  catalog_product_content: 'catalog',
  customers: 'customers',
  purchasing_suppliers: 'purchasing',
  purchase_orders: 'purchasing',
  purchase_receipts: 'purchasing',
  purchase_receipt_reversals: 'purchasing',
  supplier_invoices: 'purchasing',
  supplier_payments: 'purchasing',
  sales_orders: 'sales',
  sales_order_lines: 'sales',
  sales_reservations: 'reservations',
  inventory_balances: 'inventory',
  inventory_entries: 'inventory',
  locations: 'locations',
  staff_users: 'access',
  staff_role_assignments: 'access',
  role_permissions: 'access',
  roles: 'access',
};
export class LiveUpdates1794114000000 implements MigrationInterface {
  async up(r: QueryRunner) {
    if (
      (await r.query('SELECT version FROM app_schema_version WHERE singleton'))[0]?.version !== 15
    )
      throw Error('Schema 15 required for live updates');
    const name = (await r.query('SELECT current_schema() AS name'))[0].name as string;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw Error('Unsupported notification schema');
    const schema = '"' + name + '"';
    await r.query(`CREATE FUNCTION ${schema}.notify_staff_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
   DECLARE row_data jsonb; payload jsonb;
   BEGIN
    IF TG_OP='DELETE' THEN row_data:=to_jsonb(OLD); ELSE row_data:=to_jsonb(NEW); END IF;
    payload:=jsonb_build_object('topic',TG_ARGV[0]);
    IF TG_ARGV[0] IN ('inventory','reservations') THEN payload:=payload||jsonb_build_object('locationId',row_data->>'location_id'); END IF;
    IF TG_ARGV[0]='locations' THEN payload:=payload||jsonb_build_object('locationId',row_data->>'id'); END IF;
    PERFORM pg_notify('commerce_staff_changes',payload::text);
    RETURN NULL;
   END $$`);
    for (const [table, topic] of Object.entries(tables))
      await r.query(
        `CREATE TRIGGER staff_live_change AFTER INSERT OR UPDATE OR DELETE ON ${schema}."${table}" FOR EACH ROW EXECUTE FUNCTION ${schema}.notify_staff_change('${topic}')`,
      );
    await r.query('UPDATE app_schema_version SET version=16 WHERE singleton');
  }
  async down(r: QueryRunner) {
    for (const table of Object.keys(tables))
      await r.query(`DROP TRIGGER staff_live_change ON "${table}"`);
    await r.query(
      'DROP FUNCTION notify_staff_change(); UPDATE app_schema_version SET version=15 WHERE singleton',
    );
  }
}
