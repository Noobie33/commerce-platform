import type { MigrationInterface, QueryRunner } from 'typeorm';
export class CustomerFoundation1794108000000 implements MigrationInterface {
  async up(r: QueryRunner) {
    const schema = (await r.query('SELECT current_schema() AS name'))[0].name as string;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw Error('Unsupported customer schema');
    const s = '"' + schema + '"';
    await r.query(`
 CREATE SEQUENCE customer_number;
 CREATE TABLE customers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text NOT NULL UNIQUE,
 kind text NOT NULL CHECK(kind IN('person','business')),segment text NOT NULL CHECK(segment IN('retail','wholesale','both')),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 140),contact_name text NOT NULL DEFAULT '' CHECK(length(contact_name)<=120),
 phone text NOT NULL DEFAULT '' CHECK(phone='' OR phone ~ '^\\+[1-9][0-9]{7,14}$'),email text NOT NULL DEFAULT '' CHECK(length(email)<=160),
 billing_address jsonb CHECK(billing_address IS NULL OR jsonb_typeof(billing_address)='object'),delivery_address jsonb CHECK(delivery_address IS NULL OR jsonb_typeof(delivery_address)='object'),notes text NOT NULL DEFAULT '' CHECK(length(notes)<=1000),is_active boolean NOT NULL DEFAULT true,
 credit_enabled boolean NOT NULL DEFAULT false,credit_limit_minor bigint NOT NULL DEFAULT 0 CHECK(credit_limit_minor BETWEEN 0 AND 99999999999999),payment_terms_days integer NOT NULL DEFAULT 0 CHECK(payment_terms_days BETWEEN 0 AND 365),
 version integer NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 2147483646),created_by uuid NOT NULL REFERENCES staff_users(id),updated_by uuid NOT NULL REFERENCES staff_users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((NOT credit_enabled AND credit_limit_minor=0 AND payment_terms_days=0) OR(credit_enabled AND credit_limit_minor>0)));
 CREATE INDEX customers_name_idx ON customers(lower(name),id);
 CREATE INDEX customers_phone_idx ON customers(phone) WHERE phone<>'';
 CREATE INDEX customers_email_idx ON customers(lower(email)) WHERE email<>'';
 CREATE TABLE customer_credit_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid NOT NULL REFERENCES customers(id),version integer NOT NULL,previous_policy jsonb NOT NULL,current_policy jsonb NOT NULL,reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),actor_id uuid NOT NULL REFERENCES staff_users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(customer_id,version));
 CREATE TABLE customer_requests(key uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES staff_users(id),request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),customer_id uuid NOT NULL REFERENCES customers(id),response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
 INSERT INTO permissions(code) VALUES('customers.read'),('customers.manage'),('customers.credit.manage');
 INSERT INTO role_permissions(role_id,permission_code) SELECT r.id,p.code FROM roles r CROSS JOIN permissions p WHERE r.code='owner' AND p.code IN('customers.read','customers.manage','customers.credit.manage');
 CREATE FUNCTION ${s}.customer_save(save_key uuid,actor uuid,request_id uuid,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
 DECLARE operation text;customer_uuid uuid;expected integer;entry record;address jsonb;field text;sequence_number text;customer_code text;previous ${s}.customers%ROWTYPE;cached ${s}.customer_requests%ROWTYPE;hash text;response jsonb;revision integer;enabled boolean;credit bigint;terms integer;reason_text text;before_policy jsonb;after_policy jsonb;
 BEGIN
 IF save_key IS NULL OR actor IS NULL OR request_id IS NULL OR coalesce(jsonb_typeof(payload),'')<>'object' THEN RAISE EXCEPTION 'CUSTOMER_INVALID';END IF;
 operation:=payload->>'kind';IF operation IS NULL OR operation NOT IN('create','update','credit') THEN RAISE EXCEPTION 'CUSTOMER_INVALID';END IF;
 IF NOT EXISTS(SELECT 1 FROM ${s}.staff_users u JOIN ${s}.staff_role_assignments a ON a.staff_id=u.id JOIN ${s}.role_permissions p ON p.role_id=a.role_id WHERE u.id=actor AND u.is_active AND NOT u.must_change_password AND a.location_id IS NULL AND p.permission_code='customers.read')
 OR NOT EXISTS(SELECT 1 FROM ${s}.staff_role_assignments a JOIN ${s}.role_permissions p ON p.role_id=a.role_id WHERE a.staff_id=actor AND a.location_id IS NULL AND p.permission_code=CASE WHEN operation='credit' THEN 'customers.credit.manage' ELSE 'customers.manage' END) THEN RAISE EXCEPTION 'CUSTOMER_PERMISSION';END IF;
 hash:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('customer-request:'||save_key::text,10));
 SELECT * INTO cached FROM ${s}.customer_requests WHERE key=save_key;
 IF FOUND THEN IF cached.actor_id<>actor OR cached.request_hash<>hash THEN RAISE EXCEPTION 'CUSTOMER_IDEMPOTENCY';END IF;RETURN cached.response;END IF;
 IF operation<>'create' THEN
 customer_uuid:=(payload->>'id')::uuid;IF coalesce(payload->>'expectedVersion','')!~'^[1-9][0-9]{0,9}$' THEN RAISE EXCEPTION 'CUSTOMER_INVALID';END IF;expected:=(payload->>'expectedVersion')::integer;
 SELECT * INTO previous FROM ${s}.customers WHERE id=customer_uuid FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';END IF;IF previous.version<>expected THEN RAISE EXCEPTION 'CUSTOMER_STALE';END IF;
 END IF;
 IF operation='credit' THEN
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN('kind','id','expectedVersion','creditEnabled','creditLimit','paymentTermsDays','reason')) OR jsonb_typeof(payload->'creditEnabled') IS DISTINCT FROM 'boolean' OR coalesce(payload->>'creditLimit','')!~'^(0|[1-9][0-9]{0,13})$' OR coalesce(payload->>'paymentTermsDays','')!~'^(0|[1-9][0-9]{0,2})$' OR jsonb_typeof(payload->'reason') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'CUSTOMER_INVALID';END IF;
 enabled:=(payload->>'creditEnabled')::boolean;credit:=(payload->>'creditLimit')::bigint;terms:=(payload->>'paymentTermsDays')::integer;reason_text:=btrim(payload->>'reason');
 IF terms>365 OR length(reason_text) NOT BETWEEN 1 AND 500 OR (enabled AND credit=0) OR(NOT enabled AND(credit<>0 OR terms<>0)) THEN RAISE EXCEPTION 'CUSTOMER_INVALID';END IF;
 IF enabled AND NOT previous.is_active THEN RAISE EXCEPTION 'CUSTOMER_INACTIVE';END IF;
 before_policy:=jsonb_build_object('creditEnabled',previous.credit_enabled,'creditLimitMinor',previous.credit_limit_minor::text,'paymentTermsDays',previous.payment_terms_days);
 after_policy:=jsonb_build_object('creditEnabled',enabled,'creditLimitMinor',credit::text,'paymentTermsDays',terms);
 UPDATE ${s}.customers SET credit_enabled=enabled,credit_limit_minor=credit,payment_terms_days=terms,version=version+1,updated_by=actor,updated_at=now() WHERE id=customer_uuid RETURNING version INTO revision;
 INSERT INTO ${s}.customer_credit_history(customer_id,version,previous_policy,current_policy,reason,actor_id) VALUES(customer_uuid,revision,before_policy,after_policy,reason_text,actor);
 ELSE
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN('kind','id','expectedVersion','customerKind','segment','name','contactName','phone','email','billingAddress','deliveryAddress','notes','isActive')) THEN RAISE EXCEPTION 'CUSTOMER_INVALID';END IF;
 IF operation='create' AND(payload?'id' OR payload?'expectedVersion') THEN RAISE EXCEPTION 'CUSTOMER_INVALID';END IF;
 FOR entry IN SELECT * FROM jsonb_each(payload) WHERE key IN('customerKind','segment','name','contactName','phone','email','notes') LOOP IF jsonb_typeof(entry.value)<>'string' THEN RAISE EXCEPTION 'CUSTOMER_INVALID';END IF;END LOOP;
 IF coalesce(payload->>'customerKind','') NOT IN('person','business') OR coalesce(payload->>'segment','') NOT IN('retail','wholesale','both') OR coalesce(length(btrim(payload->>'name')),0) NOT BETWEEN 1 AND 140 OR coalesce(length(payload->>'contactName'),10000)>120 OR coalesce(length(payload->>'phone'),10000)>16 OR coalesce(length(payload->>'email'),10000)>160 OR coalesce(length(payload->>'notes'),10000)>1000 OR jsonb_typeof(payload->'isActive') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'CUSTOMER_INVALID';END IF;
 IF payload->>'phone'<>'' AND payload->>'phone'!~'^\\+[1-9][0-9]{7,14}$' THEN RAISE EXCEPTION 'CUSTOMER_INVALID';END IF;
 FOREACH field IN ARRAY ARRAY['billingAddress','deliveryAddress'] LOOP
 address:=payload->field;
 IF address IS NULL THEN RAISE EXCEPTION 'CUSTOMER_INVALID';END IF;
 IF address<>'null'::jsonb THEN
 IF jsonb_typeof(address)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(address) k WHERE k NOT IN('line1','line2','area','district','postalCode')) THEN RAISE EXCEPTION 'CUSTOMER_INVALID';END IF;
 IF coalesce(length(btrim(address->>'line1')),0) NOT BETWEEN 1 AND 240 OR coalesce(length(address->>'line2'),10000)>240 OR coalesce(length(address->>'area'),10000)>100 OR coalesce(length(address->>'district'),10000)>100 OR coalesce(length(address->>'postalCode'),10000)>20 THEN RAISE EXCEPTION 'CUSTOMER_INVALID';END IF;
 FOR entry IN SELECT * FROM jsonb_each(address) LOOP IF jsonb_typeof(entry.value)<>'string' THEN RAISE EXCEPTION 'CUSTOMER_INVALID';END IF;END LOOP;
 END IF;
 END LOOP;
 IF operation='create' THEN
 sequence_number:=nextval('${s}.customer_number'::regclass)::text;customer_code:='CUST-'||repeat('0',greatest(0,8-length(sequence_number)))||sequence_number;
 INSERT INTO ${s}.customers(code,kind,segment,name,contact_name,phone,email,billing_address,delivery_address,notes,is_active,created_by,updated_by) VALUES(customer_code,payload->>'customerKind',payload->>'segment',payload->>'name',payload->>'contactName',payload->>'phone',payload->>'email',nullif(payload->'billingAddress','null'::jsonb),nullif(payload->'deliveryAddress','null'::jsonb),payload->>'notes',(payload->>'isActive')::boolean,actor,actor) RETURNING id,version INTO customer_uuid,revision;
 ELSE
 UPDATE ${s}.customers SET kind=payload->>'customerKind',segment=payload->>'segment',name=payload->>'name',contact_name=payload->>'contactName',phone=payload->>'phone',email=payload->>'email',billing_address=nullif(payload->'billingAddress','null'::jsonb),delivery_address=nullif(payload->'deliveryAddress','null'::jsonb),notes=payload->>'notes',is_active=(payload->>'isActive')::boolean,version=version+1,updated_by=actor,updated_at=now() WHERE id=customer_uuid RETURNING version INTO revision;
 END IF;
 END IF;
 response:=jsonb_build_object('id',customer_uuid,'version',revision,'kind',operation);
 INSERT INTO ${s}.audit_events(actor_id,action,request_id,metadata) VALUES(actor,CASE operation WHEN 'create' THEN 'customers.created' WHEN 'update' THEN 'customers.updated' ELSE 'customers.credit_policy_changed' END,request_id,jsonb_build_object('entityId',customer_uuid,'version',revision));
 INSERT INTO ${s}.customer_requests(key,actor_id,request_hash,customer_id,response) VALUES(save_key,actor,hash,customer_uuid,response);
 RETURN response;
 EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation THEN RAISE EXCEPTION 'CUSTOMER_INVALID';END;$f$;
 REVOKE ALL ON FUNCTION ${s}.customer_save(uuid,uuid,uuid,jsonb) FROM PUBLIC;
 UPDATE app_schema_version SET version=10 WHERE singleton;
 `);
  }
  async down(r: QueryRunner) {
    if ((await r.query('SELECT 1 FROM customers LIMIT 1')).length)
      throw Error('Cannot discard customer history; restore the complete backup instead');
    const schema = (await r.query('SELECT current_schema() AS name'))[0].name as string;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw Error('Unsupported customer schema');
    await r.query(
      'DROP FUNCTION "' +
        schema +
        "\".customer_save(uuid,uuid,uuid,jsonb);DROP TABLE customer_requests,customer_credit_history,customers;DROP SEQUENCE customer_number;DELETE FROM role_permissions WHERE permission_code IN('customers.read','customers.manage','customers.credit.manage');DELETE FROM permissions WHERE code IN('customers.read','customers.manage','customers.credit.manage');UPDATE app_schema_version SET version=9 WHERE singleton;",
    );
  }
}
