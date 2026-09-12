import type { SourceShipment } from "./orders-contract";

export type RoutingShipment = SourceShipment & {
  odooPickingState: string;
  fulfillmentStatus: "validated" | "pending_validation";
  scheduledAt: string | null;
  sourceUpdatedAt: string;
};
export type Candidate = {
  candidateId: string;
  shipment: RoutingShipment;
  hash: string;
  alreadyLoaded: boolean;
  hasCoordinates: boolean;
};
export type CandidateBatch = {
  batchId: string;
  date: string;
  expectedVersion: number;
  expiresAt: string;
  candidates: Candidate[];
  total: number;
  validated: number;
  pending: number;
  existing: number;
};
export type CandidateSelection = {
  mode: "explicit" | "all_except";
  ids: string[];
};
export type ConfirmationResult = {
  selected: number;
  inserted: number;
  existing: number;
  updated: number;
  pending: number;
  validated: number;
  rejected: number;
  version: number;
};
