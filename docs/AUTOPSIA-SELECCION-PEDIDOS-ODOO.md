# Selección de pedidos Odoo — autopsia y línea base

Fecha de ejecución: 2026-09-11. Repositorio `frankzuuia/anarutas`, rama
`develop`, HEAD `b43d49b5b1a13d138faa23a8c09ed3048121772f`.
Al iniciar: árbol limpio y referencias locales develop/origin/develop iguales.
Servicio inspeccionado en EasyPanel: `ana-rutas-develop/app`, source develop
del mismo repositorio y commit. Sin cambios al servicio, commit, push o deploy.
Five, Ana V3 y Luna quedan fuera del alcance.

## Flujo comprobado en código

1. `src/components/orders-board.tsx`: LoadDialog activa `load` con camionetas
   y fecha; primero hace PUT a `/api/plans/[id]/vehicles` con expectedVersion.
2. `selectPlanVehicles` en `src/core/orders.ts` bloquea plan, verifica versión
   y disponibilidad, guarda flota, desasigna pedidos de unidades retiradas,
   incrementa versión y audita en una transacción.
3. Después, la UI recorre POST `/api/plans/[id]/orders` con from/to/cursor/ceiling.
   Cada página se persiste inmediatamente. Un fallo conserva las páginas anteriores.
4. El POST convierte fecha civil a UTC, comprueba límite del plan, flota y fuente.
   Invoca `readFulfilledPage` en `src/core/odoo.ts`.
5. Picking: empresa configurada, done, outgoing, destino customer y date_done
   dentro de [inicio, fin). Paginación por id asc, páginas de 50 y techo por ID.
6. Movimientos: done, cantidad ejecutada positiva, sale_line_id presente,
   origin_returned_move_id ausente. Enlace a venta por sale.order.line.order_id;
   venta sale/done. Cantidad y unidad negociadas por fields_get.
7. `persistImportPage`: actor activo, lock del plan, fuente vinculada, cliente
   asegurado, JSON snapshot y SHA-256, inserción con conflicto por identidad.
   Migración v4: UNIQUE(plan_id,source,picking_id,order_id).
8. Si ya existe un snapshot diferente, sólo cuenta changed; NO actualiza datos.
   Incrementa versión sólo si insertó; audita orders.imported por página.
9. GET reconstruye tablero con snapshot y preferencias locales de clientes.
   La UI actualiza tablero y cierra el modal al terminar las páginas.

El POST ordinario no exige expectedVersion actualmente. La selección de flota y
la importación no comparten transacción. No hay lote temporal ni revalidación
entre selección y confirmación. `SourceShipment.validatedAt` es obligatorio.
Estas son diferencias del contrato actual frente al requisito nuevo, no fallos
demostrados del comportamiento para el que fue construido.

## Conexiones que deben preservarse

- Manual: endpoint `/orders/manual`, `readFulfilledByOrderNames`, estado propio
  en UI; reutiliza hidratación y persistencia. Mantener semántica validada por folio.
- Borrado/reimportación: elimina copia local, normaliza posiciones y versiona;
  puede recuperarse con la misma identidad Odoo; otros planes independientes.
- Clientes: fuente/partner con FK; preferencias locales prevalecen en tablero.
- Mapa, Excel y optimización consumen OrderBoard; ampliar estado de validación
  sin confundirlo con prioridad ni impedir armar ruta por estar pendiente.
- `route-fingerprint.ts`: huella operativa usa ubicación, horario, prioridad,
  asignación, posición y flota; no usa validatedAt ni cantidades.
- Trigger `route_plan_recalculation` encola tras cambio de versión. Hay que
  preservar el recálculo automático y comprobar el tratamiento de cambios
  exclusivamente de ciclo Odoo antes de implementar.
- HTTP: sesión DB activa, Origin exacto, JSON y body máximo 8192 bytes;
  identidad y credenciales sólo servidor, request ID y errores sanitizados.
- Autenticar renueva expiración inactiva de sesión. Por tanto, «consulta sin
  persistencia» debe demostrar cero cambios del dominio del plan; no cero
  escrituras absolutas en DB, porque el propio plan exige guardar lote temporal,
  y autenticación/rate limit también tienen estado.

## Línea base ejecutada antes de editar implementación

| Comando               | Resultado                                    |
| --------------------- | -------------------------------------------- |
| npm test              | 29 archivos, 293 pruebas aprobadas; 133.95 s |
| npm run typecheck     | exit 0                                       |
| npm run lint          | exit 0                                       |
| npm run build         | exit 0; compilación 7.6 s                    |
| npm run test:coverage | 293 pruebas aprobadas; 107.14 s              |

Cobertura: statements 90.40% (1828/2022), branches 84.06% (1335/1588),
functions 96.55% (420/435), lines 91.97% (1696/1844).
Configuración existente excluye src/core/odoo.ts de cobertura. Su prueba
actual inspecciona AST/métodos permitidos; no sustituye contrato live.
Pruebas de persistencia usan PostgreSQL real con registros de prueba locales;
su aprobación no demuestra que existan pendientes reales en Odoo.
No se ejecutaron E2E ni mutation testing en esta línea base.

## Contrato Odoo leído en vivo

Configuración tomada exclusivamente de EasyPanel ana-rutas-develop/app.
No se guardan credenciales ni payloads RPC. Dos inspecciones: 25 + 6 llamadas,
únicamente common.version, common.authenticate y métodos de lectura
read, fields_get, search_count, search_read. Cero create/write/unlink.
Resultado: saas~19.4+e, empresa configurada autorizada; America/Mexico_City.

| Capacidad        | Odoo 19.4 observado                                                          | Odoo 17                       |
| ---------------- | ---------------------------------------------------------------------------- | ----------------------------- |
| Picking state    | draft, waiting, confirmed, assigned, done, cancel                            | Pendiente antes de producción |
| Fecha validada   | date_done datetime                                                           | Pendiente                     |
| Fecha programada | scheduled_date datetime                                                      | Pendiente                     |
| Actualización    | write_date datetime en los cuatro modelos                                    | Pendiente                     |
| Demanda move     | product_uom_qty float; product_qty float en UoM producto                     | Pendiente                     |
| Cantidad move    | quantity float                                                               | Pendiente                     |
| Unidad move      | uom_id many2one uom.uom                                                      | Pendiente                     |
| Venta            | move.sale_line_id → line.order_id; picking.sale_id disponible                | Pendiente                     |
| Sale state       | draft, sent, sale, cancel; no done en esta instalación                       | Pendiente                     |
| Retornos         | picking.return_id/return_ids; move.origin_returned_move_id/returned_move_ids | Pendiente                     |

Conteos en empresa configurada, outgoing y destino customer, sin límite de fecha:

| Estado    | Cantidad |
| --------- | -------: |
| done      |       11 |
| assigned  |        0 |
| confirmed |        0 |
| waiting   |        0 |
| draft     |        0 |
| cancel    |        0 |

Fecha 2026-09-11: intervalo UTC 2026-09-11 06:00:00 a 2026-09-12 06:00:00;
cero resultados en los seis estados. Se empleó date_done para done y
scheduled_date para el resto sólo como consulta diagnóstica.
Segunda inspección sin filtro destino: mismas 11 salidas, todas done.
11 ventas sale, todas con picking relacionado; 74 movimientos, todos done.
Muestra de ocho movimientos: demanda y quantity positivas e iguales,
sale_line_id presente y sin origin_returned_move_id.
Los date_done observados son 2026-09-09 UTC (día civil local 8 o 9), mientras
scheduled_date puede diferir. No usar create_date como sustituto.

## Puerta de avance

Puerta cerrada inicialmente por falta de una salida pendiente real. El usuario
creó después tres pedidos de prueba del 2026-09-11. Una nueva inspección
exclusivamente de lectura encontró:

| Pedido | Picking      | Estado   | Fecha relevante                        | Partidas |
| ------ | ------------ | -------- | -------------------------------------- | -------: |
| S00012 | WH/OUT/00012 | done     | date_done 2026-09-11 21:39:36 UTC      |        1 |
| S00013 | WH/OUT/00013 | done     | date_done 2026-09-11 21:40:09 UTC      |        3 |
| S00014 | WH/OUT/00014 | assigned | scheduled_date 2026-09-11 21:40:34 UTC |        3 |

S00014 pertenece a una venta en estado sale, no tiene date_done ni devolución,
y sus tres movimientos tienen demanda positiva (1, 1 y 2) conservando sus
unidades. Con esta evidencia se aprobó confirmed/assigned como pendiente y se
mantuvo waiting excluido, tal como exige el plan. No se ejecutó create, write,
unlink, action_confirm, button_validate ni ningún método mutador en Odoo.

La puerta deja de estar bloqueada. El contrato definitivo y la ejecución por
bloques están en BLOQUE-SELECCION-ODOO.md.
