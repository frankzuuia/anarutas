export type GoogleConsumptionLevel =
  "healthy" | "attention" | "warning" | "critical" | "charging" | "unpriced";

export type GoogleConsumptionSku = {
  skuId: string;
  skuName: string;
  serviceName: string;
  usage: number;
  pricingUnit: string;
  freeLimit: number | null;
  remaining: number | null;
  percentage: number | null;
  nextTierPrice: number | null;
  nextTierQuantity: number | null;
  grossCost: number;
  credits: number;
  netCost: number;
  level: GoogleConsumptionLevel;
};

export type GoogleConsumptionDay = {
  date: string;
  grossCost: number;
  credits: number;
  netCost: number;
};

export type GoogleConsumptionMonth = {
  periodStart: string;
  grossCost: number;
  credits: number;
  netCost: number;
};

export type GoogleConsumptionSnapshot = {
  mapsProjectId: string;
  currentPeriod: string;
  currency: string;
  providerExportTime: string | null;
  pricingAsOfTime: string;
  grossCost: number;
  credits: number;
  netCost: number;
  maximumPercentage: number | null;
  skus: GoogleConsumptionSku[];
  days: GoogleConsumptionDay[];
  months: GoogleConsumptionMonth[];
};

export type GoogleConsumptionState = {
  configured: boolean;
  status: "unconfigured" | "empty" | "ready" | "syncing" | "stale";
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  nextSyncAt: string | null;
  errorCode: string | null;
  snapshot: GoogleConsumptionSnapshot | null;
};
