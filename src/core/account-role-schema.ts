import type { Sql } from "./database";
export async function migrateAccountRoles(sql: Sql) {
  await sql.query(`ALTER TABLE route_users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'routes' CHECK(role IN ('routes','settlement'));
    CREATE OR REPLACE FUNCTION preserve_account_role() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.role IS DISTINCT FROM OLD.role THEN RAISE EXCEPTION 'ACCOUNT_ROLE_IMMUTABLE' USING ERRCODE='42501'; END IF; RETURN NEW;
    END $$;
    CREATE OR REPLACE TRIGGER preserve_account_role BEFORE UPDATE OF role ON route_users FOR EACH ROW EXECUTE FUNCTION preserve_account_role();
    UPDATE rutas_installation SET schema_version=37 WHERE singleton=true;`);
}
