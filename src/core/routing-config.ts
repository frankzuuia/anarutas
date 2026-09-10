import { AppError } from "./errors";

type Env = Record<string, string | undefined>;
export type GoogleServiceAccount = {
  type: "service_account";
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri: "https://oauth2.googleapis.com/token";
};

function required(env: Env, key: string) {
  const value = env[key]?.trim();
  if (!value) throw new AppError("ROUTING_CONFIG_MISSING", 503);
  return value;
}

function decodeServiceAccount(encoded: string): GoogleServiceAccount {
  if (encoded.length > 65536) throw new AppError("ROUTING_CONFIG_INVALID", 503);
  let parsed: unknown;
  try {
    const bytes = Buffer.from(encoded, "base64");
    if (
      bytes.toString("base64").replaceAll("=", "") !==
      encoded.replaceAll("=", "")
    )
      throw new Error("invalid base64");
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new AppError("ROUTING_CONFIG_INVALID", 503);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new AppError("ROUTING_CONFIG_INVALID", 503);
  const value = parsed as Record<string, unknown>;
  if (
    value.type !== "service_account" ||
    typeof value.project_id !== "string" ||
    typeof value.client_email !== "string" ||
    !value.client_email.endsWith(".iam.gserviceaccount.com") ||
    typeof value.private_key !== "string" ||
    !value.private_key.includes("BEGIN PRIVATE KEY") ||
    value.token_uri !== "https://oauth2.googleapis.com/token"
  )
    throw new AppError("ROUTING_CONFIG_INVALID", 503);
  return value as GoogleServiceAccount;
}

export function readRoutingDefaults(env: Env = process.env) {
  return { depotAddress: env.RUTAS_DEPOT_ADDRESS?.trim().slice(0, 500) || "" };
}

export function readGoogleRoutingConfig(env: Env = process.env) {
  const projectId = required(env, "RUTAS_GOOGLE_CLOUD_PROJECT_ID");
  if (
    projectId.length > 200 ||
    ![...projectId].every((character) =>
      "abcdefghijklmnopqrstuvwxyz0123456789-".includes(character),
    )
  )
    throw new AppError("ROUTING_CONFIG_INVALID", 503);
  const credentials = decodeServiceAccount(
    required(env, "RUTAS_GOOGLE_SERVICE_ACCOUNT_JSON_BASE64"),
  );
  if (credentials.project_id !== projectId)
    throw new AppError("ROUTING_CONFIG_INVALID", 503);
  return { projectId, credentials };
}
