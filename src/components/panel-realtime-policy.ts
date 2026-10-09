// Keep operational alerts connected without refreshing hidden screens.
export function panelRealtimeMode(
  visibility: DocumentVisibilityState,
  backgroundEnabled: boolean,
): "foreground" | "background" | "paused" {
  if (visibility === "visible") return "foreground";
  return backgroundEnabled ? "background" : "paused";
}
