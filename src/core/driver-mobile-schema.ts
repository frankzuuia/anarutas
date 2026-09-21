import type { Sql } from "./database";

export async function migrateDriverMobile(sql: Sql) {
  await sql.query(`
    CREATE TABLE route_driver_mobile_access (
      driver_id uuid PRIMARY KEY REFERENCES route_drivers(id),
      login_phone text NOT NULL,
      pin_hash text NOT NULL,
      enabled boolean NOT NULL DEFAULT true,
      version integer NOT NULL DEFAULT 1 CHECK(version > 0),
      failed_attempts integer NOT NULL DEFAULT 0 CHECK(failed_attempts >= 0),
      locked_until timestamptz,
      updated_by uuid NOT NULL REFERENCES route_users(id),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX route_driver_mobile_active_phone
      ON route_driver_mobile_access(login_phone) WHERE enabled;
    CREATE TABLE route_driver_mobile_devices (
      id uuid PRIMARY KEY,
      driver_id uuid NOT NULL REFERENCES route_drivers(id),
      public_key text NOT NULL,
      public_key_hash text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz,
      UNIQUE(id,driver_id)
    );
    CREATE TABLE route_driver_mobile_activations (
      driver_id uuid PRIMARY KEY REFERENCES route_drivers(id),
      code_hash text NOT NULL,
      expires_at timestamptz NOT NULL,
      created_by uuid NOT NULL REFERENCES route_users(id),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE route_driver_mobile_challenges (
      id uuid PRIMARY KEY,
      driver_id uuid NOT NULL,
      device_id uuid NOT NULL,
      nonce_hash text NOT NULL,
      expires_at timestamptz NOT NULL,
      FOREIGN KEY(device_id,driver_id)
        REFERENCES route_driver_mobile_devices(id,driver_id)
    );
    CREATE INDEX route_driver_mobile_challenges_expiry
      ON route_driver_mobile_challenges(expires_at);
    CREATE TABLE route_driver_mobile_sessions (
      token_hash text PRIMARY KEY,
      driver_id uuid NOT NULL,
      device_id uuid NOT NULL,
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY(device_id,driver_id)
        REFERENCES route_driver_mobile_devices(id,driver_id)
    );
    CREATE INDEX route_driver_mobile_sessions_driver
      ON route_driver_mobile_sessions(driver_id,expires_at);
    CREATE TABLE route_driver_mobile_audit (
      id bigserial PRIMARY KEY,
      driver_id uuid NOT NULL REFERENCES route_drivers(id),
      admin_actor_id uuid REFERENCES route_users(id),
      action text NOT NULL,
      details jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    UPDATE rutas_installation SET schema_version=10 WHERE singleton=true;
  `);
}
