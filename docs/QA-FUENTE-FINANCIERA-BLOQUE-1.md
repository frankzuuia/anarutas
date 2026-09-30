# QA — fuente financiera de liquidación, bloque 1

Fecha: 2026-09-30, America/Mexico_City. Repositorio Ana Rutas, rama `develop`, base `485ab3f2bb95d43fdb3c996a05cabd439e641db2`. Bloque aprobado por el propietario con «dale» y continuaciones posteriores. Revisión final terminada y puertas aplicables aprobadas; no desplegado.

## Resultado y alcance

Importar una entrega registra automáticamente su identidad financiera. El servidor consulta Odoo por origen/picking/orden, conserva importes decimales y revisiones inmutables, y distingue pendiente, conciliado, cancelado y revisión necesaria. No utiliza la fecha del selector para seguir un pedido ya importado. Dos lecturas completas deben coincidir antes de publicar una observación.

La identidad es picking **y orden**: el importador existente agrupa varias ventas dentro de un mismo picking. La conciliación considera todas las líneas de esa venta; no relaciona partidas por nombre, producto repetido o posición. Una venta repartida en varios pickings no adquiere su total completo varias veces. Un caso no demostrable queda sin `shipmentAmounts`.

La migración34 es aditiva. Las revisiones financieras no sobrescriben envíos, publicaciones, visitas, ejecución, incidencias o recibos. El trigger de importación y el backfill cubren altas futuras y pedidos existentes. La lectura de servidor exige administrador activo. Todavía no hay endpoint financiero público ni consumidor Android nuevo.

`ready` significa que la observación de origen concilia; **no autoriza un cobro**. El futuro consumidor debe verificar versión, antigüedad y errores al confirmar dinero. Precios e incidencias móviles, cobros, roles, recepción e historial de liquidaciones siguen en los bloques 2..6.

## Evidencia ejecutada

| Puerta | Resultado | Evidencia local reproducible |
| --- | --- | --- |
| Dominio, contratos, PG y Odoo real | 108/108, 4 archivos; 74.25 s | `.local/financial-live.log` |
| Cobertura dirigida | 99.62% líneas, 99.24% ramas, 100% funciones, 99.34% sentencias | `coverage/financial/coverage-summary.json`, HTML |
| Mutación de políticas/normalización/configuración | 598/606 detectadas, 98.68%; 8 equivalentes revisadas, 0 sin cobertura, 0 timeouts | `reports/mutation/financial.json` y `.html` |
| Mutación de invariantes con PostgreSQL real | Baseline 10/10; 12/12 mutaciones detectadas | `reports/mutation/financial-integration.json` |
| E2E HTTP importación → worker automático → lectura | 1/1, 31.6 s, sobre Next16.3.8 | `.local/financial-e2e-final.log` |
| Regresión HTTP/Interfaz de chofer | 2/2, 1.3 min, sobre Next16.3.8 | `.local/financial-mobile-regression.log` |
| Regresión general | 787 aprobadas,0 fallos,3 omisiones externas;76 archivos,896.09 s | `reports/financial-regression-final.json` |
| Compilación Next16.3.8 | Aprobada | `.local/financial-build-patched.log` |
| Typecheck, lint y bundle de migración | Aprobados; lint0 errores y1 advertencia preexistente | `.local/financial-{typecheck,lint,bundle}-final.log` |
| Dependencias | `npm audit`: 0 vulnerabilidades, producción y desarrollo | `reports/financial-audit.json` |

Los reportes y logs están en directorios locales ignorados por Git. Este documento registra sus resultados; los comandos, escenarios y pruebas se versionan. No se necesitan secretos dentro del repositorio para reproducir las pruebas de dominio y PostgreSQL. `reports/financial-evidence-hashes.json` registra SHA256 de los módulos afectados y reportes; se contrastó que las cinco fuentes dentro del reporte Stryker coinciden con los archivos finales.

Las tres omisiones de la suite general fueron: integración financiera Odoo (ejecutada y aprobada aparte en108/108), miniaturas externas Odoo y FCM real. Estas dos últimas son pruebas preexistentes de servicios no modificados por el bloque; no se declaran aprobadas en esta ejecución ni se elimina su condición de integración optativa. La regresión local de ambos módulos sí pasó. La advertencia de lint preexistente está en `stryker.product-amendments.config.mjs`, exportación anónima;0 advertencias nuevas. No quedan defectos críticos/altos conocidos abiertos en el alcance revisado; eso no certifica los bloques monetarios pendientes.

### Odoo real, exclusivamente lectura

Instalación configurada, versión observada `saas~19.4+e`. Se usaron las credenciales existentes sólo en memoria y en el entorno del proceso de QA; no se guardaron ni imprimieron. Las consultas financieras usan las operaciones cerradas de lectura del conector existente. Las pruebas de exportaciones/AST comprueban que no se añadió un ejecutor RPC público genérico.

| Observación | Resultado persistido |
| --- | --- |
| S00092 / WH/OUT/00095, 11 partidas | `pending_validation`, orden2498.38 MXN; total de entrega nulo |
| S00093 / WH/OUT/00096, 17 partidas | `ready`, orden/entrega3538.00 MXN; ajuste0.01 MXN |
| Segundo sincronizado idéntico | Conserva revisión, sin duplicar historia |
| Conexión PG terminada mientras espera Odoo | Cliente anterior no persiste; bloqueo liberado y siguiente sincronización recuperada |

S00093 reproduce la diferencia original: suma redondeada de partidas3537.99 frente a total3538.00; cantidad×precio sin redondear suma3537.9966. Se conserva la diferencia explícita y se demuestra su procedencia, sin tolerancia monetaria genérica.

La ejecución final midió3054 ms para sincronizar dos identidades. Es una muestra de QA, no un p95 ni un SLO de producción. El E2E importa por HTTP real, verifica401 sin sesión,403 con origen ajeno, repetición idempotente y nuevas identidades de partidas; después espera al worker iniciado por `instrumentation`, sin llamar manualmente al sincronizador. Comprueba que los snapshots operativos permanecen iguales.

### PostgreSQL y recuperación

Las pruebas arrancan PostgreSQL17 temporal real; nunca usan mocks de SQL, Odoo, red ni autenticación. Los datos deterministas de `tests/helpers/financial.ts` son entradas de pruebas de dominio, claramente separados de la evidencia del proveedor real.

Se verificaron upgrade33→34 y repetición, backfill, identidad duplicada entre planes, rechazo de partner cambiado, actualización/deleción de historia bloqueadas por trigger, revisión idéntica, rollback, concurrencia de escritores y bloqueo entre sesiones. La pérdida real de conexión se provoca únicamente contra la base temporal mediante `pg_terminate_backend`; no se interviene PostgreSQL remoto.

Una conexión de red realmente rechazada conserva la revisión previa y registra recuperación. El contrato de429/Retry-After se comprueba con entradas unitarias y persistencia PG; no se fabricó un proveedor HTTP ni se forzó un rate limit remoto para declarar una integración. En la inspección inicial sí se observó429 real. El sincronizador conserva el enfriamiento global entre procesos y respeta Retry-After incluso cuando supera el máximo normal de backoff.

La revisión de la cola detectó riesgo de bloqueo por un registro defectuoso: reiniciar el contador global tras otro éxito podía volver a mezclarlo con registros sanos. La selección ahora reintenta aisladamente objetivos con fallos, incluso después de un éxito ajeno. Un ensayo PG de secuencia completa y dos mutaciones específicas protegen esta recuperación.

## Trazabilidad de aceptación

Escenarios legibles en `tests/acceptance-financial-source.feature`. Son la especificación Gherkin; se validan mediante las pruebas Vitest/Playwright de esta tabla, sin afirmar que exista un runner Cucumber.

| Escenarios | Pruebas / alcance de la evidencia |
| --- | --- |
| LQ01,03,04 — importar pendiente/done, seguir por ID | `financial-odoo-live`, `financial-store`, E2E financiero: Odoo/PG/HTTP reales |
| LQ02 — transición pendiente→validado | Revisión temporal y cambio de día en `financial-store`; estados reales observados por separado. No se provocó la transición remota |
| LQ05 — orden visual/productos repetidos | `financial-policy`, `odoo-financial-contract`: IDs, orden canónico y correspondencia completa |
| LQ06 — parcial/backorder/movimientos | `financial-policy`: rechazos y agregación; sin muestra externa parcial creada |
| LQ07 — unidad, moneda, impuesto, descuento | `financial-policy`, `odoo-financial-contract`: precisión, reconciliación y rechazo explícito; no certifica casos fiscales externos no observados |
| LQ08 — redondeo | Regresión exacta y muestra real S00093; diferencias arbitrarias rechazadas |
| LQ09 — proveedor,429, reintento | Parser de Retry-After, red rechazada real, persistencia/recuperación PG; observación inicial429 real, sin ensayo remoto inducido |
| LQ10 — exclusión/idempotencia/reinicio | PG real con sesiones competidoras, rollback, pérdida de conexión y recuperación durante RPC real |
| LQ11 — ruta iniciada intacta | `financial-store`, regresión de publicación/inicio/incidencias y E2E móvil existente |
| LQ12 — cambio durante lectura | `assertFinancialCoherence` sobre colecciones completas; lector real hace dos consultas. No se modificó Odoo para inducir una carrera |
| LQ13 — origen/empresa/autorización | Normalizador, PG, AST del conector y HTTP401/403; administradores inactivos, choferes y IDs ajenos rechazados |
| LQ14 — migración/historia | Migración repetida33→34, inmutabilidad, rollback y conservación tras archivo con PG real |

## Cobertura, mutación y métricas

Por riesgo monetario se fijaron umbrales dirigidos de95% para líneas, ramas, funciones y sentencias y90% para mutación, además de ensayos específicos de cada invariante crítico. El porcentaje no sustituye la evidencia de integridad.

La cobertura dirigida incluye ocho módulos de dominio, normalización, esquema, persistencia, sincronización, configuración y Retry-After; excluye el archivo sólo de tipos. No se presenta como cobertura total del proyecto ni del transporte Odoo o `instrumentation`. La política monetaria, valores, normalizador, configuración, esquema, store y Retry-After tienen100% de líneas/ramas/funciones. `financial-sync` tiene98.24% líneas y94.28% ramas: la línea restante es la destrucción defensiva del cliente si falla liberar el bloqueo; no se simuló artificialmente ese fallo. La pérdida real de conexión durante RPC y su rechazo de persistencia sí se ejecutaron.

Stryker mutó cinco módulos, sin ocultar supervivientes ni excluirlos del denominador:

| Mutantes supervivientes | Revisión independiente |
| --- | --- |
| policy100,164 | Quitar guardia null no cambia el resultado porque `Set<number>.has(null)` ya rechaza |
| policy109 | `Map<number,...>.get(null)` produce la misma ausencia que la condición explícita |
| values332 | Sin `trim`, cadena vacía/espacios siguen rechazadas por el parser y conservan el error público |
| contract371 | Eliminar guardia primitiva mantiene el rechazo por metadatos obligatorios ausentes |
| contract408 | Dos valores de fallback distintos siguen fuera de tipos permitidos float/monetary |
| contract435,551 | `Number.isSafeInteger`/`Number.isInteger` ya rechazan valores no numéricos |

Son ocho equivalencias para los contratos JSON admitidos; score reportado98.68%, no100%. Las12 mutaciones PG quitaron autorización, aislamiento de shipment/origen, bloqueo, partner, idempotencia, inmutabilidad, identidad de importación, cooldown, conservación ante error y las dos protecciones de cola. Todas fueron detectadas ejecutando PostgreSQL real en copias locales aisladas.

Complejidad: estimación AST existente por531 funciones core con nombre, máximo global25; máximo entre funciones financieras nuevas16 en sincronización,11 en capacidades/normalización y10 en conciliación. El sincronizador16 separa éxito, rollback, error y liberación; revisión manual confirma que no mantiene una transacción SQL abierta durante RPC. Esta métrica no cuenta todo el proyecto ni constituye por sí sola prueba de corrección. El escaneo existente verificó14 artefactos cliente y no encontró los secretos del preview local; no se presenta como un escaneo universal de secretos.

Observabilidad automática: intentos, fallos,429, duración, última consulta/éxito, próximo intento, edad, revisión, estado y causas. Por defecto: poll60s, lote20, primer tick10s, backoff60..3600s, caché de metadatos900s; variables runtime en `.env.example`. Se evita solapamiento local y por réplica. La edad depende de volumen, latencia y fallos del proveedor; no se promete propagación instantánea. El SLO productivo de latencia/frescura queda por fijar con una muestra representativa antes de habilitar cobros.

Se siguen automáticamente entregas con al menos un plan no archivado; el archivo conserva revisiones y consultas históricas. La política de seguimiento posterior a recepción/archivo se ampliará junto con el historial y obligaciones pendientes del bloque5.

## Dependencias y seguridad

`decimal.js10.6.0` fijado para aritmética; instalación con scripts deshabilitados. Se revisó el lock y la integridad publicada. La auditoría detectó advisories del árbol existente durante el bloque: se actualizaron parches compatibles de brace-expansion/fast-uri y Next/eslint-config-next a16.3.8. La restricción de brace-expansion5 está declarada en overrides, sin editar node_modules manualmente.

Referencia: [advisory oficial GHSA-vcvr-r3jv-pc5j](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j), sobre ImageResponse/next-og y SVG controlado por atacante. La aplicación no usa ImageResponse; no se afirma haber demostrado explotación. Build, HTTP E2E y regresión se ejecutan después de la actualización. Auditoría final:0 vulnerabilidades conocidas en todo el árbol al momento de la ejecución; no implica ausencia universal de defectos.

No se registra contenido bruto de errores del proveedor ni credenciales; sólo códigos internos. SQL parametrizado, autorización en servidor, identidad/empresa/origen validados, importes finitos/acotados técnicamente y consulta RPC cerrada. El escaneo privado adicional comparó la credencial Odoo usada con64 archivos modificados/nuevos y artefactos cliente:0 coincidencias (`reports/financial-secret-scan.json`, sólo contadores/rutas, sin secretos). No se escribieron datos en Odoo ni se cambiaron configuraciones/cuentas/servicios remotos. Five y main permanecen fuera del alcance.

## Procedimiento reproducible

Desde la raíz de Ana Rutas, Node24 y dependencias fijadas por package-lock:

```powershell
npm run typecheck
npm run lint
npm run build
npm run bundle:migration
npx vitest run --reporter=json --outputFile=reports/financial-regression-final.json
npx vitest run --config vitest.financial.config.ts --coverage
npx stryker run stryker.financial.config.mjs
node scripts/verify-financial-mutations.mjs
npx playwright test tests/e2e/driver-mobile.spec.ts --reporter=list
npx tsx scripts/quality-metrics.ts
npm audit --json
```

Para la integración externa, inyectar `ODOO_*` de la instalación en el entorno privado del proceso, `RUTAS_TEST_FINANCIAL_TARGETS` como array JSON de identidades reales y `RUTAS_TEST_FINANCIAL_EXPECTED` para estados/importes vigentes. No copiar secretos a comandos, logs, documentos ni Git. El E2E financiero requiere además `RUTAS_QA_ORDER_DATE`, y se ejecuta con:

```powershell
npx playwright test tests/e2e/financial-source-live.spec.ts --reporter=list
```

Sin variables reales las pruebas externas se omiten explícitamente, nunca pasan con un proveedor ficticio. La ejecución dirigida documentada aquí sí incluyó Odoo real. Los helpers limpian sus propias bases temporales; no ejecutar procedimientos de prueba sobre una base de producción.

La primera regresión general se inició antes de terminar dos cambios de pruebas/política y mostró782 aprobadas,2 fallidas y3 omisiones por módulos ya cargados en ese proceso. Los dos fallos eran expectativas financieras incorporadas después de cargar la versión anterior; no se relajaron aserciones. Se repitió primero la suite dirigida completa y después la general desde un proceso nuevo con código estabilizado:787 aprobadas,0 fallos y3 omisiones identificadas. No se presenta la primera ejecución como verde.

## Operación, reversión y límites

Al desplegar un artefacto aprobado, el mecanismo de migraciones existente aplica34 y crea el seguimiento; no hay comando manual por pedido ni necesidad de republicar rutas. Tras migrar, un rollback del servidor debe ser compatible con schema34: no se propone borrar historia o bajar el esquema. La APK actual tolera los campos opcionales nuevos y no cambia en este bloque.

No se ha desplegado, modificado main ni construido una APK nueva. QA física de GPS/cámara no aplica a este cambio de servidor. Las pruebas anteriores pendientes de otros bloques siguen pendientes; no se convierten en aprobadas aquí.

La muestra externa tiene dos pedidos sin facturas, descuentos ni impuestos. No demuestra una validación posterior real, notas de crédito, backorders, impuestos complejos o descuento remoto. Los casos no conciliados quedan bloqueados explícitamente; antes de habilitar nuevos flujos monetarios deben obtenerse sus contratos reales y evidencia correspondiente. La aceptación de efectivo/transferencia/crédito y la liquidación completa todavía no existen en este bloque.
