import type { Sql } from "./database";

export async function migrateCustomers(sql: Sql) {
  await sql.query(`
    CREATE TABLE route_customers (
      id uuid PRIMARY KEY,
      source text NOT NULL REFERENCES route_order_source(fingerprint),
      odoo_partner_id bigint NOT NULL CHECK(odoo_partner_id > 0),
      odoo_parent_id bigint CHECK(odoo_parent_id > 0),
      odoo_commercial_partner_id bigint CHECK(odoo_commercial_partner_id > 0),
      odoo_company_id bigint CHECK(odoo_company_id > 0),
      odoo_type text NOT NULL DEFAULT 'contact',
      odoo_is_company boolean NOT NULL DEFAULT false,
      odoo_active boolean NOT NULL DEFAULT true,
      odoo_name text NOT NULL,
      odoo_ref text,
      odoo_phone text,
      odoo_mobile text,
      odoo_address text NOT NULL DEFAULT '',
      source_snapshot jsonb NOT NULL DEFAULT '{}',
      source_hash text NOT NULL,
      display_name text NOT NULL,
      display_name_overridden boolean NOT NULL DEFAULT false,
      phone text,
      phone_overridden boolean NOT NULL DEFAULT false,
      delivery_note text NOT NULL DEFAULT '',
      priority text NOT NULL DEFAULT 'schedule'
        CHECK(priority IN ('high','medium','schedule')),
      fulfillment_mode text NOT NULL DEFAULT 'delivery'
        CHECK(fulfillment_mode IN ('delivery','pickup')),
      delivery_address text NOT NULL DEFAULT '',
      address_overridden boolean NOT NULL DEFAULT false,
      map_url text,
      latitude double precision CHECK(latitude BETWEEN -90 AND 90),
      longitude double precision CHECK(longitude BETWEEN -180 AND 180),
      place_id text,
      location_status text NOT NULL DEFAULT 'pending'
        CHECK(location_status IN ('pending','confirmed','driver_confirmed')),
      location_version integer NOT NULL DEFAULT 0 CHECK(location_version >= 0),
      search_key text NOT NULL,
      archived_at timestamptz,
      archived_by uuid REFERENCES route_users(id),
      version integer NOT NULL DEFAULT 1 CHECK(version > 0),
      created_by uuid NOT NULL REFERENCES route_users(id),
      updated_by uuid NOT NULL REFERENCES route_users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(source,odoo_partner_id),
      CHECK((latitude IS NULL) = (longitude IS NULL)),
      CHECK(location_status = 'pending' OR (latitude IS NOT NULL AND longitude IS NOT NULL))
    );

    CREATE TABLE route_customer_windows (
      id uuid PRIMARY KEY,
      customer_id uuid NOT NULL REFERENCES route_customers(id) ON DELETE CASCADE,
      days_mask smallint NOT NULL CHECK(days_mask BETWEEN 1 AND 127),
      start_minute smallint NOT NULL CHECK(start_minute BETWEEN 0 AND 1439),
      end_minute smallint NOT NULL CHECK(end_minute BETWEEN 1 AND 1440),
      position smallint NOT NULL CHECK(position BETWEEN 1 AND 32),
      CHECK(start_minute < end_minute),
      UNIQUE(customer_id,position),
      UNIQUE(customer_id,days_mask,start_minute,end_minute)
    );

    CREATE TABLE route_customer_location_history (
      id uuid PRIMARY KEY,
      customer_id uuid NOT NULL REFERENCES route_customers(id),
      location_version integer NOT NULL CHECK(location_version > 0),
      address text NOT NULL,
      latitude double precision NOT NULL CHECK(latitude BETWEEN -90 AND 90),
      longitude double precision NOT NULL CHECK(longitude BETWEEN -180 AND 180),
      place_id text,
      map_url text NOT NULL,
      source text NOT NULL CHECK(source IN ('admin','driver')),
      actor_id uuid REFERENCES route_users(id),
      shipment_id uuid REFERENCES route_shipments(id) ON DELETE SET NULL,
      idempotency_key text,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(customer_id,location_version),
      UNIQUE(idempotency_key)
    );

    CREATE INDEX route_customers_archive_id
      ON route_customers(archived_at,id);
    CREATE INDEX route_customers_source_parent
      ON route_customers(source,odoo_parent_id);
    CREATE INDEX route_customer_windows_customer
      ON route_customer_windows(customer_id,position);

    INSERT INTO route_customers(
      id,source,odoo_partner_id,odoo_name,odoo_address,source_snapshot,
      source_hash,display_name,delivery_address,search_key,created_by,updated_by
    )
    SELECT DISTINCT ON (s.source,s.partner_id)
      md5('ana-rutas:customer:' || s.source || ':' || s.partner_id::text)::uuid,
      s.source,s.partner_id,
      COALESCE(NULLIF(s.snapshot->>'customerName',''),'Cliente Odoo ' || s.partner_id::text),
      COALESCE(s.snapshot->>'address',''),s.snapshot,
      md5(s.snapshot::text),
      COALESCE(NULLIF(s.snapshot->>'customerName',''),'Cliente Odoo ' || s.partner_id::text),
      COALESCE(s.snapshot->>'address',''),
      lower(translate(
        concat_ws(' ',s.snapshot->>'customerName',s.snapshot->>'address',s.partner_id::text),
        'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun'
      )),
      s.created_by,s.created_by
    FROM route_shipments s
    ORDER BY s.source,s.partner_id,s.created_at,s.id
    ON CONFLICT(source,odoo_partner_id) DO NOTHING;

    ALTER TABLE route_shipments
      ADD CONSTRAINT route_shipments_customer_identity
      FOREIGN KEY(source,partner_id)
      REFERENCES route_customers(source,odoo_partner_id)
      DEFERRABLE INITIALLY DEFERRED;

    UPDATE rutas_installation SET schema_version=5 WHERE singleton=true;
  `);
}
