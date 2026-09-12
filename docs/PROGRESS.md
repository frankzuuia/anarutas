# Progreso — bloque 1

## Corrección de agrupación por cliente — BLOQUE-RUTEO-POR-CLIENTE.md

- [x] RC-T01 (BL-048/RC01..03,06): regresión reproducida, agrupación por partner de entrega y validación indivisible/consecutiva.
- [x] RC-T02 (BL-049..050/RC04,05,07): grupos opacos en snapshot/tools, flota por grupos y retorno de propuesta inválida a la IA.
- [x] RC-T03 (BL-050/RC08..10): validación transaccional, regresión, PostgreSQL real, Gherkin, cobertura/mutación, 2 E2E de regresión y E2E adicional con los 8 pedidos reales/OpenAI/Google, todos verdes. Agrupación y frontera de persistencia: mutación 100%. Evidencia en QA-RUTEO-POR-CLIENTE.md. Commit/push a develop autorizados por el usuario el 12 septiembre; deploy manual a cargo del usuario.

## Selección Odoo autorizada — BLOQUE-SELECCION-ODOO.md

- [x] SC-T01: autopsia/línea base y muestra live 19.4 done/assigned; contrato 17 por capacidades (C01,C15).
- [x] SC-T02: contratos/validadores y migración v9, backfill, expiración y restricciones (BL-041..046/C11,C12,C17).
- [x] SC-T03: lector por estado, fecha, cantidades, techo y relectura (BL-042,044/C01,C07,C08,C10,C15,C18). La paginación queda cubierta estructuralmente; volumen live >50 pendiente antes de promoción.
- [x] SC-T04: preview/API y confirmación atómica, recibo y reintento (BL-041,043..046/C01..14).
- [x] SC-T05: modal, selección global/indeterminado y estados del tablero; consumidores downstream sin cambios (BL-043,047/C02..04,C09,C10,C14,C16).
- [x] SC-T06: regresiones downstream/manual conservando íntegramente pesos, prioridad, horarios y ruteo existentes (BL-046..047/C08,C14,C16,C19).
- [x] SC-T07: Gherkin, unitarias, integración, E2E live 19.4, cobertura, mutación, seguridad y evidencia (C01..19). Ver QA-SELECCION-PEDIDOS-ODOO.md; preflight live 17 y volumen >50 pendientes antes de promoción.

## Bloque 5C — control de consumo oficial de Google

Especificación: `BLOQUE-5C-CONSUMO-GOOGLE.md`. Sólo sección lateral; sin tarjeta ni
consultas de consumo en el mapa. Google Billing/BigQuery es la autoridad y PostgreSQL
únicamente cachea resultados sustituibles.

- [x] G-T01 (BL-037..039 / G01-09): configuración FinOps separada, OAuth, descubrimiento seguro de exports y cliente BigQuery acotado.
- [x] G-T02 (BL-037..038 / G03, G05, G07-08): query parametrizado, parser estricto, agregado por SKU/ciclo y escalones derivados de Pricing export.
- [x] G-T03 (BL-038..039 / G04-06, G09): migración v8, cache idempotente, lease, backoff, sincronización periódica/manual y auditoría sanitaria.
- [x] G-T04 (BL-039..040 / G01-02, G06, G09): API autenticada GET/POST, privacidad, frescura y estados configurado/desactualizado/error.
- [x] G-T05 (BL-040 / G01, G06-10): navegación y pantalla responsive con costo, créditos, historial y medidores independientes; mapa intacto.
- [x] G-T06 (todas / G01-10): 293 pruebas, PostgreSQL real, Gherkin, E2E, seguridad, 90.40% statements, 93.80% mutación, lint, typecheck y build verdes. Evidencia en `QA-BLOQUE-5C-CONSUMO-GOOGLE.md`.
- [ ] G-T07: configurar Standard + Pricing export e IAM en develop; smoke oficial y evidencia antes de promoción.

## Bloque 5B — recálculo automático y OpenAI

Especificación: BLOQUE-5B-RECALCULO-IA.md. Reglas confirmadas por el usuario: OpenAI,
hora de salida configurable por administrador y Alta→Media→Por horario obligatorio.

- [x] R-T01 (BL-032 / R01-03): hora de salida por plan, migración aditiva, API versionada y formulario 24 h.
- [x] R-T02 (BL-033 / R04-07, R09): recálculo durable después de ediciones, invalidación de puntos y compare-and-swap.
- [x] R-T03 (BL-034 / R04-08): recorrido manual conservado, ETA/conflictos y métricas por camioneta.
- [x] R-T04 (BL-035 / R10-13): planificador OpenAI con tools nativas, recuperación y credenciales runtime.
- [x] R-T05 (BL-036 / R14): evaluación de alternativas por espera, tiempo, distancia y paradas con prioridad obligatoria.
- [x] R-T06 (R01-14): puertas locales, PostgreSQL real, contratos de proveedores, E2E, cobertura y mutación verdes. Evidencia en `QA-BLOQUE-5B-RECALCULO-IA.md`; el smoke facturable OpenAI/Google posterior al despliegue permanece explícitamente pendiente.
- [x] R-T07: regresión ROUTING_RESPONSE_INVALID por listas ProtoJSON omitidas en camionetas vacías; normalización, diagnóstico por campo y continuidad del flujo OpenAI. 242 pruebas, 486 mutantes detectados, build/E2E verdes. Evidencia en `QA-FIX-GOOGLE-PROTOJSON.md`.

## Bloque 5 autorizado — optimización vial Google

- [x] O-T01 (BL-026 / S32-33): migración v6 y configuración versionada del punto de salida, con sugerencia runtime y confirmación visual.
- [x] O-T02 (BL-027-028 / S34-35): configuración privada Google, OAuth, constructor de modelo sin peso y parser estricto de Route Optimization.
- [x] O-T03 (BL-029 / S34, S36-37): llamada externa fuera de transacción y aplicación atómica/versionada con métricas, omisiones y auditoría.
- [x] O-T04 (BL-030 / S38-39): UI Armar ruta, salida editable, polilíneas/ETA/km y estado obsoleto tras cambios manuales.
- [x] O-T05 (BL-030): conservar route tokens privados por transición para la futura APK Android; no exponerlos al tablero web.
- [x] O-T06: referencias, errores sanitarios, métricas operativas y documentación de QA/reversión.
- [x] O-T07: unidades, PostgreSQL real, contrato Google, E2E, Gherkin, cobertura, mutación, lint, typecheck y build verdes. Evidencia local en `QA-BLOQUE-5-OPTIMIZACION.md`; smoke facturable posterior al deploy permanece explícitamente pendiente.
- [x] O-T08 (BL-031 / S40): bloquear coincidencias parciales o aproximadas del origen, mostrar el resultado normalizado y exigir domicilio completo; regresión, cobertura, mutación, build y E2E verdes. Evidencia en `QA-BLOQUE-5-OPTIMIZACION.md`.

## Bloque 4 autorizado — clientes, horarios y puntos

- [x] C-T01 (BL-018..019): migración v5, identidad Odoo estable, jerarquía y sincronización paginada compatible por capacidades.
- [x] C-T02 (BL-019..022): búsqueda normalizada, edición versionada, horario de 24 horas, prioridad, ubicación confirmable y archivo/restauración.
- [x] C-T03 (BL-023): resolución única de preferencias en planificador/mapa y exportaciones XLSX de clientes y plan.
- [x] C-T04 (BL-018..024): API y UI compacta completa con estados accesibles, recuperación y auditoría.
- [x] C-T05: puertas locales unitarias, PostgreSQL, contrato, E2E, Gherkin, cobertura, mutación, seguridad, rendimiento, build y evidencia en `QA-BLOQUE-4-CLIENTES.md`. Smoke real Maps/Odoo 17 y 19.4, y aplicación del directorio Excel permanecen condicionados a configuración y preflight explícito.
- [x] C-T06 (BL-025 / S30): editor ocultable con descarte confirmado, directorio a ancho completo, reapertura por selección, ausencia verificable de Importar Excel y controles destructivos compactos/táctiles.
- [x] C-T07 (BL-023 / S31): distintivos de prioridad consistentes en planificador y directorio; Alta amarilla, Media azul y Por horario neutra, con texto y validación E2E de estilos calculados.

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

## Bloque 3D autorizado — independencia, reutilización y borrado de plan

- [x] T18 (BL013, BL015 / S27): retirar «Guardar camionetas», separar estados y garantizar que la carga por fecha sea la única que guarde selección, mientras la manual sólo consulte folios.
- [x] T19 (BL012-013 / S28): migración v4 e idempotencia por plan; permitir el mismo pedido en múltiples planes y eliminar el concepto operativo «en otro plan».
- [x] T20 (BL017 / S29): DELETE versionado y auditado del plan, confirmación accesible y actualización coherente del selector.
- [x] T21 (BL012-017 / S27-29): regresión unitaria, PostgreSQL, contrato API, E2E, Gherkin, cobertura, mutación, seguridad, build y evidencia QA en `QA-BLOQUE-3D-PLANES.md`.

## Ajuste de interfaz solicitado: nombre del borrador

- [x] T13 (BL003, BL006 / S23): bote rojo por carril con modal de confirmación; DELETE transaccional retira sólo la camioneta del borrador y regresa sus pedidos a Sin asignar, conservando datos, orden, flota y Odoo; versión, auditoría, concurrencia, foco y E2E.

- [x] T12 (BL003, BL006 / S22): botón Añadir camioneta en el planificador; operación POST aditiva y atómica, sin retirar carriles ni reasignar pedidos, con disponibilidad, chofer activo, versión, auditoría, vacío accesible y pruebas de concurrencia/E2E.

- [x] T09 (BL006 / S19): densidad compacta del panel y tarjetas con divulgación progresiva; mínimo seis pedidos cerrados visibles a 768 px, detalles y controles bajo demanda, responsive y QA visual. Evidencia en QA-PANEL-COMPACTO.md y BLOQUE-3B-PLANIFICADOR.md.

- [x] T08 (BL004, BL006 / S18): título guardado con «Cambiar nombre», editor bajo demanda, cancelar sin escritura, conservar contrato PATCH; unidades, E2E real, QA visual y regresiones. Evidencia en QA-NOMBRE-BORRADOR.md. No cambia el alcance pendiente del bloque 1.

## Ajuste de interfaz solicitado: conexión Odoo interna

- [x] T11 (BL005, BL006 / S21): retirar del panel la pestaña, diagnóstico y explicación de entornos; conservar conector, configuración runtime, API interna, pruebas de sólo lectura y auditoría histórica. Sin cambios en Odoo, credenciales, V3, ventas o precios. Evidencia en `QA-CONEXION-ODOO-INTERNA.md`.
