# Bloque 2A — flota, choferes y documentos privados

Autorización: «dale» después del plan de camionetas/choferes/asignación/pruebas. No incluye clientes, importación Odoo, rutas por fecha, optimización, APK o agente todavía.

## Reglas y flujo

- BL-007: administradores autenticados registran/editan unidades (nombre operativo, marca, modelo, placas, kilometraje, combustible, disponible/no disponible). Placa normalizada única. Sin eliminación física ni pérdida de historial.
- BL-008: registran/editan choferes (nombre, teléfono, contacto/teléfono de emergencia, tipo sanguíneo opcional, activo/inactivo). Fotos de chofer y ambos lados de licencia en ficha privada. No se crean cuentas de acceso para choferes en este bloque.
- BL-009: cada unidad puede tener un chofer actual; un chofer no puede estar simultáneamente asignado a dos unidades. Reasignación/quitar asignación explícitas. Rechazar unidad no disponible o chofer inactivo para nuevas asignaciones. Poner no disponible/inactivo con asignación requiere primero quitarla, no se cambia silenciosamente. Asignación actual de flota, NO ruta publicada ni asignación diaria histórica.
- BL-010: archivos sólo disponibles con sesión. JPEG/PNG/WebP verificados por decodificación y coincidencia de tipo; no SVG/PDF/ejecutables. Reencodificación WebP sin metadatos ni reducción de resolución, máximo 8 MiB y 20 megapíxeles, una imagen no animada. Son límites de seguridad visibles, no límites del LLM. No nombres/rutas provistos por usuario. Fotos existentes sólo se reemplazan al confirmar una subida nueva.

## Diseño técnico / integridad

Migración aditiva v2 en PostgreSQL propio: `route_vehicles`, `route_drivers`, `route_driver_documents`. Mantiene todas las tablas v1 y verifica instalación. Transacción y bloqueo de migraciones existente. Los documentos pequeños de flota se almacenan como bytea para guardar foto+versión+auditoría atómicamente y respaldar junto con la DB; sin almacenamiento público ni nuevo proveedor requerido. Monitorizar tamaño y planificar migración a almacenamiento de objetos privado si volumen futuro lo requiere.

Servicios de dominio independientes reutilizables por futuras tools. Lecturas de lista completas de la flota propia, sin documentos binarios en lista. Versiones optimistas de edición. Escrituras serializadas con bloqueo transaccional de flota + índice UNIQUE(driver_id); revalidar actor activo dentro de transacción. UUID de alta estable por formulario para reintentos; repetición idéntica devuelve registro existente, payload distinto devuelve conflicto. Audit metadata sin teléfonos, sangre ni imágenes.

API: GET/POST `/api/vehicles`, PATCH `/api/vehicles/[id]`, PUT `/api/vehicles/[id]/driver`; GET/POST `/api/drivers`, PATCH `/api/drivers/[id]`; GET/PUT `/api/drivers/[id]/documents/[kind]`. Todas autenticadas, mutaciones Origin exacto; JSON existente para datos. Subida binaria limitada en streaming, cabecera X-Record-Version para evitar reemplazo obsoleto; throttle persistido y máximo dos decodificaciones por proceso. Respuesta privada no-store/nosniff, nunca nombre de fichero remoto. Endpoint de archivos no permite consultas a URL ni filesystem.

Pantallas compactas: Camionetas y Choferes en navegación. Formularios en diálogo nativo con foco/escape/cancelar; durante escritura no se cierra. Cada ficha de camioneta muestra estado y chofer, permite editar y asignar; desde asignación se puede registrar un chofer nuevo y regresar a la selección. Ficha de chofer con documentos e indicador de pendientes. Panel de planificación enlaza al registro de flota y explica que selección diaria/importación pertenecen al siguiente bloque.

## Matriz y pruebas

| Escenario | Datos / efecto esperado | Fallo/recuperación y validación |
| --- | --- | --- |
| F01 migrar instalación nueva o v1 con datos | Sólo crear tres tablas e incrementar versión, conservar usuarios/planes/sesiones | Real PG: repetir, concurrente, DB ajena y versión futura rechazadas |
| F02 alta/reintento de unidad y chofer | ID estable, auditoría una vez | Idempotencia real; misma placa/ID incompatible devuelve 409 |
| F03 edición simultánea | Sólo una versión se guarda | 409 conserva texto en UI, refrescar y reabrir |
| F04 asignación | Actor/vehículo/chofer activos; una unidad por chofer | Concurrencia real: sólo una operación gana, otra recibe conflicto |
| F05 inactivar/no disponible | Sin borrar ni desasignar silenciosamente | Rechazar si aún asignado; quitar asignación y reintentar |
| F06 datos inválidos | Ningún cambio de dominio | Kilometraje negativo/no finito, combustible/sangre inválidos, ID desconocido rechazados |
| F07 subir/reemplazar documento | Decode raster, dato/version/audit atómicos | Falso MIME/corrupto/SVG/animado/exceso rechazados conservando foto anterior |
| F08 documento privado | Sólo cuenta autenticada en esta instalación | Sin sesión/revocada 401, otros IDs 404, Origin ajeno 403; no cache público |
| F09 reinicio/dos sesiones | Flota/documentos/versiones persistidos y visibles tras actualizar | E2E real, sin fixtures visibles al usuario |
| F10 interfaz compacta | Alta/edición/asignación/subida accesibles teclado y móvil | Screenshots y no overflow a 375/940/1440; cancelar no escribe |

## Fuentes verificadas

- Next instalado: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` (params asíncronos/Route Handlers).
- https://www.postgresql.org/docs/current/explicit-locking.html (bloqueos transaccionales).
- https://sharp.pixelplumbing.com/api-constructor/ y https://sharp.pixelplumbing.com/api-output/ (validación/limitInputPixels/reencoding; sharp 0.35.4 ya usado por Next, se declara dependencia directa).
- https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html (autenticación, límites, allowlist, decodificación, almacenamiento privado).

## QA / liberación

Unidades de validación y upload; PG real para migración/CRUD/concurrencia/idempotencia/rollback/audit; E2E de flota y regresión auth/planes; cobertura medida, mutación de validadores y predicados críticos, lint/types/build/npm audit. No declarar producción lista sin Docker/Linux/Odoo pendientes del bloque 1. Migración local sólo después de pruebas con snapshot previo privado de las tablas existentes; comparar cuentas y borradores después. No eliminación automática de datos/archivos.

Veredicto: GREEN LIGHT para implementación local de bloque 2A; MATCH PERFECT con tareas F-T01..05 en PROGRESS. Límites y ownership no contradicen bloque1. Permisos: todos los administradores conservan creación de usuarios, mínimo6 aprobado. UI no simula herramientas ni entregas inexistentes.
