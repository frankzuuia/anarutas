# BL-188 — filtros de liquidación, aprobado 2026-10-01

El propietario confirmó: añadir filtro y compactar controles, sin cambiar cómo
se liquida. Incluye mover el acceso debajo de Auditoría y fijar Fecha de ruta en
esta pantalla. No afecta Android ni requiere APK.

## Autopsia y contrato

`SettlementPanel` no envía `driverId`, aunque `listSettlements` ya lo valida y
aplica a filas y métricas con el mismo predicado SQL. La barra hereda
`flex: 1 1 180px`, por eso sus controles llenan todo el ancho.

1. Reubicar el elemento existente del menú; conservar roles y destinos.
2. Barra compacta con Fecha de ruta fija, Desde, Hasta y Chofer. Enviar el UUID
   seleccionado; Todos los choferes omite el UUID. Cambiar filtros limpia detalle
   y página, invalida lecturas anteriores y actualiza automáticamente.
3. El reporte autorizado incorpora solamente `id`, `name`, `active` de los
   choferes registrados. No usar `/api/drivers`, restringido al rol de rutas y
   con datos privados. Incluir inactivos para consultas históricas; no limitar
   opciones por fecha o página. Conservar SSE y recuperación existentes.
4. Verificar permisos, exactitud de totales, filtros sin escrituras, dos choferes,
   ausencia de cobros, alta en vivo y geometría real desktop/móvil.

Se conserva la consulta backend por fecha de recepción para consumidores e
historial existentes; sólo se elimina esa elección en esta UI. No se modifican
comandos de cobro, liquidar, aceptar/rechazar, cierre, bases, tickets, esquema,
orden de pedidos ni tarjetas monetarias. Sin cuentas, IDs o proveedores nuevos.

## Matriz y puertas

| Caso | Resultado                                                                            | Evidencia requerida                  |
| ---- | ------------------------------------------------------------------------------------ | ------------------------------------ |
| FL01 | Todos los choferes y cada UUID filtran filas y totales juntos                        | PG real con dos ejecuciones cobradas |
| FL02 | Registrado sin cobros e inactivo figuran en selector; reporte vacío correcto         | Contrato PG y HTTP/UI                |
| FL03 | Rango, UUID inválido y permisos siguen validados; roster sin datos privados          | PG/HTTP y mutación                   |
| FL04 | Cambio de filtro limpia detalle/página; volver conserva filtro; SSE conserva alcance | E2E Chrome real                      |
| FL05 | Alta de chofer actualiza opciones sin actualización manual                           | E2E SSE real                         |
| FL06 | Campos compactos a 1280px, sin desborde a 390px; menú Audit→Liquidación→Consumo      | DOM/geometría/capturas               |
| FL07 | Liquidar individual/ruta, aceptar/cancelar, ticket y cierre intactos                 | Suite financiera y E2E existentes    |

Unitarias/contratos existentes más regresiones PG nuevas, Gherkin, cobertura
medida, mutantes controlados en copia aislada, lint/typecheck/build y QA
reproducible. Objetivo: todas las líneas nuevas del contrato de lectura y todos
los escenarios FL01..07 verificados; el promedio global no sustituye estos casos.
No mutar reglas monetarias sin cambios: se reejecuta su regresión.

GREEN LIGHT, INTEGRITY TOTAL y MATCH PERFECT con FL-T01..03 de PROGRESS.
Entrega a develop bajo autorización permanente sólo con evidencia verde.
Sin despliegue, cambios a main ni servicios de Five.
