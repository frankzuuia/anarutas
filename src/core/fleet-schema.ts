import type { Sql } from "./database";

export async function migrateFleet(sql: Sql) {
  await sql.query(`
    CREATE TABLE route_drivers (
      id uuid PRIMARY KEY, name text NOT NULL, phone text NOT NULL,
      emergency_name text NOT NULL DEFAULT '', emergency_phone text NOT NULL DEFAULT '', blood_type text NOT NULL DEFAULT '',
      active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1 CHECK(version>0),
      creation_payload jsonb NOT NULL, created_by uuid NOT NULL REFERENCES route_users(id), updated_by uuid NOT NULL REFERENCES route_users(id),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE route_vehicles (
      id uuid PRIMARY KEY, name text NOT NULL, brand text NOT NULL, model text NOT NULL,
      plate text NOT NULL UNIQUE, mileage numeric(12,2) NOT NULL CHECK(mileage>=0), fuel text NOT NULL,
      available boolean NOT NULL DEFAULT true, driver_id uuid UNIQUE REFERENCES route_drivers(id),
      version integer NOT NULL DEFAULT 1 CHECK(version>0), creation_payload jsonb NOT NULL,
      created_by uuid NOT NULL REFERENCES route_users(id), updated_by uuid NOT NULL REFERENCES route_users(id),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE route_driver_documents (
      driver_id uuid NOT NULL REFERENCES route_drivers(id), kind text NOT NULL CHECK(kind IN ('photo','license_front','license_back')),
      data bytea NOT NULL CHECK(octet_length(data)>0 AND octet_length(data)<=8388608),
      content_hash text NOT NULL, uploaded_by uuid NOT NULL REFERENCES route_users(id), updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(driver_id,kind)
    );
    UPDATE rutas_installation SET schema_version=2 WHERE singleton=true;
  `);
}
