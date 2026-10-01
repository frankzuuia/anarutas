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
