# Liquidación: bloques 3 a 6 autorizados

2026-09-30. Autorización: «dale termina los bloques y al final probamos todo de una yo lo pruebo pero ya que tengas todo hecho». Base develop fdeda3d. QA física e instrumentación pendiente a cargo del propietario; las demás puertas se ejecutan por Codex. Sin despliegue ni cambios a main/Five.

## Reglas y arquitectura

BL-162: Chofer autenticado de la ejecución histórica registra una vez el cobro de un pedido entregado. Efectivo/transferencia/crédito, recibido, cambio explícito, saldo pendiente y nota. Servidor valida precisión monetaria, moneda real, fuente lista/vigente y token del detalle visto. Crédito nunca representa dinero recibido; transferencia es declaración, no confirmación bancaria. Recibo inmutable con cantidades, precios, incidencias, actor, fecha, comando y hash. Repetir el mismo comando devuelve el recibo; otro comando no duplica el cobro.

BL-163: Chofer consulta ejecuciones propias e historial aunque termine o se archive la ruta. Tarjeta de inicio y detalle pedido/incidencias; liquidar pedido o los cobros pendientes de toda ruta terminada. Solicitud pendiente reserva cobros; rechazarlos libera la reserva sin borrar historia. Ruta completa requiere cobros de todos los pedidos entregados; reprogramados no generan cobro. Lo aceptado se excluye automáticamente de nuevas solicitudes. Importe físico = efectivo neto cobrado menos aceptado; transferencias/créditos separados por moneda.

BL-164: Liquidador activo ve rutas finalizadas agrupadas por chofer/ejecución, solicitudes y detalle, con filtros por fechas. Aceptar exige confirmación del monto exacto leído y versión de solicitud. Aceptar/rechazar son decisiones terminales e idempotentes, con actor/fecha/nota; concurrencia no produce doble recepción. Cancelar el modal no envía acción.

BL-165: Rol immutable al crear cuenta: routes o settlement. Cuentas existentes routes. Administrador operativo puede crear/desactivar cuentas de ambos roles con formularios separados; sólo settlement accede a liquidación. Restricción central en principal() (routes por defecto), validadores de dominio y eventos. Login/home/logout admiten ambos. Navegación deshabilitada para módulos ajenos y entrada inicial de liquidador directa a liquidación. No escalamiento de rol ni acceso por módulos incrustados, fotos o endpoints operativos.

BL-166: Métricas por moneda y fechas: cobrado, solicitado pendiente y aceptado, separando efectivo/transferencia/crédito/saldo/reposición diferida. El panel permite elegir fecha de ruta o fecha de recepción. Recepción incluye únicamente aceptaciones cuyo decided_at corresponde al intervalo local configurado, aunque la ruta sea anterior. Ningún total mezcla monedas ni llama recepción a una solicitud pendiente.

BL-167: Fuente o incidencia modificada después del cobro conserva original y diferencia visible. No modifica cuánto se cobró ni cuánto debe entregar el chofer. El recibo mantiene evidencia histórica aun si una incidencia se oculta o la ruta se archiva. No se habilita un cobro futuro ficticio de reposiciones ni escritura de pagos a Odoo.

BL-168: Recuperación durable: comandos móviles cifrados conservan ID/payload antes de enviar; reintento tras reinicio devuelve el hecho registrado. Lecturas autorizadas tras reconexión; cambios se notifican sin exponer contenido entre cuentas. Ausencia de fuente/pago no se rellena con ceros ni pagos supuestos.

## Contratos nuevos previstos

- Migración36: cobros `route_order_payments`, detalle histórico y recibos financieros. FK a execution/order, no al plan mutable; inmutabilidad SQL y restricciones monetarias.
- Migración37: `route_users.role` y acceso explícito.
- Migración38: solicitudes `route_settlement_requests`, ítems y reservas `route_settlement_claims`; decisiones inmutables. Reserva única de cada payment_id; importes leídos del cobro, nunca del cliente.
- GET /api/mobile/finance?page: rutas propias y resumen, páginas de 50; GET /api/mobile/finance/[executionId]: detalle propio. POST /api/mobile/finance/[executionId]/payments y /requests: comandos idempotentes. Lectura histórica independiente de asignación actual.
- GET /api/settlements?from&to&page&dateBasis=route|receipt y detalle /[executionId], POST /requests/[requestId]: sólo settlement. /api/users crea role explícito y GET devuelve rol. Ambas superficies tienen /[executionId]/evidence con autorización de ejecución/incidencia/foto.
- Android mantiene los flujos operativos; después de entregar abre registro de cobro, recuperable desde la nueva tarjeta. Captura confirma importes del servidor y no mezcla versiones. Modal de recepción muestra efectivo, transferencias y crédito antes de aceptar.

## Matriz y validación

Cada caso comprueba actor, datos, efecto y recuperación indicados en las reglas anteriores con PG/HTTP reales; escenarios de dominio monetario son entradas deterministas, sin API simulada.

| ID | Evento y resultado obligatorio | Evidencia prevista |
|---|---|---|
| CF01 | Efectivo completo, parcial y cero por devolución; saldo exacto | Unidad/PG/Android |
| CF02 | Exceso recibido requiere cambio; crédito cero; transferencia separada | Unidad/PG |
| CF03 | Fuente pendiente/error/vieja o token cambiado rechaza sin escribir | PG/HTTP |
| CF04 | Doble tap, payload cambiado, caída de respuesta/reinicio | PG concurrente/HTTP/outbox |
| CF05 | Otro chofer/dispositivo revocado no lee ni escribe; histórico propio sí | PG/HTTP |
| CF06 | Cambio de Odoo/incidencia conserva pago y evidencia visible | PG |
| CF07 | Existentes routes; liquidadores no entran a ninguna API operativa | PG/HTTP/seguridad |
| CF08 | Formularios separados, login directo, navegación apagada, desactivación | HTTP/UI |
| CF09 | Liquidar pedido, luego ruta: no repetir aceptado ni pendiente | PG concurrente |
| CF10 | Aceptar/rechazar simultáneo, versión vieja, replay tras desconexión | PG/HTTP |
| CF11 | Ruta completa exige finalización y cobros de entregados; reprogramados excluidos | PG |
| CF12 | Rechazo libera reserva, nueva solicitud conserva historial | PG/HTTP |
| CF13 | Fechas, archivo, monedas y métricas cobrado/pendiente/aceptado | Unidad/PG/HTTP |
| CF14 | Migraciones repetidas, datos anteriores y restricciones SQL | PG |
| CF15 | UI pedido/incidencias y fotos autorizadas, lectura sin mutaciones | HTTP/Android |
| CF16 | Flujo integrado app→cobro→solicitud→panel→recepción→historial | E2E/Android; físico propietario |

## Orden y auditoría

Codex conserva arquitectura, dinero, autorización y concurrencia; no delega estos elementos. Bloque3 dominio/BD/cobro y Android, bloque4 cuentas/acceso, bloque5 solicitudes/panel/app, bloque6 puertas y regresión. Bloqueo consistente: autenticación → exclusión de comando → ejecución → pedido/solicitud → fuente; sin RPC externo dentro de transacción. Uso de bloqueos: https://www.postgresql.org/docs/17/explicit-locking.html. Guías Next instaladas para Route Handlers y composición cliente/servidor. GREEN LIGHT para implementación; INTEGRITY TOTAL con BL157..161; MATCH PERFECT con tareas CF en PROGRESS. No certifica pruebas aún no ejecutadas.
