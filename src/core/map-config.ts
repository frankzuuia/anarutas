export type MapConfig =
  | { configured: false }
  | { configured: true; browserKey: string; mapId: string };
/** Only a separately restricted browser key is public. Never fall back to server credentials. */
export function readMapConfig(
  env: Record<string, string | undefined> = process.env,
): MapConfig {
  const browserKey = env.RUTAS_GOOGLE_MAPS_BROWSER_KEY?.trim();
  const mapId = env.RUTAS_GOOGLE_MAP_ID?.trim();
  return browserKey && mapId
    ? { configured: true, browserKey, mapId }
    : { configured: false };
}
