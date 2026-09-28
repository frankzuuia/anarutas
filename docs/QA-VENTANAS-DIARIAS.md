# QA — Ventanas diarias de clientes (BL-142)

Estado: trabajo local en `develop`, sin commit, push ni despliegue. La migración
v26 se ejecuta automáticamente al iniciar sobre una instalación existente o
nueva; no escribe en Odoo. Los antiguos días se preservan sólo en
`route_customer_windows_legacy` para auditoría. La migración une intervalos
repetidos, contiguos y traslapados por cliente para no reducir disponibilidad.

## Puertas y evidencia

| Puerta | Comando/evidencia | Estado |
| --- | --- | --- |
| Contrato, PostgreSQL y consumidores | `npx vitest run tests/customer-windows-daily.test.ts tests/customers-validation.test.ts tests/customers.test.ts tests/excel.test.ts tests/routing.test.ts tests/orders.test.ts tests/recalculation.test.ts` | 32/32 finales, incluido domingo, contigüidad y esquema previo incoherente |
| Tipos | `npm run typecheck` | Verde |
| Lint | `npm run lint` | Verde |
| Build | `npm run build` | Verde |
| E2E | `npx playwright test tests/e2e/panel.spec.ts` | 1/1; guardado, ausencia de días, 375/768/1024/1440 px y seguridad |
| Suite completa | `npm test` | Repetición final verde: 60/60 archivos, 625/625 pruebas, 1 omitida |
| Cobertura | `npm run test:coverage`; cobertura dirigida final con los siete archivos de la primera fila y `--coverage.include=src/core/customer-windows-daily-schema.ts --coverage.include=src/core/customers-validation.ts --coverage.reportsDirectory=coverage/customer-windows-daily` | Global anterior al guardarraíl de migración: 95.72% líneas, 89.59% ramas, 96.83% funciones, 94.37% sentencias; dirigida final: 90.9% líneas, 90.47% ramas, 100% funciones, 91.02% sentencias |
| Mutación | `npm run test:mutation:customers`; `npx stryker run stryker.customer-windows-daily.config.mjs` | 111/111 y 14/14 mutantes detectados, cero supervivientes/no cubiertos |
| Dependencias | `npm audit --audit-level=high` | 0 vulnerabilidades conocidas, incluidas dev |

Las capturas E2E locales están en `reports/screenshots/customers-375.png` y
`reports/screenshots/customers-1440.png`; se revisaron visualmente: la fila
contiene Desde, Hasta y el botón de quitar en una sola línea, sin días ni
desbordamiento horizontal. Son artefactos locales, no datos de producción.

## Criterios y límites

- Objetivo de cobertura: al menos 90% de líneas y ramas en la validación de
  ventanas; migración, consolidación e idempotencia deben estar cubiertas por
  PostgreSQL real. Resultado: `customers-validation.ts` 90% líneas/ramas;
  `customer-windows-daily-schema.ts` 100% líneas/ramas/funciones/sentencias.
  El promedio global no sustituye esos casos críticos. Reporte detallado:
  `coverage/customer-windows-daily/coverage-summary.json` (artefacto local).
- Mutación: objetivo 100% de mutantes detectados en validación y guardas de
  migración; ninguna supervivencia se acepta sin análisis documentado.
- Defectos: cero fallos de regresión en suite dirigida, suite total y E2E.
  Complejidad ESLint medida: `windows`=5, callback de ventana=5 y
  `migrateCustomerWindowsDaily`=3; no se añadió un segundo calendario ni
  lógica por día en consumidores.
- Latencia/SLO: esta entrega no introduce llamadas externas ni un SLO nuevo.
  El tiempo de arranque/migración productivo debe medirse en una copia de la
  base destino antes de promover; la duración de PostgreSQL embebido no prueba
  un percentil productivo. Errores: vigilar 422 de ventanas inválidas y fallo
  de migración tras el despliegue; no se atribuyen tasas reales sin telemetría.
- Seguridad: API administrativa y control de versión siguen vigentes; se
  rechazan campos `days` de clientes antiguos. Odoo permanece en sólo lectura.
- Reversión: el binario v25 no entiende schema26. Para volver atrás hace falta
  un plan de restauración controlado; no ejecutar un downgrade automático.

Gherkin: `tests/acceptance-customer-windows-daily.feature` (VH01..VH08).
La prueba PG crea una instalación aislada real, recupera una estructura v25,
actualiza dos instancias a la vez, comprueba archivo, intervalos, domingo y
repetición. No se han usado mocks de base de datos ni de APIs.

## Procedimiento de QA reproducible

1. En la raíz, ejecutar los comandos de la tabla y conservar salidas de
   cobertura/mutación y capturas. Confirmar cero fallos y advertencias nuevas.
2. En una copia respaldada de la base de `develop`, inspeccionar el recuento
   de ventanas por cliente, ejecutar la migración automática y comparar la
   unión horaria resultante con los originales archivados. No usar Odoo como
   fuente de sobrescritura de estos horarios.
3. En el panel, abrir clientes con una y varias ventanas, guardar y volver a
   abrir; comprobar sólo Desde/Hasta y la misma disponibilidad en planes de
   distintos días. Exportar XLSX y verificar que no exista columna Días.
4. Antes de producción, repetir el preflight en una copia de la base real,
   medir duración/errores, asegurar respaldo recuperable y obtener autorización
   de promoción. Sin evidencia no se declara listo para `main`.
