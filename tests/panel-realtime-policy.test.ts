import { expect, it } from "vitest";
import { panelRealtimeMode } from "../src/components/panel-realtime-policy";

it("refreshes visible screens and reserves hidden connections for activated alerts", () => {
  expect(panelRealtimeMode("visible", false)).toBe("foreground");
  expect(panelRealtimeMode("visible", true)).toBe("foreground");
  expect(panelRealtimeMode("hidden", false)).toBe("paused");
  expect(panelRealtimeMode("hidden", true)).toBe("background");
});
