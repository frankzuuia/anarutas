export const errors: Record<string, string> = {
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
    "Otra persona modificó este borrador. Actualiza la lista antes de volver a guardarlo.",
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
    throw new Error(
      errors[result.error] ||
        "No se pudo completar la operación. Inténtalo nuevamente.",
    );
  }
  return result as T;
}
