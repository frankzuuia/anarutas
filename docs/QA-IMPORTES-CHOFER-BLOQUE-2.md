# QA de importes e incidencias del chofer — bloque 2

Estado: implementación en develop; cierre pendiente de QA Android de dispositivo. Base 362c948. Sin despliegue. Esquema 35, app 0.8.8/code30.

## Alcance comprobado

La publicación operativa permanece inmutable. La proyección financiera recupera IDs desde el import verificado y utiliza cantidades finales de Odoo. Importes decimales, reparto por mayor residuo, descuentos por devolución/faltante, reposición pagada o diferida, identidad/revisión/frescura y recibos idempotentes se validan en servidor. Las incidencias antiguas permanecen compatibles; faltantes manuales no reciben un precio inventado. Resolver o retirar un reporte no cancela su efecto financiero; cancelar sí lo revierte.

## Evidencia ejecutada

| Puerta                          | Resultado registrado                                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dominio y contratos iniciales   | 34/34 finales                                                                                                                                                         |
| PostgreSQL e incidencias        | 36/36 dirigidas iniciales; migración repetida, concurrencia, identidad, revisión, frescura, edición, resolución, cancelación y replay                                           |
| Cobertura inicial dirigida      | 99.27% líneas, 98.43% ramas, 100% funciones; objetivo >=95% por riesgo monetario                                                                                                 |
| Mutación de dominio             | 397/410 detectadas, 96.83%; sin timeouts/errores ni rutas sin cobertura; objetivo >=90%                                                        |
| Mutación PostgreSQL             | 6/6 detectadas: revisión, vigencia, error de fuente, movimiento, línea de venta y límite SQL                                                                                    |
| Odoo real, sólo lectura         | Contrato aprobado con PG real y proyección; S00092 pendiente, 11 partidas/2498.38MXN; S00093 ready,17 partidas/3538MXN, ajuste0.01; recuperación de desconexión real comprobada |
| HTTP y regresión administrativa | 3/3 Playwright sobre Next y PG reales; consulta, faltante ligado, replay, autorización, panel/exportación y retiro histórico                                                    |
| Android JVM/build/lint          | 120 pruebas,0 fallos,0 errores; build/lint, cobertura JVM y APK final aprobados; mutación Android 6/6                                                                           |
| Eventos móviles                 | Fallo de notificación ajena corregido; 15/15 regresiones aprobadas                                                                                                              |
| Dependencias                    | npm audit:0 vulnerabilidades                                                                                                                                                    |
| Build web                       | Aprobado tras separar el validador cliente de orders-validation/plans/PostgreSQL                                                                                                |
| Android Compose                 | Casos compilados; ejecución bloqueada por ADB: am get-config y cmd activity get-config devuelven closed; Gradle falla antes de ejecutar pruebas                                 |

Los casos monetarios deterministas son entradas de dominio; no sustituyen Odoo ni otras APIs. PostgreSQL, HTTP y Odoo usan integraciones reales. El caso Odoo no altera validación, precios, impuestos ni pedidos del proveedor.

## Reproducción

Desde la raíz del repositorio:

```powershell
npm run typecheck
npm run lint
npm run build
npm test
npx vitest run --config vitest.driver-financial.config.ts --coverage
npx vitest run tests/driver-financial-integration.test.ts tests/product-incidents.test.ts tests/driver-mobile.test.ts
npx stryker run stryker.driver-financial.config.mjs
node scripts/verify-driver-financial-mutations.mjs
npx playwright test tests/e2e/driver-financial.spec.ts tests/e2e/product-incidents.spec.ts
```

El contrato Odoo se ejecuta con credenciales runtime privadas y RUTAS_TEST_FINANCIAL_TARGETS explícito. No colocar credenciales en comandos, logs o Git.

Desde driver-app, con ANDROID_HOME apuntando al SDK instalado:

```powershell
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest createDebugUnitTestCoverageReport --console=plain
.\gradlew.bat connectedDebugAndroidTest '-Pandroid.testInstrumentationRunnerArguments.class=com.five.anarutas.driver.DriverFinancialUiTest,com.five.anarutas.driver.ProductIncidentControlsUiTest' --console=plain
```

Logs locales: .local/block2-_.log; informes de mutación reports/mutation/driver-financial_.json; cobertura coverage/driver-financial; JVM driver-app/app/build/test-results/testDebugUnitTest. Son evidencia local ignorada por Git.

## Límites de cierre

No declarar prueba completa ni publicar el bloque hasta cerrar las puertas aplicables o contar con una excepción explícita del propietario. Regresión general: 824 aprobadas, 3 omitidas, 0 fallos (1174.42 s). Las omisiones externas no se cuentan como aprobadas; Odoo financiero fue validado por separado. Queda pendiente QA visual/cámara/giro e instrumentación de Android. Cobro y liquidación/roles pertenecen a bloques posteriores.


## Métricas y artefacto final

Complejidad ciclomática medida: máximo 19 en projectDriverFinancials, 14 en parser, 12 en incidentWeights y 9 en reparto. Se conserva esta decisión explícita: guardas de identidad/frescura y compatibilidad concentradas y probadas, sin repartir validaciones de seguridad entre consumidores. Cobertura dirigida corresponde a política/reparto; no implica cobertura global ni cobertura medida del parser. El parser sí está incluido en mutación (98.41%).

Latencia observada, no SLO garantizado: sincronización Odoo real 2097 ms; escritura administrativa HTTP 368 ms. Regresión general 1174.42 s. Errores de las ejecuciones finales descritas: 0; ADB es una limitación externa registrada. Typecheck/build/bundle de migración aprobados. Lint 0 errores, 1 advertencia anterior ajena al bloque; npm audit 0 vulnerabilidades.

Revisión de 13 mutantes supervivientes: 3 de desempate conservan el orden para índices originalmente ascendentes y sort estable; 1 guardia de objeto queda cubierta por identidades numéricas bajo JSON; 3 redundancias de identidad/evidencia y líneas de sección dependen del contrato financiero previo validado. Los otros 6 afectan fallback de razones, etiqueta de estado, guardas de captura de errores y orden de issues; no se clasifican como equivalentes ni se afirma detección completa. No alteran los importes comprobados. El informe JSON conserva el detalle verificable.

APK final: .local/releases/ana-rutas-driver-0.8.8-block2.apk; versión 0.8.8/code30, minSdk26. SHA256: 8380C81A0D1E96CF0F24E7E2C5427F857D2833121CB4CB0B3CEF392F5BC3B66A. Firma de actualización compatible comprobada con apksigner. Requiere backend con migración35 y estos cambios; no se ha desplegado.

Instrumentación compilada pero no ejecutada: BlueStacks declara boot_completed=1; am get-config y cmd activity get-config terminan con error closed. No se borraron datos ni se reinició el dispositivo. No se certifican cámara, giro, composición visual o interacción física. El propietario autorizó el 2026-09-30 continuar y publicar en develop, asumiendo las pruebas de dispositivo al terminar todos los bloques («ok las pruebas las hago yo» y «dale termina los bloques y al final probamos todo de una»). La excepción permite commit/push de desarrollo; no certifica QA física ni producción.
