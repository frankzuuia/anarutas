# IR — evidencia y procedimiento de QA

Autorización: «dal3», bloque documentado en
BLOQUE-INCIDENCIAS-RESUELTAS-2026-10-09.md. Sólo develop sobre c26736a.
Aceptación: tests/acceptance-incident-resolution.feature.
No se accedió a producción, EasyPanel ni Odoo. No se desplegó.

## Pruebas reales y resultados

- 7 pruebas dirigidas de board/alarma/realtime con PostgreSQL temporal real,
  sesiones de chofer, fotos JPEG procesadas y dos administradores.
  52 capturas reales/resoluciones, paginación 50+2 sin duplicados, filtros y
  cursores aislados; permisos 401/403; evidencia privada; Visto compartido.
  Una ruta cancelada conserva el estado resuelto pero retirar su reporte lo
  oculta, sin alterar sus órdenes. Comentarios corregidos y explicación de
  resolución permanecen separados.
- 51 pruebas de regresión de clasificación, fotos, finanzas y cola de
  devoluciones. No se ejerció escritura a una API externa ni integración falsa.
  La cola real en PostgreSQL y la inmutabilidad del recibo se comprobaron.
- Navegador Chrome en perfil temporal propio: captura multipart real,
  clasificación, Excel privado de nueve columnas, resolver y Resueltas,
  Visto y tres fotografías. Cuadro con márgenes comprobados en 1500x800 y
  390x844; fotos y notas disponibles, sin desbordamiento. Se inspeccionaron
  resolution-desktop.png, resolution-mobile.png y resolved-desktop.png bajo
  .local/qa/product-incidents.
  Cuatro E2E finales verdes: dos de producto/tarjetas y dos de alarma/rol.
- Regresión Web Audio nativa: otra sección 237 ms, pestaña oculta 202 ms,
  minimizado 205 ms; alarma 4,996 ms, reconexión oculta 33 ms. Llegada tardía
  visible/sin Visto no añadió fuentes de audio. Rol liquidación no monta
  monitor. Son medidas locales de muestra, no garantía de red o altavoces.
- Android: 172 pruebas JVM de 37 suites, cero fallos/errores; testDebugUnitTest,
  cobertura, assembleDebug, assembleDebugAndroidTest y lintDebug verdes.
  Lint Android: cero errores y 36 advertencias heredadas de API/herramientas.
  El caso Compose nuevo compila y valida orden visual/cantidad exacta,
  habilitación y tipos al ejecutarse en dispositivo; no se declara ejecutado.

## Métricas y revisión

- Board/realtime: 100% líneas/funciones/sentencias, 98.75% ramas (79/80).
  La rama restante es metadato opcional histórico, no navegación nueva.
  Fuente resuelta: 2/2 sentencias; SQL ejecutado contra esquema real.
- IncidentReceiptPolicy: 11/11 líneas, 35/35 ramas e instrucciones 136/136.
  Navegación nueva: 7/7 líneas, 23/23 ramas; complejidad ciclomática 13,
  asociada a las condiciones explícitas de comprobante/estado/identidad.
- Mutaciones Android: 9/9 detectadas en copia aislada, baseline 6/6.
  Servidor: 9/9 detectadas en la repetición final, baseline 2/2; total 18/18.
  La primera corrida detectó 8/9 y reveló ausencia de la regresión del retiro
  de reporte de ruta cancelada. Se agregó ese recorrido usando cancelación y
  retiro reales, conservando órdenes y resolución.
- Consulta resuelta: 15 muestras sobre 51 registros; p50 14.23 ms,
  p95 17.73 ms. Objetivo QA local p95 menor de 1 s para ese volumen;
  no es un SLO de producción ni prueba de carga.
- Build web, tipos y lint sin errores; una advertencia heredada de
  stryker.product-amendments.config.mjs. Auditoría de dependencias productivas:
  cero vulnerabilidades; no se modificaron dependencias.
- Revisión de conexiones: cola/captura/reintentos, fotos, cantidades,
  referencias financieras, pagos y conector Odoo conservan sus contratos.
  Sólo los recibos nuevos del pedido/parada actuales cierran el formulario;
  un error, pendiente, revisión vieja, recibo inválido o incidente ajeno no
  anuncia éxito. Abrir otra partida mientras hay envío pendiente ya está
  deshabilitado por StopAttentionSheet.

## Reproducción

Desde la raíz, con Node del entorno y PostgreSQL disponible para fixtures:

```powershell
npx vitest run --config vitest.incident-board.config.ts --coverage
npx vitest run tests/odoo-return-store.test.ts tests/odoo-return-policy.test.ts tests/driver-financial-policy.test.ts tests/driver-financial-integration.test.ts tests/product-incident-organization.test.ts tests/product-incident-photos.test.ts
npm run build
npx playwright test tests/e2e/product-incidents.spec.ts --grep 'mobile report|TA compact'
npx playwright test tests/e2e/incident-background.spec.ts
node scripts/verify-incident-resolution-mutations.mjs server
node scripts/verify-incident-resolution-mutations.mjs android
npm run typecheck
npm run lint
npm audit --omit=dev
```

Android usa JAVA_HOME de JDK21 y ANDROID_HOME del SDK instalado, con la URL
develop de gradle.properties, sin copiar navigation.local.properties a
mutaciones. Desde driver-app:

```powershell
.\gradlew.bat testDebugUnitTest createDebugUnitTestCoverageReport assembleDebug assembleDebugAndroidTest lintDebug --console=plain
```

Evidencia local: .local/incident-resolution-*.log/json,
reports/coverage/incident-board, reports/mutation/incident-resolution-*.json,
driver-app/app/build/test-results/testDebugUnitTest y reports/coverage/test/debug.
Las corridas fallidas intermedias no se presentan como evidencia verde:
se corrigieron entradas/ciclo de llegada en fixtures, restricciones reales de
foto, un nombre duplicado en E2E y la espera del checkbox controlado por servidor.

## APK y comprobación física

Artefacto .local/releases/ana-rutas-driver-0.8.24-incidencias-resueltas.apk,
applicationId com.five.anarutas.driver, versión 0.8.24 / code46, minSdk26,
backend develop confirmado en BuildConfig.
SHA256: 50f9dc673ee04f244b3ff5573646b5846238872d28fa1b39746b6b8349935afc.
apksigner verifica firma; certificado SHA256
f92d2160eccdadb8b72ac5573ef07dc09eb8fdd57c10621d33afaeb7dd4c2e35,
igual al artefacto anterior de pruebas. No es una firma de distribución pública.

ADB sólo muestra emulator-5554 offline y el SDK no tiene emulador operativo.
La cámara, IME y regreso visual en teléfono siguen pendientes, como en el
bloque Android anterior; no se certifica producción. El propietario despliega
el panel/backend de develop e instala la actualización APK sin borrar datos:

1. Abrir pedido con llegada verificada. En las dos reposiciones, el botón de
   cantidad completa debe aparecer antes del pago y copiar el saldo exacto.
   Repetir tras una devolución previa para comprobar disponible restante.
2. Guardar cada tipo de incidencia válido: volver automáticamente a la ficha
   del mismo pedido y ver el reporte en su producto. Editar y guardar: volver.
3. Cortar conexión durante envío y rotar: no cerrar ni perder captura;
   verificar envío y comprobar mismo ID, cantidad y evidencia, sin duplicación.
4. Reabrir formulario después del guardado: el recibo anterior no lo cierra.
5. Resolver reposición en panel: marco completo, sección verde y explicación;
   Visto refleja el administrador para otra sesión. Excel conserva su formato.
6. Confirmar que las devoluciones mantienen su proceso Odoo existente y que
   reposiciones no crean devoluciones Odoo.
