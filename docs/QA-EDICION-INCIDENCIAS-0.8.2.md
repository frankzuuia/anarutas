# QA — incidencias editables y saldo neto, APK 0.8.2

## Alcance y diagnóstico

El aviso `INVALID_JSON` de la captura proviene de un servidor anterior que esperaba la cabecera JSON del envío fotográfico legacy mientras la APK 0.8.1 ya enviaba multipart v2. No es causado por una foto oscura; el usuario tapó la cámara para su prueba. El backend v2 local no se había subido ni desplegado. Esta entrega incluye ambos contratos; **primero desplegar el backend de develop y después instalar la APK 0.8.2**. Sin despliegue manual del backend, el error seguirá.

El cambio v29 añade enmienda/cancelación con recibo idempotente, versión, bloqueo de visita/pedido y bitácora append-only. La evidencia privada se conserva. El detalle móvil deriva saldo neto de las incidencias activas; faltantes manuales aparecen aparte y no alteran renglones publicados/Odoo. El panel muestra canceladas en historial y las excluye de Excel y de la lista en vivo.

## Evidencia reproducible

Desde la raíz, con Node 24 y PostgreSQL integrado de pruebas:

```powershell
npm run typecheck
npm run lint
npm test -- --maxWorkers=2
npx vitest run tests/product-incidents.test.ts tests/product-incident-form.test.ts tests/product-incident-photos.test.ts tests/product-incidents-evidence.test.ts tests/product-incidents-excel.test.ts --coverage --coverage.include=src/core/product-incidents.ts --coverage.include=src/core/product-incident-form.ts --coverage.include=src/core/product-incidents-policy.ts --coverage.include=src/server/product-photos-body.ts
npm run build
npx playwright test tests/e2e/product-incidents.spec.ts --workers=1
npx stryker run stryker.product-amendments.config.mjs
npm audit --omit=dev --audit-level=high
```

Desde `driver-app`, con `ANDROID_HOME` en el SDK y URL develop configurada:

```powershell
.\gradlew.bat testDebugUnitTest createDebugUnitTestCoverageReport lintDebug assembleDebug assembleDebugAndroidTest --console=plain -PANA_RUTAS_SERVER_URL=https://ana-rutas-develop-app.bfmayj.easypanel.host
.\scripts\verify-arrival-mutations.ps1 -ProductOnly -ServerUrl https://ana-rutas-develop-app.bfmayj.easypanel.host
```

Resultados observados: suite completa 65 archivos, 640 pruebas aprobadas, una omitida (FCM live condicionado a credenciales externas) y cero fallos; integración PostgreSQL de incidencias 7/7, E2E HTTP/panel/Excel 1/1, migración fleet 8/8, build Next y APK verdes, Kotlin unitario y lint Android verdes, `npm audit` 0 vulnerabilidades. Cobertura dirigida TS 98.92 % líneas, 93.23 % ramas, 100 % funciones. La política Android de saldo logró 18/18 líneas y 53/54 ramas; mutación Android 31/31 y mutación del núcleo de edición/cancelación 33/33. QA físico sigue pendiente: el push a develop es para prueba del propietario, no una certificación de producción. Las escrituras HTTP del E2E local tardaron 210 ms incluyendo alta, replay y conflicto; no es una medición p95 de producción.

## Procedimiento físico pendiente

ADB sólo enumeró `emulator-5554 offline`; no hay dispositivo físico utilizable para instrumentación. No se afirma validación visual real de Compose/cámara/rotación. Tras el deploy manual de develop, instalar `.local/releases/Five-Rutas-Chofer-0.8.2-develop.apk`; probar en un pedido de QA: fotografiar una incidencia con la cámara tapada, quitarla con la X pequeña, tomar otra, guardar, comprobar «Incidencia enviada», reabrir, cambiar 2 a 1 y guardar, comprobar saldo y triángulo; cancelar y comprobar retorno del saldo e historial sin Excel. Repetir con dos faltantes manuales y verificar que las partidas publicadas no cambian. Comprobar reintento offline/online y actualización concurrente por administración.

APK debug de pruebas, no firma de tienda: versionCode 24, versionName 0.8.2, SHA256 `86FD4D612F3FF26FFBB91BA2A20A405EAF28D1D622A5864C8190332F39DF750E`.
