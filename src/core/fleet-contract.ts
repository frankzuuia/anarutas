export const fuels = [
  "Gasolina",
  "Diésel",
  "Eléctrico",
  "Híbrido",
  "Gas LP",
  "Gas natural",
  "Otro",
] as const;
export const bloodTypes = [
  "",
  "A+",
  "A-",
  "B+",
  "B-",
  "AB+",
  "AB-",
  "O+",
  "O-",
] as const;
export const documentKinds = [
  "photo",
  "license_front",
  "license_back",
] as const;
export type DocumentKind = (typeof documentKinds)[number];
export const documentLabels: Record<DocumentKind, string> = {
  photo: "Foto del chofer",
  license_front: "Licencia · frente",
  license_back: "Licencia · reverso",
};
// Security bounds for file parsing/storage, not LLM output limits.
export const maxDocumentBytes = 8 * 1024 * 1024;
export type Driver = {
  id: string;
  name: string;
  phone: string;
  emergency_name: string;
  emergency_phone: string;
  blood_type: string;
  active: boolean;
  version: number;
  documents: DocumentKind[];
};
export type Vehicle = {
  id: string;
  name: string;
  brand: string;
  model: string;
  plate: string;
  mileage: string;
  fuel: string;
  available: boolean;
  driver_id: string | null;
  driver_name: string | null;
  version: number;
};
