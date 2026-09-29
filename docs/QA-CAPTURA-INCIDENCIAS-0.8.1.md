# QA — captura de incidencias 0.8.1 / BL-147

Fecha: 2026-09-28. Ana Rutas, rama develop, base
`242a85f5ef01c9bdcdd87805b428774937b1bbf1`. Cambios locales únicamente;
sin commit, push, main, despliegue, cambios de configuración remota ni Odoo.
El usuario hace Deploy manual. La prueba física Android sigue pendiente;
este documento no certifica una salida productiva completa.

## Causa y solución verificada

La captura anterior guardaba una sola ruta de foto, la sustituía al tomar otra,
usaba una vista previa grande y dejaba guardar al final del scroll. El contrato
móvil y la persistencia también eran de una sola imagen: no bastaba cambiar la UI.

- Lista de 0..3 capturas por incidencia, miniaturas y eliminación individual
  antes de enviar. Reposición/devolución requiere 1..3, faltante permite 0..3.
  Una foto satisface la evidencia; cantidad y clasificación siguen requeridas.
- Guardar permanece en un pie fijo, con explicación de los campos pendientes.
  Estado de cámara, archivo ilegible, envío y reintento son explícitos.
- Departamento: Operaciones, Compras, Ventas. Concepto: Especiales, Reparto,
  Picking. Cuatro comentarios rápidos multiselección y notas adicionales.
  El máximo existente de 2000 caracteres aplica a la suma, sin cortar notas al guardar.
- Los dos faltantes usan las mismas tarjetas radio que cerrado/rechazado;
  seleccionar no envía, Continuar abre su formulario de producto manual.
- No hay tope de incidencias por pedido. Caso PG registra doce reportes sobre
  el mismo pedido y partida, conserva 36 fotos y permite seguir reportando.
  Se conserva el límite de cantidad acumulada real de la partida, incluido lo
  ya resuelto; no se permite duplicar una cantidad mediante otro reporte.

## Contrato, recuperación y seguridad

`formVersion: 2` separa el contrato nuevo del outbox anterior. APK 0.8.0 conserva
entrada y hash del recibo; una foto antigua sigue usando su columna original.
Migración aditiva v28 añade `route_product_incident_photos` sólo para posiciones
2/3, con FK, unicidad, restricciones e inmutabilidad. No borra historial.

El endpoint autentica antes de leer el cuerpo. Multipart acotado a tres fotos
de 8 MiB cada una, 16 KiB de metadatos y margen acotado del envoltorio. Tipos JPEG,
PNG o WebP; el saneador existente valida contenido/píxeles y retira EXIF.
Servidor guarda imágenes secuencialmente y registra referencias, cantidades,
versiones y recibo en la misma transacción. Error/replay retira sólo archivos
no referenciados; COMMIT incierto conserva archivos para conciliación posterior.
La limpieza de huérfanos reconoce fotos primarias y adicionales.

Android conserva originales hasta persistir el comando completo en su outbox
privado fuera de backup. Copia parcial se revierte. Verifica el recibo antes de
reenviar tras fallo de red; bloqueo local impide otro envío simultáneo.
No se serializan fotos en preferencias ni se guardan en la galería.

Panel muestra todas las fotos mediante endpoint privado y valida pertenencia
de cada foto a la incidencia. Chofer/Concepto/fotos no aparecen en el Excel;
continúan sus nueve columnas, con Comentarios formado por selecciones y notas.
Permisos, origen, cantidades, aislamiento, concurrencia y resolución existentes
se mantienen. Resolver sólo existe en Incidencias en vivo.

Primero publicar backend compatible y después instalar APK. El servidor anterior
no entiende el nuevo multipart y rechaza esquema 28: no hacer downgrade directo
del binario ni borrar la tabla para forzarlo. Preferir corrección hacia adelante;
cualquier restauración exige procedimiento y respaldo verificado del entorno.

## Procedimiento reproducible

Desde la raíz Ana Rutas, dependencias bloqueadas y PostgreSQL de pruebas:

```powershell
npm run lint
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
npx vitest run --reporter=json --outputFile=reports/product-form-full-tests.json
npx vitest run tests/product-incident-form.test.ts tests/product-incident-photos.test.ts tests/product-incidents.test.ts tests/product-incidents-evidence.test.ts tests/product-incidents-excel.test.ts --coverage --coverage.include=src/core/product-incident*.ts --coverage.include=src/server/product-photos-body.ts --coverage.thresholds.lines=95 --coverage.thresholds.branches=90 --coverage.thresholds.functions=100 --coverage.thresholds.statements=95
npx stryker run stryker.product-form.config.mjs
npx stryker run stryker.product-incidents.config.mjs
npx playwright test tests/e2e/product-incidents.spec.ts tests/e2e/driver-mobile.spec.ts --workers=1
```

Android, desde driver-app con ANDROID_HOME apuntando al SDK:

```powershell
.\gradlew.bat testDebugUnitTest createDebugUnitTestCoverageReport lintDebug assembleDebug assembleDebugAndroidTest --console=plain
.\scripts\verify-arrival-mutations.ps1 -ProductOnly
.\scripts\verify-arrival-mutations.ps1 -ProductCaptureOnly
.\scripts\verify-arrival-mutations.ps1 -IncidentFormOnly
.\gradlew.bat connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.five.anarutas.driver.ProductIncidentControlsUiTest,com.five.anarutas.driver.IncidentFormUiTest
```

Pruebas nuevas con PostgreSQL real aislado, HTTP/navegador reales, archivos y
decodificador real. Datos sembrados de QA no son pedidos de producción. Sin
llamadas externas Odoo/Google ni APIs simuladas para certificar este bloque.
Escenarios de aceptación: `tests/acceptance-product-incidents.feature`, PI15..21.

## Evidencia y métricas

- Build/tipos/lint web aprobados sin errores ni advertencias; auditoría npm productiva: 0 vulnerabilidades.
- Cobertura dirigida: 11 pruebas/5 archivos aprobados, 190/190 líneas (100%),
  235/239 expresiones (98.32%), 222/227 ramas (97.79%), 38/38 funciones (100%).
  Objetivo por riesgo: >=95% líneas/expresiones, >=90% ramas, 100% funciones.
  No sustituye los escenarios negativos de seguridad y recuperación.
- Nuevo formulario/parser: 163 mutantes; 158 eliminados por aserciones,
  2 detectados por timeout (bucles alterados), 3 equivalentes sobrevivientes;
  score 98.16%, puerta >=95%. Política de formulario: 61/61 eliminados.
  Equivalentes del parser revisados: omitir `?.` en JSON null produce el mismo
  error capturado; omitir el guard de string en fotos mantiene rechazo por tipo
  MIME undefined. No se excluyeron silenciosamente del reporte.
- Regresión política/archivo semanal: 217/217 mutantes eliminados; se incluyó
  el contrato v2 en su configuración de pruebas para verificar que no se pierde
  al componer la entrada del reporte.
- Android: 95 JVM, 0 fallos; compilación APK y tests instrumentados aprobados.
  Lint: 0 errores/33 advertencias heredadas; no advertencias nuevas.
  Política producto: 15/15 líneas, 49/50 ramas (nullable decimal defensivo).
  Multipart: 20/20 líneas, 18/18 ramas. Selección de tarjetas: 2/2 líneas, 6/6 ramas.
  Nuevo stageBatch: 11/11 líneas, 17/18 ramas; clase outbox completa 45/46 líneas,
  51/66 ramas, incluyendo constructor Android no ejecutable en JVM y defensas heredadas.
- Mutación Android aislada: 25/25 política, 9/9 outbox/transporte, 8/8 selección:
  42/42 eliminados. Nunca se mutó develop para estas pruebas.
- E2E inicial: 3/3, incluyendo permisos/sesión/revocación, reporte multipart,
  3 fotos privadas, rechazo de cuarta, clasificación, Excel y resolución.
  Muestra de POST + replay/conflicto: 153 ms combinados. No es percentil ni SLO
  productivo. Pruebas físicas de red/cámara no se sustituyen por esa medición.
- Migración dirigida repetida: conserva incidente legado completo, su foto,
  recibo/replay sin duplicación y pedidos; actualización concurrente 27→28.
- Complejidad ESLint: formulario 9, parser 20, almacenamiento de fotos 7,
  callback transaccional de reporte 31. Se conserva atómica la autorización,
  cantidad, recibo y persistencia; casos frontera cubiertos mediante PG real.
- Suite completa: 65 archivos, 639 pruebas (637 aprobadas, una omitida existente
  y un fallo de expectativa en prueba de costos), 847.01 s. El cambio mecánico de
  expectativas del esquema había tocado también un costo 27→28. Se restauró el
  costo original; archivo completo repetido: 26/26 aprobadas, cero fallos.
  No se cambió lógica de costos/rutas. Evidencia inicial y retest se conservan
  separados; no se presenta la primera corrida como verde ni se falsifica su JSON.
- Repetición E2E de producto tras parser final: 1/1, 43.6 s; POST/replay/conflicto
  261 ms. Capturas del panel revisadas en escritorio y móvil; tabla móvil con
  desplazamiento horizontal deliberado. Fotos son archivos sintéticos de QA,
  no evidencia de captura física.
- Cierre final después de separar comentarios visualmente: build/tipos aprobados,
  E2E 1/1 en 29.2 s (incluye aserción CSS pre-wrap); latencia de escritura/replay/
  conflicto 191 ms. Migración/12 reportes repetidos: 2/2 en 25.76 s.

Evidencia en `reports/product-form-full-tests.json`, `reports/product-form-regression-retest.json`, `reports/mutation/`,
`coverage/`, `driver-app/app/build/reports/` y `.local/qa/product-form-0.8.1/`.
Resultados Android originales:

- `C:/Users/figod/AppData/Local/Temp/ana-rutas-arrival-mutations-8f0abaaf989048598626c5f182528781/results.json`
- `C:/Users/figod/AppData/Local/Temp/ana-rutas-arrival-mutations-b91cd6c3f9c64619bd56c739ca5805ca/results.json`
- `C:/Users/figod/AppData/Local/Temp/ana-rutas-arrival-mutations-5437af7d7a8d41ad9e5d6c31cbb5109b/results.json`

## APK y puerta física pendiente

`.local/releases/Five-Rutas-Chofer-0.8.1-develop.apk`, versionCode 23,
69,479,442 bytes. SHA256:
`5E5CD2964886925F89A77EE3BB8A2B9107E357CF876A37C1CAF4C26769D80AD7`.
Firma debug verificada por apksigner y coincidente con 0.8.0; no firma de tienda.

La instrumentación no pudo ejecutarse: ADB identifica el dispositivo pero
cierra comandos (`am get-config: closed`, `AdbCommandRejectedException`). No
se afirma que Compose, cámara real, teclado o rotación hayan pasado en teléfono.
No se reinició, desinstaló ni borró datos del dispositivo para forzarlo.

Después de actualizar backend y app, comprobar:

1. Elegir cada faltante por tarjeta; continuar abre su formulario correcto.
2. Desde un producto, completar cantidad, Ventas/Picking, tomar una foto:
   Guardar habilitado sin exigir otras dos. Quitarla vuelve a exigir evidencia.
3. Tomar tres; borrar la segunda mantiene las otras dos; agregar reemplazo;
   no ofrecer cuarta. Guardar conserva tres imágenes visibles sólo al admin.
4. Seleccionar dos comentarios y notas; guardar/exportar mantiene ambos.
5. Rotar/volver de cámara conserva borrador. Teclado no tapa Guardar; scroll
   independiente permite llegar a notas y volver sin perder datos.
6. Cortar red durante envío, cerrar/reabrir app y Verificar envío: una sola
   incidencia, sin pérdida ni duplicación de fotos. Repetir tras respuesta perdida.
7. Registrar varios productos/faltantes del mismo pedido y después confirmar
   atención; informes anteriores permanecen y reposiciones siguen en vivo.

La puerta física requiere ejecución satisfactoria o excepción explícita del
usuario antes de declarar listo un commit/push/despliegue. Publicación no autorizada
en este bloque; el deploy continúa siendo manual del usuario.
