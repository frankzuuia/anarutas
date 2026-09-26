import type { Pool } from "pg";
import { transaction } from "./database";
import { searchKey } from "./customers";
import { integer } from "./orders-validation";
import { AppError } from "./errors";
import { lockServiceContext, serviceIdentity } from "./driver-service-context";
import { saveDriverCommandReceipt } from "./driver-command-receipts";

export function operationalPhone(value: unknown) {
  if (typeof value !== "string" || value.length > 80) throw new AppError("CUSTOMER_PHONE_INVALID");
  let digits = "";
  const text = value.trim();
  for (const [index, char] of [...text].entries()) {
    if (char >= "0" && char <= "9") digits += char;
    else if (char === "+" && index === 0) continue;
    else if (![" ", "-", "(", ")", "."].includes(char)) throw new AppError("CUSTOMER_PHONE_INVALID");
  }
  if (digits.length < 7 || digits.length > 15) throw new AppError("CUSTOMER_PHONE_INVALID");
  return (text.startsWith("+") ? "+" : "") + digits;
}

export async function addDriverCustomerPhone(pool: Pool, authorization: string | null, planId: string,
  stopId: string, raw: Record<string, unknown>, at?: Date) {
  const input = serviceIdentity(raw), phone = operationalPhone(raw.phone);
  const version = integer(raw.customerVersion, 1);
  return transaction(pool, async sql => {
    const { previous, driver, route, hash, stop } = await lockServiceContext(sql, authorization, planId, stopId,
      input, { kind: "customer_phone", phone, version });
    if (previous) return previous;
    const customer = (await sql.query("SELECT * FROM route_customers WHERE id=$1 FOR UPDATE", [stop!.customer_id])).rows[0];
    if (!customer || customer.archived_at) throw new AppError("CUSTOMER_UNAVAILABLE", 409);
    if (customer.version !== version) throw new AppError("VERSION_CONFLICT", 409);
    // Mobile can supply a missing contact, not silently overwrite an administrator's number.
    if (customer.phone?.trim()) throw new AppError("CUSTOMER_PHONE_ALREADY_SET", 409);
    const key = searchKey([customer.display_name, customer.odoo_name, phone, customer.odoo_phone,
      customer.odoo_mobile, customer.delivery_address, customer.odoo_address, customer.odoo_ref,
      customer.odoo_partner_id, customer.delivery_note, customer.parent_name, customer.commercial_name]);
    const now = at ?? new Date();
    await sql.query(`UPDATE route_customers SET phone=$2,phone_overridden=true,version=version+1,
      search_key=$3,updated_by=NULL,updated_by_driver=$4,updated_at=$5 WHERE id=$1`,
    [customer.id, phone, key, driver.driver_id, now]);
    await sql.query("UPDATE route_driver_executions SET revision=revision+1 WHERE id=$1", [route.id]);
    await sql.query("INSERT INTO route_driver_mobile_audit(driver_id,action,details) VALUES($1,'mobile.customer.phone_added',$2)",
      [driver.driver_id, JSON.stringify({ customerId: customer.id, executionId: route.id, deviceId: driver.device_id })]);
    return saveDriverCommandReceipt(sql, driver.device_id, input.commandId, hash, route.id,
      { eventId: null, occurredAt: now.toISOString(), executionRevision: route.revision + 1, duplicate: false });
  });
}
