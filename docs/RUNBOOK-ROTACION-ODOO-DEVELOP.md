# Rotación del Odoo de pruebas de Ana Rutas develop

Procedimiento operativo y evidencia de la rotación del 8 de octubre de 2026.
Este documento permite repetir el cambio de cuenta de prueba sin mezclar
instalaciones ni reconstruir los horarios y puntos a mano.

## Alcance y límites

- Exclusivamente el proyecto EasyPanel `ana-rutas-develop`, sus servicios
  `app` y `db`, y la aplicación
  `https://ana-rutas-develop-app.bfmayj.easypanel.host`.
- En esta ejecución, EasyPanel de desarrollo fue `https://panel.frkqr.com`.
  PostgreSQL fue `ana_rutas`, con host interno `ana-rutas-develop_db`.
- Producción, `main`, Five/ventas y otras bases están prohibidos.
- Los nombres anteriores identifican la instalación comprobada en esta fecha.
  Antes de otra rotación se deben confirmar contra el entorno real.
- No cambiar código, esquema permanente, imágenes, Google, cuentas, PIN,
  permisos ni configuración del sistema.
- No importar pedidos del Odoo nuevo. Queda preparado sólo el directorio.
- Nunca escribir credenciales en el documento, mensajes, comandos visibles,
  logs o reportes. Leerlas únicamente desde el entorno de `app`.
- Esta ejecución se hizo **sin respaldo por instrucción expresa del propietario**.
  Esa instrucción no autoriza prescindir de respaldo en otra operación: resolver
  su política con el propietario antes del borrado, sin crear uno a sus espaldas.

## Por qué «Actualizar clientes» no basta

El cambio de variables de EasyPanel no cambia la identidad guardada en la base.

`src/core/odoo-source.ts` compara el fingerprint de la conexión configurada con
`route_order_source.fingerprint`. Si son distintos, lanza
`ODOO_SOURCE_CHANGED` con HTTP 409. La interfaz muestra:

> La conexión de Odoo cambió respecto a los pedidos guardados.

Es una protección necesaria: el ID de un cliente o pedido puede existir también
en otra cuenta y corresponder a una persona u operación diferente.

No se resuelve refrescando, reiniciando, borrando únicamente clientes ni cambiando
sólo el fingerprint. Tampoco se debe quitar la protección del código.

## Primer bloque: descubrir y contar, sin cambios

1. Confirmar la raíz del repositorio, `AGENTS.md`, rama `develop` y estado Git.
   Consultar `docs/PROGRESS.md` y `docs/MASTER-SPECIFICATION.md`.
2. Identificar en el EasyPanel de desarrollo los contenedores actuales de
   `ana-rutas-develop_app` y `ana-rutas-develop_db`. No reutilizar sus IDs de
   contenedor de una ejecución anterior.
3. Desde `app`, verificar sin mostrar secretos:
   - `RUTAS_APP_ORIGIN`;
   - host y nombre de `RUTAS_DATABASE_URL`;
   - `current_database()`;
   - `rutas_installation.instance_id` y `schema_version`;
   - origen y base de `ODOO_URL` / `ODOO_DATABASE`;
   - compañía permitida y fingerprint antiguo.
4. Leer el esquema real: tablas base, columnas, claves, restricciones, triggers
   y funciones de triggers. Distinguir vistas de tablas.
5. Leer los contratos reales, especialmente:
   - `src/core/config.ts`;
   - `src/core/odoo-source.ts`;
   - `src/core/odoo.ts`;
   - `src/core/customers.ts` y `customers-validation.ts`;
   - `customers-schema.ts` y `customer-windows-daily-schema.ts`;
   - esquemas de pedidos, publicaciones, ejecuciones, seguimiento,
     incidencias, finanzas, pagos, liquidación y fotos de unidades.
6. Autenticar y consultar el Odoo nuevo mediante RPC **de sólo lectura**.
   Verificar versión, compañía, campos disponibles y clientes reales.
   Odoo 20 puede tener campos distintos: no presuponer `mobile` u otros campos.
7. Contar cada categoría antes de cualquier borrado. Demostrar qué source
   tienen clientes, pedidos, lotes y proyecciones financieras.
8. Comprobar que no haya optimizaciones ni recálculos en curso. Si los hay,
   detener esta operación y resolverlos dentro del alcance autorizado.
9. Conservar un diagnóstico temporal privado sólo para el cruce y las
   verificaciones. No convertirlo en respaldo si el propietario lo prohibió.

El fingerprint se calcula conforme al código instalado:
SHA-256 de `JSON.stringify([ODOO_URL.origin, ODOO_DATABASE, companyId])`.
No copiar un fingerprint de esta rotación para otra cuenta.

## Segundo bloque: cruzar clientes y proteger su configuración

### Excel

El exportador ya incluye dos hojas:

- **Clientes**: nombres, matriz, teléfonos, prioridad, modalidad, notas,
  domicilios, Maps, coordenadas y estado del punto.
- **Ventanas**: cliente, Desde (24 h), Hasta (24 h) y Orden.

«Por horario» es la prioridad, no el intervalo. Los intervalos están en
**Ventanas**. No modificar el exportador para resolver una rotación.

### Correspondencia

- Cruzar Cliente y Nombre en Odoo; comprobar tipo de contacto y matriz.
- Ignorar los IDs numéricos antiguos como criterio de correspondencia.
- Resolver sucursales por su matriz. «ABARROTES FRANCO» y su dirección de
  entrega «Abarrotes Franco» son contactos distintos.
- Exigir coincidencia única. Si falta un cliente activo o el cruce es ambiguo,
  no guardar ni deducir la identidad sólo por cercanía del nombre.
- Revalidar los contactos nuevos mediante lectura RPC antes de escribir.
- Mantener el UUID interno de cada cliente coincidente. Así conserva ventanas,
  punto e historial de ubicación sin reingreso manual.
- Actualizar únicamente source, IDs/relaciones y metadatos procedentes del Odoo
  nuevo, snapshot, hash del snapshot y clave de búsqueda.
- Mantener datos operativos, overrides, autores, versiones y configuración de
  descarga. No incrementar la versión operacional para esta revinculación:
  su trigger puede programar recálculos.
- Eliminar contactos antiguos no encontrados sólo después de comprobar que
  son prescindibles y que no tienen ventanas, puntos ni referencias que conservar.
- La consulta real de Odoo incluye todos los contactos visibles de la compañía,
  no sólo los que tienen `customer_rank`. Los usuarios técnicos nuevos
  identificados como tales quedaron archivados, sin convertirse en clientes
  operativos. No archivar contactos desconocidos por inferencia.

### Ventanas y puntos

- Mantener ventanas ya existentes. Completar faltantes sólo si el Excel las
  especifica y existe autorización para editarlas.
- El panel instalado utiliza ventanas diarias Desde/Hasta de 24 horas,
  **sin días de semana**. No restaurar la antigua lógica de días.
- No inventar ventanas para «Recoge», «Por definir» o filas sin horario.
- Preservar domicilio operativo, Maps, latitud/longitud, place ID, estado y
  versión del punto, notas, teléfonos, prioridades y modalidad.
- Si falta una ventana o punto, utilizar la ficha y validaciones reales de
  Ana Rutas, en lotes pequeños. Antes de cada guardado comprobar cliente y
  matriz; después releer el resultado.
- No hacer geocodificación ni llamadas Google para puntos ya conservados.
  «Punto confirmado» conservado no significa una nueva validación física.

## Tercer bloque: retirar únicamente el origen anterior

### Dependencias que impiden un borrado simple

Los clientes y envíos no son datos aislados. Las ejecuciones incluyen órdenes,
paradas, eventos, incidencias, cobros, liquidación y seguimiento.

Además, `route_driver_executions` no tiene FK a planes/publicaciones por diseño.
Puede haber ejecuciones de planes ya eliminados. En esta ejecución había tres.
Su pertenencia al Odoo anterior se comprobó mediante todas sus paradas y
clientes, no sólo mediante los planes aún existentes.

Las fotos de unidades tienen una FK con borrado en cascada:

`route_unit_photos(plan_id, vehicle_id)` →
`route_plan_vehicles(plan_id, vehicle_id)`.

Borrar esas asignaciones también borraría fotos. Por eso se conservaron sus
asignaciones mínimas y sus planes como **anclas históricas archivadas**, sin
pedidos, publicaciones, ejecuciones ni optimizaciones.

### Operación ejecutada

Se realizó una única transacción administrativa mediante Node y PostgreSQL
en el contenedor `app` de desarrollo, sin modificar la aplicación:

1. Guardas de entorno, base, instalación, versión de esquema y fingerprint.
2. Lectura fresca del Odoo nuevo, sólo RPC de autenticación/lectura.
3. Bloqueo `SHARE ROW EXCLUSIVE` de las tablas base de esta instalación para
   impedir cambios concurrentes durante la sustitución.
4. Revalidación de clientes y ventanas frente al diagnóstico y el Excel.
5. Captura de hashes de las tablas protegidas y campos operativos **en memoria**,
   para comparación dentro de la transacción, sin generar respaldo.
6. Obtención explícita de IDs del origen anterior: planes, ejecuciones,
   incidencias, pagos, solicitudes, optimizaciones y envíos.
7. Uso de `SET LOCAL session_replication_role='replica'` exclusivamente en
   esa conexión y transacción administrativa. Permite retirar datos de prueba
   protegidos por triggers de inmutabilidad y reemplazar la FK de source.
   No se deshabilitaron triggers globalmente ni se alteró el esquema.
8. Borrados con filtros de source/IDs demostrados, dependencias primero.
9. Las tres referencias de ubicación a envíos eliminados se dejaron en NULL,
   conservando todos los demás campos y las 120 filas del historial.
   Esto se hizo explícitamente porque el modo temporal no ejecuta
   `ON DELETE SET NULL`.
10. Archivo de las anclas de fotos y eliminación de asignaciones sin fotos y
    del plan que no necesitaba conservación.
11. Actualización del source singleton y revinculación de clientes
    coincidentes al Odoo nuevo. Los cinco contactos técnicos nuevos se
    insertaron archivados.
12. Restauración de `session_replication_role='origin'` **antes de validar**.
13. Comprobación de cada FK real por columnas, incluyendo claves compuestas.
    No confiar en que los triggers omitidos hayan validado los borrados.
14. Comparación de hashes protegidos, campos operativos, ventanas, fotos y
    conteos. Cualquier fallo produce ROLLBACK.
15. Registro `odoo.source.rotated` en `route_audit` y notificación existente
    `ana_rutas_panel`, sin credenciales en el detalle.
16. COMMIT sólo después de todas las comprobaciones.

**Esta modalidad administrativa no debe copiarse como un reset genérico.**
Omitir triggers también omite las cascadas y reglas de dominio. Hay que
descubrir y verificar nuevamente cada dependencia. El script temporal de
esta ejecución no es un comando permanente ni una herramienta de la aplicación.

Antes del COMMIT final se ensayó el mismo procedimiento sobre la base real
terminando en ROLLBACK. El primer ensayo también revirtió: el lector PostgreSQL
devolvía nombres de columnas como `name[]`, no como un array JavaScript.
La consulta de verificación se corrigió a `array_agg(attname::text)`.
El segundo ensayo completo pasó y después se ejecutó el COMMIT validado.

### Categorías retiradas

| Categoría | Tablas |
| --- | --- |
| Descargas derivadas de visitas viejas | route_unloading_observations, route_unloading_visits |
| Liquidación y cobros anteriores | route_settlement_claims, route_settlement_items, route_settlement_requests, route_order_payments |
| Incidencias de productos anteriores | route_product_incident_changes, route_product_incident_photos, route_product_incidents |
| Incidencias de servicio anteriores | route_driver_incident_events, route_driver_incident_evidence, route_driver_incident_orders, route_driver_service_incidents |
| Ejecución y seguimiento anteriores | route_live_tracking, route_tracking_sessions, route_driver_command_receipts, route_driver_execution_completions, route_driver_work_completions, route_finance_execution_orders, route_driver_stop_events, route_driver_execution_orders, route_driver_execution_stops, route_driver_executions |
| Armado y recálculo anteriores | route_optimization_stops, route_optimization_runs, route_optimization_leases, route_recalculation_jobs |
| Planificación y notificaciones de rutas viejas | route_order_batches, route_mobile_push_deliveries, route_publication_revisions, route_plan_creation_requests, route_plan_publications |
| Envíos y proyección Odoo anterior | route_shipments, route_financial_revisions, route_financial_targets, route_financial_sync_state |
| Padres mínimos | route_plan_vehicles y route_plans sólo sin fotos; con fotos se archivaron los planes |
| Contactos sin correspondencia | Tres contactos técnicos antiguos archivados, sin referencias operativas |

No se utilizó `TRUNCATE CASCADE`, no se borró la base y no se hizo un borrado
por nombre de cliente sobre múltiples instalaciones.

Se eliminaron filas de evidencias de incidencias de prueba; no se ejecutó un
borrado físico general del volumen de archivos. Las 80 fotos de unidades
y sus referencias se conservaron.

### Tablas comprobadas intactas por hash

`auth_attempts`, `route_users`, `route_drivers`, `route_vehicles`,
`route_driver_documents`, `route_driver_mobile_access`,
`route_driver_mobile_activations`, `route_driver_mobile_audit`,
`route_driver_mobile_challenges`, `route_driver_mobile_devices`,
`route_driver_mobile_sessions`, `route_driver_operation_settings`,
`route_google_consumption_state`, `route_routing_settings`,
`route_control_layouts`, `route_sessions`, `route_mobile_push_registrations`,
`route_unit_photos`, `route_customer_windows`,
`route_customer_windows_legacy` y `rutas_installation`.

También se compararon por separado todos los campos operativos de clientes
y todo el historial de ubicación salvo las referencias retiradas a envíos.

## Cuarto bloque: verificar y entregar

1. Abrir/releer Clientes y horarios en develop. Verificar IDs nuevos, nombres,
   matrices, horarios y estado de puntos.
2. Exportar nuevamente desde el enlace real de Ana Rutas. Comparar todas las
   filas de Clientes y Ventanas contra el Excel anterior, ignorando los IDs
   viejos y distinguiendo metadatos de Odoo de campos operativos.
3. Comprobar cero envíos antiguos, publicaciones, ejecuciones, seguimiento y
   planes activos. Las anclas archivadas de fotos no son rutas operativas.
4. Comprobar que el fingerprint guardado sea exactamente el calculado desde
   la configuración nueva y que no haya clientes vinculados al source viejo.
5. Confirmar cuentas, choferes, camionetas, APK, fotos y configuración intactas.
6. Comunicar al propietario que `Actualizar clientes` puede usarse después
   del cambio. En esta ejecución no se pulsó ese botón: el propietario indicó
   que realizaría la sincronización y los clientes ya quedaron revinculados.
7. Limpiar los auxiliares temporales de la operación; conservar el Excel del
   propietario y la auditoría sin secretos.
8. No hacer commit, push ni deploy sin la autorización aplicable. La rotación
   de datos no requiere recompilar, desplegar ni generar otra APK.

## Resultado exacto del 8 de octubre de 2026

Nuevo Odoo de pruebas: `developfive.odoo.com`, base `developfive`, compañía 1.
Esquema comprobado: versión 45. Estos valores son evidencia histórica;
no deben reutilizarse como condiciones de otro cambio de cuenta.

| Dato | Antes | Después |
| --- | ---: | ---: |
| Clientes totales | 124 | 126 |
| Clientes activos | 115 | 115 |
| Clientes archivados | 9 | 11 |
| Ventanas activas exportadas | 107 | 107 |
| Ventanas totales en base | 108 | 108 |
| Clientes activos sin horario | 8 | 8 |
| Puntos de clientes activos confirmados | 115 | 115 |
| Envíos/pedidos | 158 | 0 |
| Planes activos | 1 | 0 |
| Planes que sirven como anclas de fotos | 12 | 12 |
| Publicaciones | 16 | 0 |
| Ejecuciones | 35 | 0 |
| Paradas de ejecución | 89 | 0 |
| Órdenes de ejecución | 102 | 0 |
| Registros de seguimiento en vivo | 28 | 0 |
| Optimización: ejecuciones guardadas | 246 | 0 |
| Optimización: paradas guardadas | 1373 | 0 |
| Cobros anteriores | 12 | 0 |
| Solicitudes de liquidación anteriores | 6 | 0 |
| Usuarios | 2 | 2 |
| Choferes | 4 | 4 |
| Camionetas | 4 | 4 |
| Accesos móviles | 3 | 3 |
| Dispositivos móviles | 5 | 5 |
| Fotos de unidades | 80 | 80 |
| Historiales de ubicación | 120 | 120 |

- 121 contactos revinculados: 115 activos y seis archivados.
- Tres contactos técnicos antiguos retirados; cinco técnicos nuevos archivados.
- Los 115 clientes activos cambiaron de ID de Odoo sin cambiar UUID interno.
- 115 coincidencias únicas con el Excel; cero no encontrados y cero diferencias
  operativas o de ventanas. Cero ventanas añadidas manualmente: ya existían.
- En el Excel usado no había filas Recoge, Por definir, Sab ni DOM.
- Las ocho filas sin ventana conservaron esa ausencia; no se inventaron horas.
- 119 FKs reales verificadas y 21 tablas protegidas iguales por hash.
- Comparación posterior mediante el Excel descargado desde el panel:
  `ana-rutas-clientes-activos (1).xlsx`. Hojas Clientes y Ventanas completas,
  115 y 107 filas respectivamente, sin diferencias operativas.
- Ejemplo verificado en el navegador: ABARROTES FRANCO, ID antiguo 9 → nuevo 11,
  09:00–10:30, mismo domicilio, coordenadas y punto confirmado.
- Lectura posterior al COMMIT: cero pedidos, publicaciones, ejecuciones y
  planes activos; dos usuarios, cuatro choferes, cuatro camionetas,
  tres accesos móviles y 80 fotos.
- Auditoría registrada en la base de develop con acción `odoo.source.rotated`.
- Cero llamadas Google Routes/Optimization, cero escrituras Odoo y cero
  cambios de código, commit, push o despliegue durante la rotación.
- No se accedió a producción durante esta operación.
