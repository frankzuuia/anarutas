# Bloque 4 — Clientes, horarios y puntos de entrega

Estado: autorizado para `develop` el 2026-09-09. Amplía BL-018..024 sin reemplazar BL-001..017. Odoo permanece estrictamente en sólo lectura.

## Reglas de negocio

- **BL-018 — Identidad y alcance.** El directorio recupera todos los `res.partner` visibles para la compañía configurada, incluidos compartidos, matrices, contactos, sucursales y direcciones; no filtra por `customer_rank`, ventas, teléfono ni tipo. La identidad única es `fingerprint Odoo + partner_id`. IDs distintos nunca se fusionan por nombre, teléfono o Excel.
- **BL-019 — Propiedad local protegida.** Nombre visible, teléfono operativo, ventanas, nota, prioridad, domicilio y punto pertenecen a Ana Rutas. Una sincronización actualiza solamente la copia de los campos fuente Odoo y añade identidades nuevas; no sobrescribe configuración local, aunque esté vacía, ni reactiva archivados.
- **BL-020 — Horarios y prioridad.** Cada cliente/sucursal admite varias ventanas semanales. La interfaz captura y muestra horario de 24 horas (`00:00–23:59`); el servidor guarda minutos inequívocos, rechaza duplicados, traslapes y fin anterior al inicio. Una ventana de once de la mañana a una de la tarde se registra `11:00–13:00`. Prioridades: Alta, Media y Por horario. Alta/Media sólo ordenan entre destinos factibles; nunca autorizan entregar fuera de una ventana.
- **BL-021 — Domicilio y ubicación.** El domicilio Odoo es semilla inicial. Al editarlo se invalida el punto anterior. Google puede proponer coordenadas, pero sólo un punto confirmado se vuelve canónico. Se guardan latitud, longitud, `place_id`, liga regenerada, estado, versión, actor y fecha. Un enlace nunca se trata como coordenada verificada.
- **BL-022 — Archivo reversible.** Archivar requiere confirmación y sólo afecta el registro local seleccionado; conserva identidad y configuración. No archiva hijos, no elimina pedidos y no escribe Odoo. Restaurar recupera el mismo registro. Los estados activo/inactivo Odoo y archivado local son independientes.
- **BL-023 — Planificador y exportaciones.** Cada surtido resuelve alias, teléfono, nota, prioridad, domicilio, ventanas efectivas y punto por `source + partner_id`, usando la fecha del plan. No modifica snapshot, posición ni camioneta. Las tarjetas del plan reutilizan los distintivos semánticos del directorio: Alta en amarillo, Media en azul y Por horario neutra, siempre acompañados por texto. Excel de clientes incluye hojas Clientes/Ventanas; Excel del plan incluye Ruta/Partidas. Ambos son snapshots consistentes, neutralizan fórmulas y no inventan ETA, distancia ni totales de unidades incompatibles.
- **BL-024 — Compatibilidad y futuro chofer.** El adaptador negocia campos con `fields_get`, solicita sólo capacidades existentes y funciona por contrato en Odoo 17 y SaaS 19.4. El servicio de ubicación es reutilizable y versionado; la aplicación futura del chofer deberá autenticar al chofer asignado y enviar su corrección a ese servicio. Este bloque no simula una app o identidad de chofer que todavía no existe.
- **BL-025 — Editor ocultable y exportación controlada.** El administrador puede ocultar el editor para devolver todo el ancho al directorio. Si existen cambios locales debe confirmar su descarte; cancelar conserva el formulario. Buscar o sincronizar no reabre un panel oculto y seleccionar una fila sí lo reabre. La interfaz operativa ofrece únicamente Exportar Excel; la aplicación inicial del directorio no se expone como importación libre desde el navegador. Archivar y quitar ventana usan controles destructivos compactos en escritorio y conservan objetivos táctiles seguros.

## Contratos y límites

- `GET /api/customers`: búsqueda normalizada y paginada, con pestaña activa o archivada. Busca alias, nombre Odoo, matriz, teléfonos, domicilio y referencia.
- `POST /api/customers/sync`: página estable por ID y techo fijado en la primera llamada; reintentos idempotentes. El cliente continúa hasta `hasMore=false`.
- `PATCH /api/customers/:id`: lista cerrada de campos, `expectedVersion`, máximo 32 ventanas, 7 días por ventana, textos acotados y transacción única.
- `POST|DELETE /api/customers/:id/archive`: archivar/restaurar con versión.
- `GET /api/customers/export` y `GET /api/plans/:id/export`: sesión obligatoria, `no-store`, XLSX real y nombre seguro.
- La búsqueda normaliza Unicode, mayúsculas y espacios para comparar, pero conserva el texto original. La paginación no limita el total sincronizado.
- `phone` y `mobile` se preservan por separado. El teléfono operativo inicia con `phone` o, en su ausencia, `mobile`; después queda protegido localmente.
- Jerarquía fuente conserva `parent_id`, `commercial_partner_id` y tipo de contacto. Una matriz archivada no oculta sucursales activas.
- Un cambio concurrente con versión obsoleta falla con 409 y no pisa el cambio anterior. Toda escritura relevante queda auditada sin secretos ni contenido completo del cliente.

## Estados de ubicación

- `pending`: no hay punto confirmado o el domicilio cambió.
- `confirmed`: punto aceptado por administrador.
- `driver_confirmed`: reservado para el servicio de corrección autenticada del chofer. Una ruta en curso conservará orden, actualizará navegación/ETA pendiente y rutas futuras usarán la nueva versión. Entregas terminadas conservarán el punto histórico de su viaje cuando exista ese bloque operativo.

## Aceptación obligatoria

1. Importar partners con `customer_rank=0`, sin teléfono y con nombres repetidos.
2. Negociar ausencia de `mobile` sin solicitarlo; preservar `phone` y `mobile` cuando ambos existan.
3. Interrumpir/reanudar sync sin duplicar ni anunciar éxito falso.
4. Editar, sincronizar y comprobar que ningún override ni archivo cambió.
5. Guardado concurrente: un éxito y un conflicto sin pérdida.
6. Archivar, sincronizar y restaurar la misma identidad/configuración.
7. Buscar ignorando acentos, mayúsculas y espacios sobre todo el directorio.
8. Validar horario de 24 horas, múltiples días, duplicados, traslapes y sábado/domingo.
9. Cambiar domicilio, invalidar pin; confirmar/arrastrar punto y versionarlo.
10. Resolver en tablero/mapa/exportación exactamente la misma preferencia.
11. Generar y volver a abrir ambos XLSX; neutralizar celdas `=`, `+`, `-`, `@`.
12. Rechazar usuario inactivo, Origin ajeno, payload grande, URL peligrosa, otra compañía/origen y versión obsoleta.
13. Ocultar el editor con y sin cambios, recuperar todo el ancho, reabrirlo al elegir cliente y comprobar que no existe Importar Excel.

Puertas: unitarias, PostgreSQL real, contrato Odoo estático y smoke read-only contra develop 19.4 cuando esté disponible, Gherkin, E2E, cobertura >=90% del dominio nuevo con rutas críticas completas, mutación de identidad/overrides/ventanas, build, lint, auditoría de dependencias y QA visual 375/768/1024/1440. Producción Odoo 17, Maps real y aplicación del directorio Excel requieren preflight/vista previa antes de cualquier promoción o escritura en la base productiva.
