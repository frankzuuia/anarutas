# Progreso — bloque 1

## Bloque 3B — planificador compacto, mapa y notas

- Implementados menú plegable, borradores compactos, columnas acotadas y scroll propio.
- Segunda compactación: alta de borrador en modal, barra de trabajo única, avisos
  flotantes y tres pedidos completos visibles a 768 px de alto.
- Tarjetas adaptables más densas, sin truncar datos y conservando 44 px en táctil.
- Modal Google preparado; integración live pendiente de configuración del propietario.
- Notas Studio por contrato QR verificado mediante lectura; sin cambios en Five.
- Evidencia y límites en BLOQUE-3B-PLANIFICADOR.md.

## Bloque 3A autorizado — BLOQUE-3-PEDIDOS.md

- [x] O-T01: esquema v3, identidad/envíos/flota por día e integridad concurrente.
- [x] O-T02: lectura real Odoo, contratos de esquema, idioma y fechas locales.
- [x] O-T03: API, modal de carga y tablero persistente con asignación.
- [x] O-T04: QA real, Gherkin, regresión, cobertura y mutación crítica.
- [x] O-T05: evidencia en QA-BLOQUE-3A-PEDIDOS.md; sin promoción implícita.

## Bloque 2A autorizado — BLOQUE-2-FLOTA.md

- [x] F-T01 (F01): migración aditiva e integridad de datos anteriores.
- [x] F-T02 (F02..06): dominio/API de unidades, choferes y asignación; versiones, idempotencia y auditoría.
- [x] F-T03 (F07..08): documentos raster privados, límites y permisos.
- [x] F-T04 (F09..10): interfaz compacta y conexión de navegación/planificador.
- [x] F-T05 (F01..10): QA real, cobertura/mutación/regresión, migración local preservando datos; sin commit/push. Evidencia en `QA-BLOQUE-2A-FLOTA.md`.
- [x] F-T06 (F09): control accesible de disponibilidad desde la tarjeta, estado textual permanente y foto privada del chofer asignado con fallback; persistencia y restricciones verificadas por E2E. Evidencia en `QA-BLOQUE-2A-FLOTA.md`.

- [ ] T01 (BL001/S01-03,15): configuración portable, DB propia, migraciones con ownership.
- [ ] T02 (BL002-003/S04-10,17): contraseñas, sesiones, bootstrap, gestión de cuentas y seguridad HTTP.
- [ ] T03 (BL004/S11-12): borradores persistentes, idempotencia, versión y auditoría.
- [ ] T04 (BL005/S13-15): diagnóstico Odoo sólo lectura y company scope.
- [ ] T05 (BL006/S16): interfaz real de acceso/planificación/cuentas/auditoría, estados vacíos honestos; conector Odoo sin pantalla administrativa.
- [ ] T06 (todas): pruebas unitarias, Gherkin, integración PostgreSQL, E2E, cobertura/mutación, build y auditoría dependencias.
- [ ] T07 (BL001): Docker/operación portable, procedimiento backup y promoción sólo autorizada.

No se incluyen cambios a repositorio five, sus entornos, vendedores, precios o V3.

- [x] T10 (BL002 / S20): mínimo 6 caracteres sincronizado en servidor, formularios y mensajes; mantener altas por administradores, comprobar límites, API, login, cobertura y mutación. No cambiar cuentas existentes. Evidencia en QA-CONTRASENA.md.

## Ajuste de interfaz solicitado: fecha de validación

- [x] T14 (BL011, BL006 / S24): carga Odoo con una sola Fecha de validación de pedidos, editable e inicializada con el día civil actual de la zona horaria; el cliente conserva el contrato enviando el mismo día como inicio/fin y el servidor mantiene límites y protección del plan.

## Bloque 3C autorizado — carga manual y retiro recuperable

- [x] T15 (BL015 / S25): carga manual atómica de hasta 50 folios `S` exactos fuera de fecha, reutilizando el adaptador Odoo sólo lectura y compatible por capacidades.
- [x] T16 (BL016 / S26): bote por pedido, confirmación accesible y DELETE transaccional versionado; una recarga Odoo puede recuperar el pedido.
- [ ] T17 (BL015-016 / S25-26): unidades, PostgreSQL real, contrato estático Odoo, E2E, Gherkin, cobertura, mutación y seguridad verdes; falta smoke read-only de la ruta manual contra develop 19.4 y preflight de producción 17. Evidencia local en `QA-BLOQUE-3C-PEDIDOS-MANUALES.md`.

## Ajuste de interfaz solicitado: nombre del borrador

- [x] T13 (BL003, BL006 / S23): bote rojo por carril con modal de confirmación; DELETE transaccional retira sólo la camioneta del borrador y regresa sus pedidos a Sin asignar, conservando datos, orden, flota y Odoo; versión, auditoría, concurrencia, foco y E2E.

- [x] T12 (BL003, BL006 / S22): botón Añadir camioneta en el planificador; operación POST aditiva y atómica, sin retirar carriles ni reasignar pedidos, con disponibilidad, chofer activo, versión, auditoría, vacío accesible y pruebas de concurrencia/E2E.

- [x] T09 (BL006 / S19): densidad compacta del panel y tarjetas con divulgación progresiva; mínimo seis pedidos cerrados visibles a 768 px, detalles y controles bajo demanda, responsive y QA visual. Evidencia en QA-PANEL-COMPACTO.md y BLOQUE-3B-PLANIFICADOR.md.

- [x] T08 (BL004, BL006 / S18): título guardado con «Cambiar nombre», editor bajo demanda, cancelar sin escritura, conservar contrato PATCH; unidades, E2E real, QA visual y regresiones. Evidencia en QA-NOMBRE-BORRADOR.md. No cambia el alcance pendiente del bloque 1.

## Ajuste de interfaz solicitado: conexión Odoo interna

- [x] T11 (BL005, BL006 / S21): retirar del panel la pestaña, diagnóstico y explicación de entornos; conservar conector, configuración runtime, API interna, pruebas de sólo lectura y auditoría histórica. Sin cambios en Odoo, credenciales, V3, ventas o precios. Evidencia en `QA-CONEXION-ODOO-INTERNA.md`.
