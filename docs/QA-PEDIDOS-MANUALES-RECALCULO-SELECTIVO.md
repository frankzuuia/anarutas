# QA — folios manuales y recálculo selectivo

Fecha: 23/09/2026. Rama `develop`. Alcance local; este bloque no implica despliegue ni pruebas con las credenciales reales de Google/Odoo.

## Procedimiento reproducible

Desde la raíz de `ana-rutas`:

1. `npm run typecheck`
2. `npm run lint`
3. `npm run build`
4. `npm run test:coverage`
5. `npx stryker run stryker.routing-operations.config.mjs --mutate src/core/route-fingerprint.ts`
6. `npx playwright test tests/e2e/panel.spec.ts`
7. `git diff --check`

Las pruebas de PostgreSQL levantan una instancia aislada y usan dobles HTTP sólo para Google/Odoo; no escriben en ningún Odoo ni panel desplegado. Los escenarios de negocio están en `tests/acceptance-manual-route-recalculation.feature`.

## Resultado local observado

| Puerta | Resultado |
| --- | --- |
| TypeScript, ESLint, build Next.js | Verdes; el build incluye `/api/plans/[id]/recalculation/manual`. |
| Vitest + PostgreSQL aislado | 43 archivos, 481 pruebas pasadas. |
| Cobertura V8 | 95.49% líneas, 94.14% sentencias, 87.94% ramas, 97.62% funciones. `orders.ts` 98.22% y `route-recalculation.ts` 95.41% de líneas. |
| Mutación de huella vial | 30 mutantes eliminados de 30; 100%, sin supervivientes. |
| Playwright de panel | 1 flujo completo pasado; incluye contrato de folios manuales y denegación de lectura del nuevo endpoint sin sesión. Una ejecución paralela con cobertura fue inestable en un elemento ajeno al cambio; la repetición aislada pasó. |
| Diff | `git diff --check` sin errores. No se añadió ninguna credencial ni cambio en `main`. |

## Criterios de aceptación y evidencia

| Puerta | Criterio |
| --- | --- |
| Importación | Folios exactos y camionetas seleccionadas se confirman sin consulta por fecha, en una transacción y sin duplicar pedidos al reintentar. |
| Secuencia | La medición manual conserva los IDs, el orden y las coordenadas del tablero. `Armar ruta` permanece como operación de optimización separada. |
| Aislamiento de costo | Un cambio en una camioneta invalida sólo su huella; mover un pedido entre dos invalida sólo esas dos. La tercera reutiliza su JSON vial. |
| Consolidación | Arrastres consecutivos esperan una ventana configurable (`RUTAS_RECALC_QUIET_SECONDS`, ocho segundos por defecto). Confirmar publicación permite procesar la versión actual de inmediato. |
| Publicación | Un cálculo fallido, incompleto u obsoleto no publica. Un reintento usa el recorrido vigente y no duplica una publicación. |
| Seguridad | Endpoints requieren sesión; escritura usa validación de origen, versión y flota. El import conserva la vinculación a la fuente Odoo y Odoo sigue en sólo lectura. |
| UI | `Cargar pedidos` usa logo oficial Odoo y violeta tenue; `Armar ruta` queda junto a `Publicar rutas`, con dimensiones compactas. |

## Métricas y límites

- Cobertura objetivo por riesgo: al menos 90% de líneas global y validación explícita de importación, huellas, worker y publicación. No se usa el promedio global para excusar un flujo crítico sin prueba.
- Mutación objetivo en la huella selectiva: 100% de mutantes detectados. El reporte se genera en `reports/mutation/routing-operations.json`.
- Latencia local: las pruebas miden duración de suite; no constituye p95 del servicio. El proceso de publicación espera como máximo 270 segundos en la UI y devuelve un reintento seguro si continúa el worker.
- Solicitudes Google por edición: cero en arrastres antes del primer recorrido; al publicar se calculan sólo las camionetas sin huella vigente. Después de una edición, se recalculan las camionetas con cambio vial. Dentro de una camioneta afectada pueden medirse varios tramos porque los tiempos posteriores dependen de los anteriores; no se afirma una sola llamada por parada.
- Defectos admitidos para este bloque: cero regresiones reproducibles en pruebas locales. La medición real de tasa de errores, p95, facturación y GPS requiere el entorno desplegado.

## QA manual pendiente tras despliegue de develop

Con un plan de pruebas nuevo: seleccionar una camioneta, cargar sólo folios manuales sin tocar `Consultar pedidos`, acomodar cinco paradas y confirmar la publicación. Comprobar en el mapa y la APK la secuencia exacta. Mover 2→3 y luego pasar una parada entre camionetas; verificar que sólo las camionetas afectadas cambien de recorrido y que la auditoría `plan.recalculated` registre `recalculatedVehicleIds`/`reusedVehicleIds`. Medir en la consola de Google las solicitudes reales del lote. Probar fallo de red, reintento y concurrencia entre dos administradores. No ejecutar esta prueba contra producción sin aprobación aparte.
