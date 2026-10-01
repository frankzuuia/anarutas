# Modal y cierre de trabajo conectado — 2026-10-01

Plan CR-T01..03 confirmado por el propietario. BL184..185/CR01..12.
No se utiliza ui-ux-pro-max. Se conserva la prueba sin regreso a bodega.

## Diagnóstico y resultado

El cierre financiero ya existía en route_driver_work_completions. Inicio,
ejecución, publicación y mapa sólo consultaban el cierre GPS de
route_driver_execution_completions. En el modo temporal, el segundo registro
no existe: el trabajo quedaba cerrado pero las pantallas conservaban una ruta
iniciada. La proyección compartida ahora reconoce ambos registros reales y
expone workCompletedAt separado para identificar trabajo finalizado.

Inicio excluye ese trabajo de today; conserva rutas terminadas en bodega que
todavía requieren liquidación. Otra publicación actual se selecciona si existe.
El plan conserva sus pedidos y muestra Ruta finalizada. El mapa excluye la
ejecución y nuevos comandos, GPS, reinicio o cancelación se rechazan. El cierre
incrementa una sola vez la revisión y detiene GPS/destino/ETA en la transacción.
La identidad coincide con plan, unidad, chofer y revisión originales.

Android recibe el evento y refresca también tras confirmación. Limpia selección,
pedidos abiertos, fotos y apertura pendiente del mapa; NavigationRegistry detiene
el servicio y navegador. Se mantiene Buen trabajo hasta cerrarlo, y los tickets
y resúmenes siguen disponibles. Los trabajos ya cerrados se reconocen al leer:
no hay reparación manual ni registros GPS inventados ni migración nueva.

El modal usa ServiceFormSurface con el ancho disponible y acciones fijas.
Las tres tarjetas tienen pesos iguales, sin mínimo horizontal de100dp ni scroll
lateral. El contenido crece verticalmente; el importe completo conserva su
precisión y puede ocupar varias líneas. Los filtros horizontales de la página
no forman parte del modal ni se modificaron.

## Puertas y métricas

| Verificación                     | Evidencia                                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL/contratos financieros | 84/84 aprobadas,10 archivos; incluye ambos modos, datos anteriores, aislamiento, reintentos y concurrencia           |
| Regresión general                | 934 aprobadas,0 fallos,3 omisiones externas preexistentes;91 archivos aprobados/1 omitido;1313.88s                   |
| Selectores/cierre nuevo          | V8: lifecycle6/6 líneas,5/5 ramas,2/2 funciones; comando31/31 líneas,18/18 ramas,4/4 funciones                       |
| Política de trabajo preservada   | V8:33/33 líneas y28/28 ramas                                                                                         |
| Cobertura financiera medida      | 339/340 líneas99.70%;319/324 ramas98.45%;104/104 funciones100%                                                       |
| Mutación servidor                | 13/13 detectadas por aserciones; baseline4/4; copias descartables y PostgreSQL real                                  |
| JVM Android                      | 148 aprobadas,0 fallos/errores/omisiones                                                                             |
| Transición Android               | JaCoCo:4/4 líneas,16/16 ramas,2/2 métodos;7/7 mutaciones detectadas                                                  |
| E2E HTTP/Chrome/PG               | 4 recorridos aprobados: bodega32.5s, prueba31.7s,50 pedidos42.3s y recepción individual52.3s                         |
| Modal Android                    | Pruebas Compose compiladas: tres tarjetas visibles/sin scroll, ancho240dp/letra150%/importe largo, cancelar no envía |
| App/instrumentación              | Compiladas; lint0 errores/35 avisos preexistentes                                                                    |
| Typecheck/lint/build web         | Verdes; lint0 errores/1 aviso preexistente en configuración Stryker                                                  |
| Dependencias productivas         | npm audit --omit=dev:0 vulnerabilidades                                                                              |
| Artefactos cliente               | 14 archivos revisados; sin secretos privados locales expuestos                                                       |
| Firma APK                        | Verificada, certificado compatible,0.8.18/code40                                                                     |

El objetivo en selector, cierre y transición nueva es100% por su efecto en dinero,
estado terminal y aislamiento. La cobertura SQL se demuestra por integración y
mutación; V8 no mide ramas del motor PostgreSQL. El promedio financiero no
sustituye las aserciones de autorización o de una ruta crítica. Las guardas de
servicio, reinicio y cancelación se ejecutan en PostgreSQL y sus mutantes fallan.

Latencia local del cierre concurrente:41.34/45.39ms, mismo comando, un cierre.
Lecturas financieras:21 muestras, p95 55.2ms/máximo64.4ms. Evento de incorporación
en el caso de50 pedidos:315ms, tarjeta285px y posiciones anteriores conservadas.
Son mediciones locales con Next compilado y PG aislado, no carga ni SLO productivo.
Complejidad estimada AST del selector3; contexto operativo8; máximo global30
preexistente. El método mide funciones declaradas y excluye callbacks anidados:
no certifica la complejidad completa de transacciones ni de SQL.

Las tres omisiones existentes requieren configuración externa: financial-odoo-live
(RUTAS_TEST_FINANCIAL_TARGETS), product-thumbnails(RUTAS_TEST_IMAGE_PRODUCT_ID)
y route-push(ANA_RUTAS_LIVE_FCM_QA=1). No se agregan omisiones ni se sustituyen
esos proveedores. No cambian conectores, imágenes de producto ni publicación FCM.

Defectos de la preparación de pruebas corregidos: un fixture intentó terminar
antes de capturar los cobros y recibió correctamente ROUTE_PAYMENTS_MISSING.
La prueba de planificación usaba la semana anterior y el archivado semanal
correcto la ocultaba; el E2E ahora crea una ruta de la fecha vigente y prueba
today=null después del cierre. No se desactivó el archivador ni se simularon APIs.

Los13 mutantes cubren proyección de cierre, revisión original, fecha actual,
preferencia de ruta abierta, exclusión en vivo, guarda operativa, parada GPS,
limpieza de destino/ETA, revisión única, cancelación y reinicio. Los7 Android
cubren cierre histórico repetido, ruta/revisión ajena, trabajo abierto, pérdida
del resumen y conservación indebida de otras pantallas o de una cancelación.

## Reproducción

Desde la raíz con el lockfile instalado:

```powershell
npm test
npx vitest run --config vitest.settlements.config.ts --coverage
node scripts/verify-route-lifecycle-mutations.mjs
npm run typecheck
npm run lint
npm run build
npx playwright test tests/e2e/settlements.spec.ts tests/e2e/settlement-volume.spec.ts tests/e2e/route-individual-reception.spec.ts
node --import tsx scripts/quality-metrics.ts
npm audit --omit=dev --json
git diff --check
```

Desde driver-app, ANDROID_HOME apuntando al SDK instalado:

```powershell
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest createDebugUnitTestCoverageReport --console=plain
.\scripts\verify-financial-mutations.ps1 -Scope lifecycle
```

Logs .local/qa-settlements/closure-*.log; reporte de mutación
reports/mutation/route-lifecycle-integration.json; cobertura
coverage/settlements/coverage-summary.json y
driver-app/app/build/reports/coverage/test/debug/report.xml.
Las copias de mutación validan la ruta de limpieza antes de borrarse y no
modifican develop. No se escribe en Odoo, Google ni servicios remotos.

Las pruebas Gherkin están en tests/acceptance-route-lifecycle.feature. Los
escenarios se vinculan a las pruebas PG, JVM, HTTP y Compose de la matriz CR.
La ejecución del fichero Gherkin no sustituye esa evidencia ni se presenta como
un runner Cucumber independiente.

## APK y QA física

.local/releases/ana-rutas-driver-0.8.18-cierre-ruta.apk;0.8.18/code40,
minSdk26,targetSdk36,69,147,470 bytes. SHA256:
85814541EFCF2A90A240BEBB877F07F5E0FE66DD2D1E91349A25E7FB50455E9A.
Certificado SHA256:
f92d2160eccdadb8b72ac5573ef07dc09eb8fdd57c10621d33afaeb7dd4c2e35.
Actualización compatible conservando datos, sin desinstalar.

Compose está compilado, no ejecutado en teléfono. Se conserva la excepción
física aprobada por el propietario el2026-09-30. Comprobación después de su
despliegue manual de develop y actualización de APK:

1. Abrir Liquidación y Liquidar toda la ruta. Ver las tres tarjetas completas
   sin desplazamiento lateral; probar letra grande, montos largos y varios pedidos.
2. Cancelar y confirmar que no se envía. Aceptar y verificar recepción pendiente.
3. En cuenta liquidadora abrir el paquete y los tickets; aceptar todos los cobros.
4. Finalizar trabajo. Comprobar Buen trabajo, conteos y total; cerrar y abrir Inicio.
5. Inicio queda sin esa ruta activa/pedidos; Mis rutas conserva Ruta finalizada.
6. Planificación muestra Ruta finalizada y el mapa en vivo ya no tiene esa ruta.
7. Abrir el ticket/resumen desde historial, reiniciar la app y repetir la lectura.
8. Consultar una ruta finalizada antes de esta actualización: mismo resultado
   automático. Una ruta de otro chofer continúa visible y operativa.

Puertas aplicables verdes, con la excepción física vigente ya aprobada por el
propietario. No se desplegó ni se modificó main; la entrega corresponde a develop.
