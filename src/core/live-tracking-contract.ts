import type { ControlScreenType } from "./control-screens";
export const trackingPolicy = { uploadSeconds: 5, refreshSeconds: 5, freshSeconds: 30, maxSampleAgeMs: 120000 };
export const maxControlScreens = 32;
export type ControlScreen = { id: string; type: ControlScreenType; driverId: string; vehicleId: string };
