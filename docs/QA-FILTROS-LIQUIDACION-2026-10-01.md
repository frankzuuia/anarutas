# QA BL-188 — filtro por chofer y controles compactos

Solicitud y plan confirmados el 2026-10-01. Alcance de producción: cuatro archivos
(`dashboard`, `settlement-panel`, CSS y lectura mínima en `finance-read`). Sin
cambios a comandos financieros, SQL de filas/totales, roles, tickets, cierre,
migraciones, Android, dependencias ni servicios de Five. No requiere nueva APK.

## Resultado y evidencia

| Puerta                  | Resultado reproducido                                                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline                | 6/6 `settlements-integration` antes del cambio                                                                                                                                                                          |
| Nuevos contratos        | 4/4 PG real: dos choferes cobrados, totales por estado, roster mínimo/inactivo, UUID/permisos/revocación, consultas concurrentes sin escrituras                                                                         |
| Regresión afectada      | 88/88 unitarias/contratos/integración financieras, 0 fallos, sin omisiones; 123.73s sumando suites                                                                                                                      |
| Cobertura V8 financiera | Líneas 340/341 (99.70%), sentencias 360/362 (99.44%), funciones 104/104, ramas 320/325 (98.46%)                                                                                                                         |
| Lectura afectada        | `finance-read.ts`: 100% líneas/sentencias/funciones, 33/35 ramas (94.28%); todas las líneas nuevas ejecutadas. Roster agrega cero decisiones de negocio                                                                 |
| Mutation PG             | 5/5 detectados: omitir filtro, ocultar inactivos, exponer campos privados, omitir roster y quitar autorización. Baseline 4/4 en copia aislada; rechazo por aserciones, no por fallo de infraestructura                  |
| E2E real                | 2/2 Chrome, Next production y PG aislado, 49.66s; variantes bodega requerida y modo de prueba. 0 fallos, omisiones o flaky                                                                                              |
| UI                      | Fechas 160px, Chofer 220px a 1280px; una fila, 44px mínimo de controles. 390px sin desborde. Menú Auditoría → Liquidación → Control de consumo                                                                          |
| Consistencia            | Bloqueo PG real retrasa lecturas: filtro nuevo gana al anterior; reelección del mismo valor no vacía pantalla. Volver conserva filtro; alta por SSE conserva alcance; cambiar fechas cierra detalle y vuelve a página 1 |
| Regresión de negocio    | Liquidación individual/completa, rechazo/cancelación, recepción, ticket, cierre único, idempotencia y aislamiento repiten los recorridos reales existentes. API por fecha de recepción permanece compatible             |
| Seguridad               | UUID validado/parametrizado, permisos conservados, cuenta revocada rechazada; roster sólo `id/name/active`. Audit de dependencias productivas: 0 vulnerabilidades; sin paquetes/secretos nuevos                         |
| Estática                | Typecheck y build verdes. Lint de archivos tocados: 0 errores/advertencias. Lint global: 0 errores y advertencia anterior ajena a este bloque en `stryker.product-amendments.config.mjs`                                |

No se persigue un promedio para sustituir escenarios: FL01..07 verificados en
tests y `acceptance-settlement-filters.feature`. Presentación/estado React se
validan en navegador real, sin atribuirles cobertura de instrumentación V8 del
servidor. La suite global ajena a este alcance no se volvió a ejecutar.

Complejidad medida por regla ESLint: `listSettlements` 5→5 y callback SQL 4→4;
refresh 5→6 por el parámetro opcional; reset de filtro 1. `SettlementPanel`
43→41 contando JSX; `decide` 4→4. Sin refactor monetario adicional.

33 muestras de Server-Timing del último E2E: p95 53.9ms, máximo 79.8ms. Incluye
lecturas bajo contención intencional; entorno local, no prueba de carga ni SLO
productivo nuevo. Defectos abiertos del bloque: 0. Se corrigieron durante QA una
inferencia de tipos en los datos de prueba y el selector del test (usar rol
combobox; el texto de label incluía sus opciones). La ejecución final es verde.

Evidencia local: `.local/qa-settlement-filters-{financial,e2e,coverage-summary,
complexity,audit}.json`, logs de typecheck/lint/build, `reports/mutation/
settlement-filter.json`, `coverage/settlements/coverage-final.json` y capturas
`.local/qa-settlements/filters-{desktop,mobile}-{true,false}.png`. Artefactos
generados ignorados por Git; esta ficha y los tests permiten reproducirlos.

## Procedimiento PowerShell reproducible

Ejecutar desde la raíz de Ana Rutas con Node24 y dependencias instaladas:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
node node_modules/vitest/vitest.mjs run --config vitest.settlements.config.ts --coverage
node scripts/verify-settlement-filter-mutations.mjs
$env:PLAYWRIGHT_JSON_OUTPUT_FILE = '.local/qa-settlement-filters-e2e.json'
npm.cmd exec -- playwright test tests/e2e/settlements.spec.ts --reporter=line,json
npm.cmd audit --omit=dev
git -c core.autocrlf=false diff --check
```

PG real temporal, imágenes reales y comandos firmados/versionados. Observaciones
financieras unitarias persistidas usan los fixtures de dominio existentes; no
se simulan HTTP/Odoo/Google ni se certifica una integración externa sin ejecutarla.
No se necesita llamar proveedores externos para este cambio de lectura/presentación.

QA manual opcional: entrar como liquidador, variar fechas/Chofer/Todos, abrir y
volver de ruta, verificar cada estado de importe; registrar otro chofer desde
cuenta operativa y observar la nueva opción. No cambiar solicitudes para probar
un filtro: es una consulta. Revisar el menú y ancho en móvil/desktop.

Entrega a develop conforme a autorización permanente; despliegue manual del
propietario. Sin acciones sobre main ni despliegue automático.
