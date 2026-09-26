export const controlScreenTypes = [
  { id: "routes", label: "Ruta en vivo", description: "Mapa, ubicación y avance por chofer" },
  { id: "progress", label: "Avance de rutas", description: "Paradas y pedidos, sin mapa" },
  { id: "incidents", label: "Incidencias en vivo", description: "Evidencias y gestión operativa" },
  { id: "panel:plans", label: "Planificar rutas", description: "Planes, pedidos y asignaciones" },
  { id: "panel:incidents", label: "Incidencias", description: "Llegadas y repuntes" },
  { id: "panel:vehicles", label: "Camionetas", description: "Administración de la flota" },
  { id: "panel:unit_control", label: "Control de unidades", description: "Fotografías y estado de las unidades" },
  { id: "panel:drivers", label: "Choferes", description: "Personal y documentos" },
  { id: "panel:customers", label: "Clientes y horarios", description: "Domicilios, teléfonos y recepción" },
  { id: "panel:users", label: "Usuarios y accesos", description: "Cuentas y permisos del panel" },
  { id: "panel:audit", label: "Auditoría", description: "Registro de operaciones" },
  { id: "panel:consumption", label: "Control de consumo", description: "Uso de servicios Google" },
] as const;
export type ControlScreenType = typeof controlScreenTypes[number]["id"];
export type EmbeddedSection = Exclude<ControlScreenType, "routes" | "progress" | "incidents"> extends `panel:${infer S}` ? S : never;
