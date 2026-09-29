# QA — miniaturas de productos / BL-151

Fecha: 2026-09-29. Rama de trabajo: `develop`; base `f0b8eb5`.
Alcance: foto junto al nombre en los dos detalles de pedido del chofer; logo Five
con opacidad baja cuando falta. No cambia cantidades, incidencias, entrega,
publicaciones, métricas, esquema de BD ni configuración remota. Odoo sólo lectura.

## Contrato y seguridad

- Imagen auxiliar con endpoint privado por plan/pedido/índice/revisión. Exige
  sesión móvil y asignación vigente antes de caché y después de la lectura Odoo.
- Se cotejan **todas** las líneas con la importación original, no sólo el nombre
  de una línea. Fuente Odoo y empresa deben corresponder a la importación.
- Lectura fija `product.product.image_128`, normalizada a WebP de hasta 128 px y
  64 KiB; límites de bytes de entrada y píxeles. No redirecciones ni URLs externas
  enviadas al teléfono. Credenciales Odoo sólo en servidor.
- Caché de servidor: 64 lotes / 16 MiB, 15 minutos; consultas simultáneas del
  mismo lote comparten trabajo, error reintentable a los 30 segundos.
- Caché Android: privada por servidor/dispositivo/recurso, 256 archivos / 8 MiB;
  renovación a 15 minutos y caducidad a 24 horas. No toca evidencia ni cola de
  comandos. Cuatro descargas concurrentes, fuera del hilo de interfaz.
- Respuesta `no-store, private`, `nosniff`, `same-origin`. No se modifica Odoo.

## Evidencia ejecutada

| Puerta | Resultado |
| --- | --- |
| Next build / TypeScript | Aprobados |
| ESLint | 0 errores; 1 advertencia previa en `stryker.product-amendments.config.mjs` |
| Backend nuevo | 6/6, PostgreSQL real y lectura del Odoo configurado |
| Regresión de móvil, ejecución, incidencias, publicación y Odoo | 29/29 en 6 archivos |
| E2E privado de miniaturas con Odoo real | 1/1: 200/204, sesión, aislamiento, revisión, cancelación, concurrencia y snapshot intacto |
| E2E de incidencias existente | 2/2, incluyendo cancelación de ruta y retiro del reporte |
| Android JVM | 103/103; cuatro pruebas nuevas de URL, stream y caché |
| Android build / lint | APK y APK de pruebas compiladas; 0 errores, 33 advertencias existentes, ninguna en `ProductThumbnail*` |
| Android Compose en dispositivo | Pendiente: intento real de `connectedDebugAndroidTest` falló antes de ejecutar pruebas, `AdbCommandRejectedException: closed` al consultar `am get-config` |
| Dependencias de producción | `npm audit --omit=dev --audit-level=high`: 0 vulnerabilidades |
| Mutación Android | 4/4 detectadas: URL externa, mezcla de dispositivos, stream sin límite, imagen que nunca renueva |
| Mutación de guardas críticas del servidor | 37/37 detectadas, 100%; incluye asignación del pedido, revisión, cotejo completo de líneas y fuente Odoo |

Cobertura dirigida del servicio/caché TS: líneas **100% (58/58)**, funciones
**100% (15/15)**, ramas **91.30% (42/46)**, statements **96.05% (73/76)**. Caché
del servidor: 100% en todas las métricas. Android `ProductThumbnailStore` y sus
funciones: líneas 45/45, ramas 57/74 (77.03%); excluye una línea sintética de
Companion. Complejidad JaCoCo cubierta 22/33. No es cobertura global de la app.

Objetivo por riesgo: 100% de líneas del servicio auxiliar y pruebas/mutaciones
explícitas de autorización, identidad, aislamiento y límites. Las ramas defensivas
restantes (p. ej. fila ausente tras leer una publicación o resultado WebP superior
al límite después de reducirlo) no se presentan como cubiertas. El flujo Compose
y la red Android requieren instrumentación; JVM no prueba renderizado.

Carga observada: ocho solicitudes HTTP concurrentes en **1154 ms** contra backend
local con Odoo real. No equivale a p95 ni a un SLO de producción. Presupuesto
técnico de la imagen: conexión 8 s / lectura 15 s, sin bloquear acciones; la
latencia de Odoo debe observarse en el entorno de despliegue.

Defectos encontrados y corregidos durante QA: lectura de streams que requería
API 33 (reemplazada por lectura acotada compatible con Android 8) y prueba que
no distinguía `every` de `some` al cotejar líneas (ampliada a dos partidas,
incluyendo una coincidente y otra alterada).

## Reproducción

Usar Node/JDK/Android SDK configurados para el proyecto y PostgreSQL local real.
Para integración Odoo, suministrar sus variables de entorno habituales mediante
el mecanismo privado existente; `RUTAS_TEST_IMAGE_PRODUCT_ID` y
`RUTAS_TEST_NO_IMAGE_PRODUCT_ID` deben corresponder a productos comprobados en esa
instalación. Sin la primera variable, la prueba real Odoo se omite expresamente.
La ejecución registrada utilizó ambos productos y **no omitió** esa prueba.

```powershell
npm run typecheck
npm run lint
npm run build
npx vitest run tests/product-thumbnails.test.ts --maxWorkers=1 --coverage --coverage.include=src/core/product-thumbnails.ts --coverage.include=src/core/product-thumbnail-cache.ts
npx playwright test tests/e2e/product-thumbnails.spec.ts --workers=1
npx stryker run stryker.product-thumbnails.config.mjs
npm audit --omit=dev --audit-level=high
cd driver-app
.\gradlew.bat testDebugUnitTest createDebugUnitTestCoverageReport lintDebug assembleDebug assembleDebugAndroidTest --console=plain
.\scripts\verify-arrival-mutations.ps1 -ProductThumbnailOnly
.\gradlew.bat connectedDebugAndroidTest '-Pandroid.testInstrumentationRunnerArguments.class=com.five.anarutas.driver.ProductThumbnailUiTest' --console=plain
```

Evidencias locales: `coverage/coverage-summary.json`,
`reports/mutation/product-thumbnails.json`,
`reports/mutation/product-thumbnails-android.json`, `test-results/`,
`driver-app/app/build/test-results/`, `driver-app/app/build/reports/coverage/`
y `driver-app/app/build/reports/lint-results-debug.html`.
Aceptación: `tests/acceptance-product-thumbnails.feature` (PT01..08).

## Entrega de prueba

APK **0.8.4 / código 26**, para el servidor develop configurado en Gradle:
`.local/releases/Five-Rutas-Chofer-0.8.4-develop.apk`.
SHA-256: `1D54EE15A1F6A6A4B380E905461A96F46E70FAD0AF8CD3D900342B6CD9C89319`.

Despliegue manual del backend por el propietario e instalación de la APK nueva.
No requiere republicar rutas ni migración. Hasta desplegar el endpoint, la APK
muestra el logo de respaldo. APK anterior ignora el campo nuevo. La prueba de
campo debe abrir pedidos con/sin foto, tocar el renglón, conservar alerta y
cantidad neta, y repetir con pérdida/recuperación de conexión. No se ha realizado
esa prueba de campo ni un despliegue remoto desde esta tarea.

La credencial temporal local de QA se retiró después de terminar las lecturas
reales. No se incorpora ninguna credencial al diff. El propietario autorizó
expresamente commit y push a `develop` el 2026-09-29 con QA visual/físico pendiente
a su cargo. Esta excepción permite la entrega de prueba, no certifica producción
ni autoriza despliegue remoto o cambios a `main`.
