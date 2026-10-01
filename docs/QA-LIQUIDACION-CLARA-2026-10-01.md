# QA — liquidación clara y recibo completo

Alcance aprobado el 2026-10-01, base develop `5f1703a`. Incluye las correcciones
visuales posteriores del propietario: quitar recuadros verdes interiores y
mostrar primero el pedido, después sus totales y debajo las devoluciones en
texto amarillo. No se cambia main, no se despliega ni se escribe en Odoo.

## Diagnóstico y resultado

- La sincronización ya registra pedidos sin vehículo al importar. La asignación
  no consulta Odoo. Se verificó la cadena proveedor → worker → PostgreSQL → SSE
  → tablero abierto con un pedido sin asignar, sin pulsar Actualizar.
- La configuración de develop inspeccionada mantiene el intervalo por defecto
  de 60 segundos. La elegibilidad por objetivo y el temporizador pueden hacer
  que el siguiente intento ocurra dos ciclos después: aproximadamente 1–2 minutos
  en condiciones normales, más lectura/cola/reintentos. No es un webhook. Los
  logs disponibles no permiten atribuir retrospectivamente el retraso de S00096.
- Los importes se formatean desde decimales exactos con símbolo, agrupación y
  mínimo de decimales de la moneda. Se conserva precisión adicional del precio
  unitario y se eliminan ceros sobrantes en cantidades.
- La explicación por incidencia reparte la deducción ya calculada por partida,
  usando moveId + saleLineId e IDs estables. No se recalcula el pago mediante
  nombres o precio unitario × cantidad. Se informa por separado el redondeo.
- El recibo usa el snapshot confirmado; una actualización posterior no cambia
  el dinero histórico. No cambia la base/firma del cobro, comandos ni esquema.
- Web y Android muestran tarjetas compactas, filtros y paginación; abrir un
  pedido abre un modal independiente. El recibo contiene pedido completo,
  original, devoluciones, final, cobrado/crédito y detalle de incidencias abajo.
  Efectivo y transferencia combinados mantienen su desglose.
- El panel conserva una actualización efectiva. Android oculta la actualización
  global duplicada sólo en esta pantalla. La lista móvil exige entrega y cobro
  confirmado; el contrato operativo sigue entregando pedidos abiertos para cobrar.
- Aceptar sigue reservado a liquidación y habilitado después de Liquidar. Abrir,
  buscar y cerrar detalles no ejecuta operaciones financieras.

## Evidencia automatizada

| Puerta | Resultado y evidencia |
|---|---|
| Regresión general | 902 aprobadas, 0 fallos, 3 omisiones externas; 85 archivos aprobados + 1 omitido, 1466.28s. `.local/qa-liquidation-regression.log` y `-finished.json` |
| Proyección y formato exacto | 7 pruebas; 100% líneas 34/34, ramas 50/50, funciones 12/12 y sentencias 40/40. `coverage/financial-display/coverage-summary.json` |
| Mutación TS | 125/128 detectadas, 97.66%. Reparto por incidencia 79/79; formato 46/49. `reports/mutation/financial-display.json` |
| Android JVM | 132 aprobadas, 0 fallos/errores. XML en `driver-app/app/build/test-results/testDebugUnitTest` |
| Cobertura Android crítica | financialMoney 8/8 líneas y 6/6 ramas; condición de visibilidad 1/1 y 4/4; vigencia 3/3 y 14/14. JaCoCo `driver-app/app/build/reports/coverage/test/debug/report.xml` |
| Mutación Android | 11/11 detectadas en copias aisladas; los dos mutantes monetarios se repitieron tras el último ajuste del formateador. `.local/qa-liquidation-android-mutations.log`, `-android-currency-mutations.log` |
| Seguridad de dependencias | `npm audit --omit=dev`: 0 vulnerabilidades productivas. `.local/qa-liquidation-audit.json` |
| Compilación y análisis | Next build, TypeScript, ESLint, Android lint/APK y compilación de pruebas instrumentadas. Logs `.local/qa-liquidation-*` |
| Navegador final | 2/2 aprobadas, volumen 47.6s y recorrido de cobro/recepción 35.6s. `.local/qa-liquidation-http-final.log` |

ESLint: 0 errores y 1 aviso anterior en stryker.product-amendments.config.mjs.
Android lint: 0 errores y 35 advertencias; informe XML/HTML conservado, sin
presentarlas como errores corregidos por este bloque. El escaneo de 14 archivos
del bundle de cliente no detectó las credenciales locales de QA.

El objetivo de cobertura es 100% en el nuevo reparto/formato monetario y la
condición pura de visibilidad, por riesgo de importes o pedidos incorrectos.
No se presenta ese porcentaje como cobertura de toda la aplicación. El adaptador
JSONObject Android se cubre con prueba instrumentada compilada, aún no ejecutada
en dispositivo; no se sustituye el runtime Android por un mock para inflar JaCoCo.

Los tres supervivientes TS son variantes equivalentes en las entradas soportadas:
el selector de moneda toma la primera parte de es-MX, la configuración regional
vacía cae en la misma agrupación del entorno, y quitar maximumFractionDigits del
agrupador no afecta a sus entradas BigInt. Ningún mutante del reparto sobrevive.
Complejidad AST estimada: displayQuantity 5, displayMoney 7,
incidentFinancialDisplay 8. La métrica excluye callbacks anidados sin nombre;
`reports/complexity.json` documenta ese límite.

## Integración y navegador

PostgreSQL temporal real, migraciones, comandos reales, autenticación HTTP y Next
compilado. Los datos de dominio de pruebas no sustituyen endpoints de proveedor.
No se interceptan respuestas API con mocks.

1. `financial-source-live.spec.ts`: Odoo real de develop, sólo lectura. Se consultó
   la identidad real de S00094/S00095/S00096. El ensayo introduce estado anterior
   únicamente en su PostgreSQL aislado, conserva vehicle_id nulo y comprueba que
   el worker restaura validación y partidas y el navegador muestra Validado sin
   refresco ni asignación. Pasó en 59.1s con intervalo QA de 5s; esto no mide el
   tiempo de producción de 60s. Captura `odoo-unassigned-automatic.png`.
2. `settlements.spec.ts`: efectivo/transferencia/crédito/combinado, devolución
   persistida, snapshot, modal independiente, orden de secciones y geometría
   de tabla, cantidad limpia y descuento exacto. Cierre Escape restaura foco;
   aceptación individual en vivo, cancelar, reintento, recepción restante y
   aislamiento de roles 401/403/404. También conserva la regresión de usuario
   interno sin correo obligatorio.
3. `settlement-volume.spec.ts`: 50 pedidos cobrados por comandos reales; 12 por
   página, búsqueda de S51, filtro, última página de 2, modal a 390px sin desbordar
   la ventana, foco restituido y cero solicitudes de liquidación generadas al navegar.

Capturas finales en `.local/qa-settlements`: `receiver-compact.png`,
`order-modal.png`, `return-discount-modal.png`, `volume-modal-mobile.png`.
Los IDs/clientes de esas capturas corresponden a datos de QA, no a clientes reales.

La última muestra HTTP tiene 25 respuestas, p95 104.5ms y máximo 149.4ms,
sin errores inesperados del recorrido final (`.local/qa-settlements/timing.json`).
Muestra local, no prueba de carga ni garantía de latencia de producción.
La vista a 390px convierte cada producto en una ficha de campos dentro del
mismo modal; sus importes no quedan fuera del ancho visible.

Durante QA se detectó compresión de la tabla por tracks de grid dentro del
cuerpo limitado del modal. El cuerpo ahora usa columna flex con secciones de
altura intrínseca. La regresión compara la altura del contenedor con la tabla y
el orden vertical productos → totales → incidencias; `toBeVisible` solo no bastaba.
Tras renombrar Importe original a Total original se actualizó una aserción de texto
antigua, sin cambiar el resultado esperado ni omitir pasos del recorrido.

Las 3 omisiones generales son miniaturas Odoo, envío FCM real y contrato financiero
Odoo. La cadena financiera Odoo se ejecutó aparte en el E2E real descrito; las
otras dos integraciones preexistentes son ajenas al cambio y conservan su excepción
documentada. No se declaran ejecutadas. No hay nueva integración de red en este bloque.

## Reproducción

Desde la raíz del repositorio:

```powershell
npm run typecheck
npm run lint
npm run build
npm audit --omit=dev
npx vitest run --config vitest.financial-display.config.ts --coverage
npx stryker run stryker.financial-display.config.mjs
npm test -- --reporter=verbose
npx playwright test tests/e2e/settlements.spec.ts tests/e2e/settlement-volume.spec.ts
node --import tsx scripts/quality-metrics.ts
```

Para la lectura de Odoo usar configuración privada ODOO_* y
RUTAS_TEST_FINANCIAL_TARGETS con identidades consultadas del origen, más
RUTAS_QA_ORDER_DATE. Ejecutar `tests/e2e/financial-source-live.spec.ts`.
Nunca subir esas variables ni la configuración privada a Git.

Desde driver-app, con ANDROID_HOME apuntando al SDK instalado:

```powershell
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest createDebugUnitTestCoverageReport --console=plain
.\scripts\verify-financial-mutations.ps1
```

## QA física y entrega

La prueba física de Compose, tipografía ampliada, GPS/Navigation y actualización
de APK queda con el propietario por su excepción explícita vigente. Compilación
instrumentada no equivale a ejecución física. El propietario realiza el deploy.

1. Importar pedido sin asignar, validar en Odoo, dejar el panel abierto y observar
   actualización automática; repetir asignado antes de iniciar la ruta.
2. Mantener un pedido abierto: no debe salir en Liquidación móvil. Finalizar
   atención y cobro: aparece automáticamente con su importe y método.
3. Abrir pedido con devolución: revisar todos los productos, original,
   devoluciones, final, cobrado y renglón amarillo con producto/cantidad/descuento/motivo.
4. Probar combinado y crédito sin confundir dinero recibido con crédito.
5. Liquidar → cancelar/aceptar; en la cuenta de liquidación comprobar habilitación
   de Aceptar, importe y recepción en vivo. Reabrir y recuperar sin duplicar.
6. Revisar móvil estrecho/letra grande, búsqueda y páginas; cerrar modal debe
   conservar la lista, filtro y posición. Ningún pedido pendiente entra en liquidación.

No requiere migración nueva ni configuración manual. Los recibos existentes se
conservan. Volver a la versión anterior pierde las mejoras de presentación, sin
necesidad de borrar datos. Artefacto y comprobaciones finales se registran abajo.

APK: `.local/releases/ana-rutas-driver-0.8.12-liquidacion-clara.apk`, versión
0.8.12/code34, 69,885,522 bytes, minSdk26/targetSdk36. Firma verificada con
apksigner y comparada directamente con 0.8.11: certificado SHA256
`f92d2160eccdadb8b72ac5573ef07dc09eb8fdd57c10621d33afaeb7dd4c2e35`.
SHA256 del archivo final:
`66907CFE66DCFD3FEABAEC9B83F565D47CDBA17C88234E12EB19BECBA796505C`.
Actualizar conservando datos. Es una APK de desarrollo para la prueba autorizada.
Commit/push a develop bajo autorización permanente, con QA física pendiente
informada; no certificación ni despliegue de producción.

## Corrección posterior — cantidad final en el modal web

El propietario detectó que Alfalfa conservaba cantidad5 aunque la devolución4
y el importe final eran correctos. La celda leía `line.quantity` del recibo,
que es la cantidad original. Ahora usa `line.physicalRemaining`, ya calculada
por el dominio y congelada en el mismo snapshot. Encabezado y etiqueta móvil
web: Cantidad final. No cambia Android, importes, recibos, esquema ni comandos.

- Regresión roja sobre el comportamiento anterior: pedido QA de2kg con
  devolución1 mostraba2kg, esperaba1kg. Fallo confirmado de la celda, no del
  proveedor ni del cálculo; `.local/qa-final-quantity-before.log`.
- La misma prueba PG/HTTP/Chrome pasa después del ajuste,1/1 en28.6s;
  original$20.00 y final$10.00 permanecen iguales. También recorre recepción,
  reintentos, cancelación y permisos. `.local/qa-final-quantity-http.log`.
- 41 pruebas de política/formato existentes aprobadas: cantidades fraccionarias,
  devoluciones completas, cancelaciones y separación de reposiciones. No nueva
  función ni lógica monetaria crítica; se conserva cobertura/mutación del bloque
  anterior. La regresión roja detecta concretamente volver al campo incorrecto.
- Next build con TypeScript, ESLint0 errores/1 aviso previo y diff-check verdes;
  escaneo de14 archivos cliente sin credenciales locales. Logs
  `.local/qa-final-quantity-build.log`, `-unit.log`, `-lint.log`, `-metrics.log`.
- Latencia local de23 respuestas: p95 71.1ms, máximo115.9ms; no prueba de carga.
  Complejidad del dominio y contratos sin cambios. No ampliar la regresión general
  ni reconstruir APK para una selección de campo y etiqueta exclusiva de web.

Reproducción: ejecutar las dos unidades `driver-financial-policy.test.ts` y
`financial-display.test.ts`, `npm run build`, `npm run lint` y
`npx playwright test tests/e2e/settlements.spec.ts`. Captura verificada actualizada:
`.local/qa-settlements/return-discount-modal.png`. Entrega develop, deploy del
propietario; no requiere cambiar configuración ni modificar el pedido existente.

## LC-T07..08 — orden de incorporación y tarjetas compactas

Petición explícita de 2026-10-01: flecha roja de retorno, cobros nuevos al final,
actualizar sólo en la cabecera Android, retorno con borde lima y tarjetas menores.

Autopsia: `financeExecutionDetail` conserva el orden de las paradas; el panel
lo estaba reutilizando. La proyección de liquidación ahora ordena por fecha
del recibo confirmado ascendente y por id en empate. Android ordena sólo los
pedidos entregados/cobrados de esa pantalla. El contrato móvil operativo sigue
incluyendo pedidos antes del cobro en orden de paradas. No cambiar importes,
snapshot, permisos, comandos, locks, bases históricas, esquema ni origen Odoo.

Interfaz: flecha web roja de20px, tarjeta con14px de margen interno, separación
de10px y acciones de44px. App: tarjeta específica con14dp/8dp de separación,
acciones juntas de48dp, sin altura fija ni truncado de nombres/importes. Botón
de retorno negro con borde/texto lima. El mismo DriverFinanceModel controla
toolbar y pantalla; el icono muestra progreso en lectura/recuperación y no usa
el refresco del dashboard. `finally` restablece la lectura al fallar/cancelar;
se conservan guardas de visibilidad, identidad de dispositivo y exclusión mutua.
Actualizar sigue siendo una lectura disponible tras un fallo de envío pendiente.

Evidencia:

- 9 unidades de formato/incidencias/orden, cobertura100% de líneas, ramas,
 funciones y sentencias; comparador con complejidad estimada2.
- 55 pruebas financieras/política/roles sobre PostgreSQL real,0 fallos;
 cobertura99.61% líneas,98.03% ramas,100% funciones. Contratos de permisos,
 concurrencia, reintento/idempotencia, congelación de recibos y lectura intactos.
- Stryker: nuevo orden5/5 mutantes detectados; agregado130/133=97.74%, sin
 timeout ni ruta sin cobertura. Los3 equivalentes previos de Intl siguen
 documentados, no son nuevos supervivientes. Descuentos79/79.
- Android:134 pruebas JVM,0 fallos; orden con100% de líneas/ramas y complejidad2.
 Mutación en copia temporal aislada3/3: invertir orden, ignorar fecha y perder
 desempate. El script conserva alcance financiero como opción predeterminada.
- E2E real de recepción/roles1/1 en1.1min, conserva devolución y
 cantidad final, solicitud/aceptación, cancelación, reintentos y separación de roles.
 Volumen1/1 en1.2min:49 cobros en orden inverso a ruta, incorporación50 por evento
 PostgreSQL/SSE sin Actualizar en374ms, posiciones previas exactas, reentrada,
 página12 y última tarjeta nueva al final. Tarjeta285px, botones>=44px,
 flecha roja rgb(255,121,121), modal390px sin desbordamiento y foco recuperado.
- Next/TypeScript y ESLint verdes (0 errores,1 aviso previo ajeno);14 artefactos
 cliente sin credenciales locales. No cambios de dependencias ni superficie de auth.

Incidencias de QA corregidas: la nueva prueba Compose requería indicar rango
indeterminado en `hasProgressBarRangeInfo`; no fallo de UI productiva. La primera
prueba de reentrada no reponía la fecha QA después de reload; corrigió el recorrido
de prueba para seleccionar de nuevo la ruta, sin persistencia artificial de filtros.

Reproducción: `npx vitest run --config vitest.financial-display.config.ts --coverage`,
`npx vitest run --config vitest.settlements.config.ts --coverage`,
`npx stryker run stryker.financial-display.config.mjs`, `npm run build`,
`npm run lint`, `node --import tsx scripts/quality-metrics.ts` y
`npx playwright test tests/e2e/settlements.spec.ts tests/e2e/settlement-volume.spec.ts --workers=1`.
Android: `gradlew.bat testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest createDebugUnitTestCoverageReport`;
`scripts/verify-financial-mutations.ps1 -Scope receipt` con ANDROID_HOME real.

Logs en `.local/qa-settlements/compact-*`; captura revisada
`compact-receipts-desktop.png` y `volume-modal-mobile.png`. Rendimiento374ms es
evidencia local de1 evento, no SLO ni prueba de carga de producción. Ordenación
en memoria O(n log n), sin consulta adicional. No repetir la regresión general
de902 casos para un cambio de presentación y orden de lectura; se repite el
dominio financiero completo afectado y los recorridos HTTP críticos.

QA física Android sigue a cargo del propietario según autorización/ excepción
vigente: spinner real con conexión lenta/error, retorno, tap en ambas acciones,
nombre largo/tipografía150%, recibo nuevo después del anterior y sólo entregados.
Las3 nuevas pruebas Compose se compilan en APK instrumentada; compilación no
equivale a ejecución en dispositivo. GPS/Navigation y proveedor Odoo intactos.

Verificación final Android: `compact-android-verified.log`, BUILD SUCCESSFUL
en2m35s;134JVM/0 errores/0 fallos, lint0 errores/35 avisos previos. APK y APK
instrumentada compiladas. Versión0.8.13/code35, aplicación
`com.five.anarutas.driver`, targetSdk36. Artefacto final69,908,881 bytes:
`.local/releases/ana-rutas-driver-0.8.13-liquidacion-compacta.apk`.
SHA256 `9AD7EDE7316D91A7FEA8108708DE474D2432FDBAAE5E420FB869DD75341BBED2`;
coincide exactamente con el resultado de assembleDebug. Firma verificada con
apksigner, certificado SHA256
`f92d2160eccdadb8b72ac5573ef07dc09eb8fdd57c10621d33afaeb7dd4c2e35`,
idéntico al de0.8.12: actualizar sobre la anterior conserva datos.
Entrega develop bajo autorización permanente y excepción física vigente;
deploy y prueba física del propietario. Sin migración ni configuración nueva.

## LC-T09 — navegación y resumen horizontal Android

Petición explícita del propietario de 2026-10-01; alcance exclusivo Android.
Autopsia: el BackHandler de DriverShell siempre regresaba a HOME salvo menú
abierto. FinanceMoneySummary creaba tres Surface fillMaxWidth sucesivas dentro
de una Column. El retorno se dibujaba antes del nombre de ruta; el acceso usaba
DriverIcon.CHECK. Se corrigen esas conexiones de presentación.

Cambios: DriverBackPolicy resuelve menú primero, detalle financiero al listado
financeExecutionId=null, otras pestañas y siguiente Atrás a Inicio. El shell usa
la misma política en el BackHandler real. Los Dialog conservan su ventana y
onDismiss propios; no alterar su cierre ni enviar comandos al navegar. Se
limpia la selección del pedido/modal al volver al listado para no reaparecer.
La lectura durante carga o error usa la identidad seleccionada de la ruta.

FinanceRouteHeader muestra nombre/fecha a la izquierda y botón negro/borde lima
a la derecha, con mínimo48dp y texto adaptable. FinanceMethodTiles distribuye
tres superficies en una fila con ancho (disponible-16dp)/3, mínimo100dp; las
tarjetas pequeñas son aproximadamente cuadradas a escala normal y pueden
crecer con letra/cifras largas. En ancho extremo mantienen fila con scroll
horizontal. No recortar ni redondear importes: mismo financialMoney y moneda
en renglón propio. Semántica agrupada por tarjeta para lectura accesible.
MONEY es un vector local de signo de pesos, aplicado al acceso y menú financiero.

Puertas aplicables: toda la regresión JVM Android, cobertura del nuevo retorno,
mutación de condiciones de navegación en copia temporal, lint y compilación
de app/Compose. Nuevas pruebas Compose de posición del retorno, tres tarjetas,
importe largo con150% de letra y Atrás nativo con modal/menú/selección/listado.
Ninguna API, esquema, dinero, autenticación, dependencias ni secret cambia;
no repetir55 contratos PostgreSQL y web E2E del bloque previo porque son intactos.

Reproducción: con ANDROID_HOME real, dentro de driver-app ejecutar
`gradlew.bat testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest createDebugUnitTestCoverageReport`
y `scripts/verify-financial-mutations.ps1 -Scope navigation`.
Logs `.local/qa-settlements/horizontal-android-build.log` y
`horizontal-navigation-mutation.log`. Escenarios Gherkin LC15..16 en
tests/acceptance-liquidation-display.feature. La ejecución física de Compose,
gesto Atrás y diseño con datos reales queda a cargo del propietario según
excepción vigente; compilar instrumentación no prueba ejecución en dispositivo.

Resultados de unidad:138 pruebas JVM,0 fallos/0 errores. Nuevo DriverBackPolicy:
líneas5/5, ramas6/6, instrucciones14/14, método1/1; cobertura100% y complejidad4.
Matriz incluye menú en todos los destinos con/sin selección, detalle financiero,
listado financiero y selección retenida al salir a cada otra pestaña. Objetivo100%
en este resolver por su efecto sobre una pantalla de dinero; pagos intactos.
No aumento de latencia de red ni nuevas lecturas por diseño; resolución local
constante y sólo tres tarjetas por moneda. No declarar SLO o rendimiento físico.

Incidencia de QA: la primera compilación instrumentada usó Espresso.pressBack
sin dependencia instalada. Se corrigió para enviar KEYCODE_BACK con
InstrumentationRegistry ya usado por el proyecto, sin nueva dependencia.

Verificación final: `horizontal-android-verified.log`, BUILD SUCCESSFUL en3m55s;
138JVM/0 errores/0 fallos, lint0 errores/35 avisos previos. Las cuatro mutaciones
de navegación fueron detectadas4/4: menú ignorado, detalle enviado a Inicio,
listado atrapado y selección financiera imponiéndose sobre otras pestañas.
Cuatro nuevas pruebas instrumentadas compiladas, no ejecutadas en dispositivo;
la comprobación visual y el gesto físico Atrás los realiza el propietario.

APK0.8.14/code36, aplicación `com.five.anarutas.driver`, targetSdk36;
69,131,082 bytes en `.local/releases/ana-rutas-driver-0.8.14-liquidacion-horizontal.apk`.
SHA256 `5E9177ECA6908F6BDFE06D072464E98C06D9945D6397912A0FE1B66C885CF363`,
idéntico al APK generado por assembleDebug. Firma verificada con apksigner,
certificado SHA256 `f92d2160eccdadb8b72ac5573ef07dc09eb8fdd57c10621d33afaeb7dd4c2e35`,
el mismo de0.8.13; actualización sobre la anterior compatible con datos locales.
Entrega a develop bajo autorización permanente y excepción física vigente;
sin deploy, cambios de servidor, migración ni configuración nueva.

## LC-T10 — cantidad final del recibo Android

Autopsia: FinanceOrderDetail ya seleccionaba payment.snapshot, pero imprimía
line.quantity original. liquidationQuantityText usa physicalRemaining congelado,
igual al modal web. No divide dinero entre precio; mantiene todas las partidas,
los importes originales/finales y las devoluciones amarillas. Etiqueta Cantidad
final explícita. Pruebas de ADES4 devueltos3 (final1), devolución completa0 y
cantidad1.000001 con importe0 impiden regresar al original o inferir peso del dinero.

140JVM/0 fallos/0 errores, selector1/1 líneas4/4 instrucciones, complejidad1;
100% cobertura del cambio. Mutaciones2/2 detectadas con2 fallos cada una.
Gherkin LC17, sin cambios de contratos ni escritura financiera. Reproducción:
comando Android del bloque anterior y verify-financial-mutations.ps1 -Scope quantity.
Logs quantity-unit.log, quantity-mutation.log y quantity-android-verified.log en
.local/qa-settlements. BUILD SUCCESSFUL1m45s; lint0 errores/35 avisos previos.
Compilación de instrumentación aprobada; ejecución física conserva excepción
del propietario. No declarar probado en dispositivo por compilar instrumentación.

APK0.8.15/code37,69,131,086 bytes:
.local/releases/ana-rutas-driver-0.8.15-cantidad-final.apk.
SHA2568993EF62CDE87950CA3B0F8215F675F508B68BDC49D2894C7ED4CF58842C0BEA;
firma SHA256f92d2160eccdadb8b72ac5573ef07dc09eb8fdd57c10621d33afaeb7dd4c2e35,
compatible con0.8.14. Entrega de bloque de presentación a develop autorizada;
sin deploy ni modificación del servidor. La ampliación de ruta/Buen trabajo
tiene especificación separada y sus pruebas siguen pendientes de construcción.
