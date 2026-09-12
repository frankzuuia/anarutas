export const errors: Record<string, string> = {
  CANDIDATE_CHANGED:
    "Algunos pedidos cambiaron en Odoo. No se guardó la selección; vuelve a consultar",
  CANDIDATE_INVALID:
    "La selección no pertenece a esta consulta. Vuelve a consultar.",
  CANDIDATE_BATCH_INVALID:
    "La consulta ya no está disponible para este plan. Vuelve a consultar.",
  CANDIDATE_BATCH_EXPIRED:
    "La consulta caducó. Vuelve a consultar los pedidos.",
  CANDIDATE_BATCH_CONSUMED:
    "Esta consulta ya fue confirmada. Abre una nueva consulta.",
  CANDIDATES_LIMIT:
    "La consulta excede el límite configurado. No se guardó ningún pedido; solicita revisar el límite de la instalación.",
  SELECTION_EMPTY: "Selecciona al menos un pedido.",
  GOOGLE_CONSUMPTION_CONFIG_MISSING:
    "Falta configurar la integración privada de Cloud Billing y BigQuery.",
  GOOGLE_CONSUMPTION_CONFIG_INVALID:
    "La configuración privada del control de consumo no es válida.",
  GOOGLE_CONSUMPTION_DENIED:
    "Google rechazó la cuenta FinOps. Revisa sus permisos de BigQuery.",
  GOOGLE_CONSUMPTION_EXPORT_MISSING:
    "No se encontraron juntas las exportaciones Standard y Pricing de Cloud Billing.",
  GOOGLE_CONSUMPTION_QUOTA:
    "BigQuery rechazó temporalmente la consulta por cuota. Se conserva el último corte.",
  GOOGLE_CONSUMPTION_RESPONSE_INVALID:
    "Google devolvió un corte de consumo incompleto. Se conserva el último dato válido.",
  GOOGLE_CONSUMPTION_CACHE_INVALID:
    "El último corte guardado no pasó la validación de integridad.",
  GOOGLE_CONSUMPTION_UNAVAILABLE:
    "Google no pudo actualizar el consumo. Se conserva el último corte oficial.",
  ROUTING_AI_CONFIG_MISSING:
    "Falta configurar la clave privada y el modelo de OpenAI para armar rutas.",
  ROUTING_AI_CONFIG_INVALID: "La configuración privada de OpenAI no es válida.",
  ROUTING_AI_DENIED:
    "OpenAI rechazó la credencial del planificador. Revisa el proyecto y sus permisos.",
  ROUTING_AI_QUOTA: "OpenAI alcanzó su límite de uso. El borrador no cambió.",
  ROUTING_AI_UNAVAILABLE:
    "OpenAI no pudo completar la planificación. El borrador no cambió.",
  ROUTING_AI_RESPONSE_INVALID:
    "OpenAI no completó el proceso de herramientas. El borrador no cambió.",
  ROUTING_AI_CANDIDATE_INVALID:
    "La propuesta de IA omitió, duplicó o usó datos ajenos al plan y fue rechazada.",
  ROUTING_AI_PRIORITY_INVALID:
    "La propuesta de IA no respetó Alta, después Media y después Por horario.",
  ROUTING_CUSTOMER_GROUP_INVALID:
    "La propuesta separó pedidos del mismo cliente. No se guardó; vuelve a armar la ruta.",
  ROUTING_ROADS_CONFIG_MISSING:
    "Falta configurar la credencial privada de Google Routes para recalcular los recorridos.",
  ROUTING_NOT_CALCULATED:
    "Arma la ruta una vez para activar el recálculo automático de tus cambios.",
  ROUTING_DEPARTURE_INVALID:
    "Escribe una hora de salida válida en formato de 24 horas: HH:mm.",
  ROUTING_DEPARTURE_REQUIRED:
    "Configura la hora de salida de este plan antes de calcular sus rutas.",
  CUSTOMER_WINDOWS_INVALID:
    "Revisa los días y el horario de 24 horas. Cada ventana debe terminar después de comenzar.",
  CUSTOMER_WINDOWS_OVERLAP:
    "Dos ventanas se traslapan el mismo día. Corrige los horarios antes de guardar.",
  CUSTOMER_MAP_URL_INVALID:
    "La liga debe ser HTTPS y pertenecer a Google Maps.",
  MANUAL_ORDERS_INVALID:
    "Agrega entre 1 y 50 folios con el formato S seguido de números.",
  MANUAL_ORDERS_DUPLICATED: "Quita los folios repetidos antes de continuar.",
  MANUAL_ORDERS_UNAVAILABLE:
    "Estos folios no tienen un surtido validado elegible en la empresa configurada",
  MANUAL_ORDERS_LIMIT:
    "El lote contiene demasiados surtidos. Divídelo en consultas más pequeñas.",
  ODOO_PICKER_FIELD_INVALID:
    "El campo configurado para la nota del picker no existe o no es de texto en este Odoo.",
  ODOO_PICKER_FIELD_AMBIGUOUS:
    "Odoo tiene más de un campo Nota para picker. Se debe identificar el campo correcto antes de cargar.",
  SELECT_VEHICLES: "Selecciona al menos una camioneta para continuar.",
  ODOO_SOURCE_CHANGED:
    "La conexión de Odoo cambió respecto a los pedidos guardados. Requiere revisión del administrador de la instalación.",
  ODOO_SCHEMA_UNSUPPORTED:
    "Esta versión de Odoo requiere revisar los campos de surtido antes de cargar pedidos.",
  ODOO_INCOMPLETE_READ:
    "Odoo no permitió leer todos los datos del lote. Revisa los permisos de la cuenta de integración.",
  ODOO_INVALID_RESPONSE:
    "Odoo devolvió datos incompletos. Vuelve a intentar la consulta.",
  DATE_BOUNDARY_UNSUPPORTED:
    "La zona horaria no permite resolver el inicio de esa fecha. Revisa el rango.",
  NOT_FOUND: "No se encontró el plan o pedido solicitado.",
  FLEET_INVALID:
    "Revisa los datos de la ficha: campos requeridos, kilometraje y opciones seleccionadas.",
  FLEET_NOT_FOUND: "No se encontró esa ficha o documento en esta instalación.",
  FLEET_CONFLICT:
    "La ficha cambió en otra sesión. Actualiza y vuelve a abrirla para revisar la versión más reciente.",
  PLATE_EXISTS: "Ya existe una camioneta con esas placas.",
  UNASSIGN_FIRST:
    "Primero quita la asignación del chofer antes de marcar la ficha como inactiva o no disponible.",
  DRIVER_ASSIGNED:
    "Ese chofer ya está asignado a otra camioneta. Quita esa asignación primero.",
  FLEET_UNAVAILABLE:
    "La camioneta debe estar disponible y el chofer activo para asignarlos.",
  PLAN_VEHICLE_NOT_FOUND:
    "La camioneta ya no pertenece a este borrador. La lista fue actualizada.",
  DOCUMENT_INVALID:
    "Sube una foto válida JPG, PNG o WebP, sin animación y de hasta 20 megapíxeles.",
  DOCUMENT_TOO_LARGE: "El archivo excede el máximo de 8 MB o está vacío.",
  DOCUMENT_BUSY:
    "Hay otras fotos procesándose. Vuelve a intentar en unos segundos.",
  LOGIN_INVALID: "Usuario o contraseña incorrectos.",
  PASSWORD_POLICY: "Usa una contraseña de entre 6 y 128 caracteres.",
  SETUP_DENIED:
    "No se pudo autorizar el alta inicial. Revisa la clave de instalación; este proceso sólo se permite una vez.",
  UNAUTHENTICATED: "Tu sesión terminó. Vuelve a iniciar sesión.",
  ORIGIN_DENIED: "La dirección del panel no coincide con su configuración.",
  VERSION_CONFLICT:
    "Otra persona modificó este registro. Actualiza la lista antes de volver a guardarlo.",
  ALREADY_EXISTS: "Ese usuario ya existe.",
  SELF_DEACTIVATION: "No puedes desactivar tu propia cuenta.",
  TOO_MANY_ATTEMPTS:
    "Hay demasiados intentos. Espera un minuto y vuelve a intentar.",
  AUTH_BUSY:
    "Hay otros accesos en proceso. Inténtalo de nuevo en unos segundos.",
  CONFIG_MISSING: "Falta completar la configuración de esta instalación.",
  CONFIG_INVALID: "La configuración de esta instalación no es válida.",
  SERVICE_UNAVAILABLE:
    "El servicio no está disponible. No se ha confirmado ningún cambio.",
  INSTALLATION_MISMATCH: "La base de datos no corresponde a esta instalación.",
  ODOO_UNAVAILABLE:
    "No se pudo conectar con Odoo. Revisa el servicio y vuelve a intentarlo.",
  ODOO_DENIED: "Odoo rechazó la consulta. Revisa el acceso de integración.",
  ODOO_COMPANY_DENIED:
    "La cuenta de integración no tiene acceso a la empresa configurada.",
  ODOO_CONFIG_INVALID:
    "La configuración de Odoo está incompleta o no es válida.",
  INVALID_DATE: "Selecciona una fecha válida.",
  INVALID_INPUT: "Revisa los campos del formulario.",
  INVALID_JSON: "La solicitud no es válida.",
  ROUTING_SETTINGS_INVALID:
    "Confirma una dirección y un punto de salida válidos antes de guardar.",
  ROUTING_ORIGIN_REQUIRED:
    "Configura y confirma el punto de salida antes de armar la ruta.",
  ROUTING_VEHICLES_REQUIRED:
    "Añade al menos una camioneta disponible antes de armar la ruta.",
  ROUTING_ORDERS_REQUIRED:
    "Carga al menos un pedido de entrega antes de armar la ruta.",
  ROUTING_POINTS_REQUIRED:
    "Todos los pedidos de entrega activos necesitan un punto confirmado.",
  ROUTING_CONFIG_MISSING:
    "Falta completar la configuración privada de Google para optimización.",
  ROUTING_CONFIG_INVALID:
    "La configuración privada de Google no corresponde a esta instalación.",
  ROUTING_GOOGLE_DENIED:
    "Google rechazó la credencial de optimización. Revisa el permiso del servicio.",
  ROUTING_GOOGLE_QUOTA:
    "Google alcanzó la cuota de optimización. El borrador no cambió.",
  ROUTING_GOOGLE_UNAVAILABLE:
    "Google no pudo calcular la ruta. El borrador no cambió; vuelve a intentarlo.",
  ROUTING_ALREADY_RUNNING:
    "Otra sesión ya está armando esta ruta. Espera el resultado antes de volver a intentarlo.",
  ROUTING_MODEL_REJECTED:
    "Las ventanas y prioridades no producen una ruta válida. Revisa los pedidos señalados.",
  ROUTING_RESPONSE_INVALID:
    "No se pudo interpretar la respuesta de Google. El borrador no fue modificado; el diagnóstico quedó registrado.",
  ROUTING_MODEL_INVALID:
    "Los datos del plan no permiten construir una ruta válida. Revisa fecha, horarios y puntos.",
};
export function navigateAfterAuth(path: "/" | "/login") {
  // A full navigation deliberately discards all private React/client cache on auth changes.
  window.location.assign(path);
}
export async function api<T>(
  path: string,
  method = "GET",
  input?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    ...(method === "GET" ? {} : { body: JSON.stringify(input ?? {}) }),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/session")
      navigateAfterAuth("/login");
    const base =
      errors[result.error] ||
      "No se pudo completar la operación. Inténtalo nuevamente.";
    const unavailable = Array.isArray(result.unavailableFolios)
      ? result.unavailableFolios.filter(
          (value: unknown): value is string => typeof value === "string",
        )
      : [];
    throw new Error(
      unavailable.length ? `${base}: ${unavailable.join(", ")}.` : base,
    );
  }
  return result as T;
}
