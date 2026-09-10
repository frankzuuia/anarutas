export const customerPriorities = ["high", "medium", "schedule"] as const;
export type CustomerPriority = (typeof customerPriorities)[number];

export const fulfillmentModes = ["delivery", "pickup"] as const;
export type FulfillmentMode = (typeof fulfillmentModes)[number];

export type CustomerWindow = {
  id: string;
  days: number[];
  startMinute: number;
  endMinute: number;
  position: number;
};

export type Customer = {
  id: string;
  odooPartnerId: number;
  odooParentId: number | null;
  odooCommercialPartnerId: number | null;
  odooType: string;
  odooIsCompany: boolean;
  odooActive: boolean;
  odooName: string;
  odooRef: string | null;
  odooPhone: string | null;
  odooMobile: string | null;
  odooAddress: string;
  parentName: string | null;
  commercialName: string | null;
  displayName: string;
  phone: string | null;
  deliveryNote: string;
  priority: CustomerPriority;
  fulfillmentMode: FulfillmentMode;
  deliveryAddress: string;
  mapUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  placeId: string | null;
  locationStatus: "pending" | "confirmed" | "driver_confirmed";
  locationVersion: number;
  archivedAt: string | null;
  version: number;
  windows: CustomerWindow[];
};

export type CustomerList = {
  customers: Customer[];
  active: number;
  archived: number;
  nextCursor: string | null;
  hasMore: boolean;
};

export type SourceCustomer = {
  partnerId: number;
  parentId: number | null;
  parentName: string | null;
  commercialPartnerId: number | null;
  commercialName: string | null;
  companyId: number | null;
  type: string;
  isCompany: boolean;
  active: boolean;
  name: string;
  reference: string | null;
  phone: string | null;
  mobile: string | null;
  address: string;
};

export type CustomerSyncPage = {
  fingerprint: string;
  customers: SourceCustomer[];
  nextCursor: number;
  ceiling: number;
  hasMore: boolean;
};

export type CustomerSyncResult = {
  inserted: number;
  existing: number;
  sourceChanged: number;
  nextCursor: number;
  ceiling: number;
  hasMore: boolean;
};

export type EffectiveDeliveryWindow = {
  startMinute: number;
  endMinute: number;
};
