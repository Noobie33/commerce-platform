import type { MigrationInterface, QueryRunner } from 'typeorm';

export class IdentityFoundation1794096000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE app_schema_version (singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton), version integer NOT NULL CHECK (version > 0)); INSERT INTO app_schema_version(version) VALUES (1); CREATE TABLE locations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]{2,32}$'),
        name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
        is_active boolean NOT NULL DEFAULT true
      );
      CREATE TABLE staff_users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9._-]{3,64}$'),
        display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
        password_hash text NOT NULL,
        is_active boolean NOT NULL DEFAULT true,
        must_change_password boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE permissions (code text PRIMARY KEY);
      CREATE TABLE roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE);
      CREATE TABLE role_permissions (
        role_id uuid NOT NULL REFERENCES roles(id),
        permission_code text NOT NULL REFERENCES permissions(code),
        PRIMARY KEY (role_id, permission_code)
      );
      CREATE TABLE staff_role_assignments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        staff_id uuid NOT NULL REFERENCES staff_users(id),
        role_id uuid NOT NULL REFERENCES roles(id),
        location_id uuid REFERENCES locations(id),
        UNIQUE NULLS NOT DISTINCT (staff_id, role_id, location_id)
      );
      CREATE INDEX staff_roles_staff_idx ON staff_role_assignments(staff_id);
      CREATE TABLE staff_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        staff_id uuid NOT NULL REFERENCES staff_users(id),
        token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
        csrf_token text NOT NULL CHECK (csrf_token ~ '^[a-f0-9]{64}$'),
        created_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL DEFAULT now() + interval '8 hours',
        revoked_at timestamptz,
        CHECK (expires_at > created_at)
      );
      CREATE INDEX staff_sessions_staff_idx ON staff_sessions(staff_id);
      CREATE TABLE login_rate_limits (
        bucket_hash text PRIMARY KEY CHECK (bucket_hash ~ '^[a-f0-9]{64}$'),
        attempts integer NOT NULL CHECK (attempts > 0),
        window_start timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE audit_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_id uuid REFERENCES staff_users(id),
        action text NOT NULL,
        request_id uuid NOT NULL,
        metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX audit_events_actor_time_idx ON audit_events(actor_id, created_at);
      INSERT INTO permissions(code) VALUES ('staff.read'), ('staff.manage'), ('roles.manage'), ('locations.read'), ('audit.read');
      INSERT INTO roles(code) VALUES ('owner');
      INSERT INTO role_permissions(role_id, permission_code) SELECT r.id, p.code FROM roles r CROSS JOIN permissions p WHERE r.code = 'owner';
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      'DROP TABLE audit_events, staff_sessions, staff_role_assignments, role_permissions, roles, permissions, staff_users, login_rate_limits, locations, app_schema_version',
    );
  }
}
