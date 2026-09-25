# QA — mapa, llegada, repunte e incidencias / BL-105..108

25/09/2026. Desarrollo local sobre `develop`, base `75b082a`. El usuario autorizó
commit y push exclusivamente a `develop` para probar la APK, con excepción
explícita para la validación física de GPS/navegación pendiente. Deploy manual
a cargo del usuario; sin cambios de facturación, ADB ni acceso a producción.
Esta evidencia no certifica Google Navigation ni GPS físico.

## Revisión 0.5.1 — ficha, voz, estabilidad GPS y dirección

Autopsia del defecto textual: el repunte anterior sólo actualizaba coordenadas y `location_version`; dejaba `route_customers.delivery_address` y la dirección de la parada operativa con su valor anterior. El tablero lee el domicilio del cliente, por lo que mostraba correctamente —pero de forma indeseada— ese texto viejo. Las coordenadas por sí solas no identifican con certeza una dirección postal. Confirmar el pin abre un modal obligatorio de calle y número, colonia, código postal y ciudad; cerrarlo no persiste nada. El servidor valida las cuatro partes y la confirmación final guarda punto y domicilio en una transacción. El modal conserva los campos ante error o red ambigua y sólo se cierra tras releer la confirmación del servidor.

La ficha plegable deja libre casi todo el mapa y conserva destino/guía. Tocar un marcador abre únicamente la ficha de esa parada. El interruptor de voz usa `AudioGuidanceSettings` oficial y conserva preferencia. El GPS ya no mantiene una muestra degradada como si fuera actual; conserva como máximo 3 s una muestra válida de **la misma parada** ante jitter, sin superar las validaciones del servidor. No reutiliza un GPS simulado ni uno de otro destino; arrastrar el pin desactiva la confirmación hasta soltarlo.

Evidencia local de esta revisión: 543 pruebas servidor pasaron (1 contrato FCM externo omitido), 49 archivos, 95.14 % líneas y 88.14 % ramas globales; `driver-stop-command.ts` 100 % líneas y 98.43 % ramas. `npm run build` y `npm run lint` verdes. Tres E2E HTTP/navegador pasaron: el domicilio nuevo aparece en cliente, incidencia, ejecución y pedido móvil; repunte→incidencia SSE se observó en 267 ms en la última corrida. Android: 45 pruebas JVM, APK 0.5.1/code12 e APK instrumentada compiladas, lint 0 errores/32 avisos; política de GPS 26/26 líneas y 84/84 ramas. Mutación Android 27/27 detectadas, incluyendo cinco alteraciones del contrato de domicilio; validador servidor 39/40, con un mutante equivalente; comando transaccional 117/119 (98.32 %), cero timeouts, cero sin cobertura y dos equivalentes de salida explicados abajo. El APK final SHA-256 `239925837c8997791653fd4aca4983bfcd771b59db6a1e720ee14aa0a578cc3a` conserva la firma debug de la versión anterior y verifica esquema v2. No se considera evidencia la APK instalada previamente.

Los dos supervivientes actuales del comando: eliminar `closing === null` haría una consulta PostgreSQL adicional con parámetro nulo y seguiría produciendo `lateSeconds=null` (no una incidencia); eliminar `lateSeconds !== null` conserva la clasificación porque `null > 0` es falso en JavaScript. Se conservan las guardas por claridad y para evitar trabajo SQL innecesario. La mutación cubre guardas/idempotencia/clasificación, no todos los literales SQL; rollback, aislamiento y dirección fueron verificados además con PostgreSQL real.

QA reproducible: `npm run test:coverage`, `npm run build`, `npm run lint`, `npx playwright test tests/e2e/driver-mobile.spec.ts tests/e2e/panel.spec.ts`; en `driver-app`, `./gradlew.bat testDebugUnitTest assembleDebug assembleDebugAndroidTest lintDebug createDebugUnitTestCoverageReport` con Android SDK y configuración local de develop. La comprobación física pendiente en el teléfono del usuario debe cubrir arrastrar/plegar panel, toque de marcadores colocalizados, voz tras cerrar/reabrir, GPS oscilante y modal de cuatro campos; cerrar el modal no debe cambiar el punto ni el domicilio. Probar además pérdida de red al confirmar: los campos deben seguir visibles y el mismo comando pendiente debe poder verificarse. Confirmar en panel Clientes y horarios e Incidencias y comprobar que otra camioneta no cambió. Sin ADB ni navegación vial simulada.

## Resultado funcional base (0.5.0; histórico)

- Migración aditiva 19→20: ejecuciones por revisión publicada, paradas estables,
  política versionada, actor chofer y eventos/recibos inmutables. Backfill de
  publicaciones iniciadas probado reconstruyendo el esquema anterior real.
- Inicio abre pantalla operativa; mapa nativo, todas las paradas, GPS sin ajuste
  a carretera, ficha de productos, editor de pin y una guía explícita al destino.
- Radio inicial 100 m, precisión 50 m y edad 30 s; editables por administrador.
  API repite todas las validaciones: distancia + precisión <= radio. La muestra
  Android simulada se rechaza; esto no es atestación antifraude de una APK alterada.
- Llegada persistida e idempotente. Hora real del servidor; nunca entrega completa.
  Retraso sólo después del último cierre publicado; sin ventanas no se inventa.
- Repunte atómico de ejecución propia + cliente + historial + incidencia. Otro
  chofer/admin encuentra conflicto de versión. Snapshots ajenos permanecen igual.
- Incidencias reales filtradas en SQL por fecha del evento y chofer, con cursor
  estable a microsegundos, conductores inactivos con histórico y refresco SSE.
- Confirmación de red ambigua cifrada por plan y dispositivo; reintento con la
  misma clave. Guía corregida sólo tras releer el punto confirmado. Retiro/revocación
  vacía datos y finaliza navegación; escucha visible con cierre por cancelación.
- El repunte no encola recálculos de flota. Se encontró el trigger anterior que
  reaccionaba a toda versión de cliente; ahora excluye cambios con autor chofer.
  Una prueba instala un trigger real que falla si se intenta ese recálculo.
- Aviso de seguridad versionado y menú local de licencias. Extracción automática
  del AAR instalado, sin texto copiado manualmente; el build falla si no encuentra
  licencia. Confirmación explícita persistida, sin sustituir términos Google.

## Evidencia ejecutada del bloque inicial (0.5.0)

| Puerta | Resultado local |
| --- | --- |
| Suite servidor con PostgreSQL real | 540 pasaron, 1 omitida de 541; 49 archivos; 239.04 s |
| Prueba omitida | Contrato FCM externo opt-in, no requerido para estos endpoints; no se activó ni se enviaron pushes de prueba |
| Cobertura global core | 95.11 % líneas; 88.05 % ramas; 96.92 % funciones; 93.69 % sentencias |
| Política nueva servidor | 100 % líneas, ramas y funciones |
| Comando llegada/repunte | 100 % líneas/funciones; 98.21 % ramas; el reloj real adicional está ejercitado por HTTP, fuera de Vitest |
| Incidencias | 100 % líneas/funciones; 96.15 % ramas |
| Lectura/seed/settings | 100 % líneas; ramas 83.33 / 75 / 85.71 %; estados de instalación incompleta fallan cerrados |
| Mutación política servidor | 142/144 detectadas, 98.61 %, cero sin cobertura |
| Mutación comando transaccional | 95/96 detectadas, 98.96 %, cero timeouts/errores/sin cobertura; 13m50s |
| Mutación políticas Android | 18/18 detectadas con pruebas JVM reales: 11 GPS, 4 respuestas de guía y 3 aviso/licencia; sin alterar checkout |
| Cobertura política Android | GPS 20/20 líneas y 60/60 ramas; guía 4/4 líneas y 8/8 ramas; aviso/licencia 3/3 líneas y 2/2 ramas; separadas de UI/SDK |
| JVM Android, mapa y limpieza | 43 pruebas, cero fallos; debug 0.5.0/code11, APK instrumentada y lint compilados con clave Android real; último build 1m30s |
| Cobertura Android global | 266/2480 líneas (10.73 %), 336/1964 ramas (17.11 %); UI, red, Keystore y SDK requieren dispositivo, no se ocultan en el promedio |
| Lint Android | 0 errores, 31 avisos: dependencias/SDK y recomendaciones KTX/icono/backup; el nuevo aviso KTX corresponde al commit cuyo booleano de persistencia se comprueba explícitamente |
| Licencia AAR→APK | 2,760,092 bytes iguales, SHA-256 `b19ac89fe4c91bffdb85ead483b5910694df7db6f9382612618ff4b01d0f5ffa`; comparación de streams reales |
| Inyección de configuración Android | 7/7 casos Gradle reales; ausencia, archivo, prioridad explícita/vacía, caracteres inválidos, origen distinto y propiedad ausente |
| Mutación configuración Android | 5/5 detectadas en copia aislada protegida; origen, lectura local, prioridad, caracteres y propiedad obligatoria |
| HTTP/navegador móvil | 2/2; auth, CSRF, aislamiento, inicio, repunte, llegada concurrente, filtros, retiro y nueva ejecución |
| Panel general | 1/1; suite combinada 3/3 en 55.2 s, autenticación/sesión/revocación y panel responsive |
| TypeScript/build | Compilación Next y tipos correctos; lint sin errores ni avisos |
| Supply chain Node runtime | `npm audit --omit=dev`: 0 vulnerabilidades informadas; no es auditoría exhaustiva de Android/transitivas |

Objetivo por riesgo: >=95 % líneas y >=90 % ramas de políticas puras,
mutación >=90 % y ningún superviviente crítico sin explicación. Los dos
supervivientes del servidor son equivalentes bajo sus invariantes: eliminar
`typeof number` no evita `Number.isFinite` (no coacciona tipos); retirar `?.` al
último pedido no cambia nada porque un grupo existente siempre tiene pedidos.
El superviviente del comando transaccional elimina `lateSeconds !== null`:
la comparación `null > 0` también es falsa; puntual/sin ventana/tarde están
probados. Es equivalente, no un bypass. El alcance de esa mutación es explícito
en la configuración: guardas, idempotencia y clasificación, no cada literal SQL.
No se excluyeron equivalentes del denominador. En Android se alteraron mock,
edad, precisión, radio, destino, proyección de latitud y reloj monotónico;
también retiro, destrucción, generación y punto de una respuesta de guía;
versión antigua/actual de aceptación y truncamiento de licencia.

Complejidad medida por ESLint: proximidad 6; agrupación 10; corrección de cliente 8;
transacción completa 19; filtros 12. JaCoCo bytecode Android: proximidad 31 por
comparaciones de rango/flotantes, distancia 1, reloj 1; no equivale a la métrica
de AST TypeScript. Decisiones de seguridad cubiertas, no se ocultan ni se
fragmentan artificialmente para mejorar una cifra.

## Latencia y costes

30 repuntes y 30 consultas sobre PostgreSQL aislado, sin red móvil: repunte p50
12.42 ms, p95 20.13 ms, máximo 35.01 ms; consulta p50 1.99 ms, p95 2.79 ms,
máximo 7.51 ms. 0 errores, 30 eventos. Es un microbenchmark local, no SLO productivo.
En la última prueba HTTP móvil: publicación→SSE 157 ms, inicio→panel 198 ms,
repunte→incidencias 236 ms, cancelación→panel/API móvil 130 ms (objetivo local <2 s).

GPS/tick, lectura, llegada y persistencia del repunte no invocan Google/Odoo.
`setDestination` sólo se invoca al pedir guía o corregir el destino guiado; pin
arrastrado no genera llamada. El SDK puede adaptar calles; no reordena pedidos.
No se certifican latencia vial, cargos Google, batería ni fluidez sin SDK físico.

## Escenarios, seguridad y regresión

`tests/acceptance-driver-execution.feature` especifica ML01..24. No se presenta
Gherkin como ejecutado automáticamente: la evidencia automatizada está en las
pruebas Vitest/PostgreSQL/HTTP; los casos de teléfono se verifican manualmente.

- `driver-execution-policy.test.ts`: tipos/rangos/GPS/radio/ventanas/agrupación.
- `driver-execution.test.ts`: backfill 19, repetición, rollback inducido en PG,
  idempotencia concurrente, GPS rechazado, actor correcto, sincronización de
  cliente preservada, histórico, versiones/política, ventanas y fecha local,
  carrera entre choferes, cancelar/revocar y paginación sin pérdida.
- `driver-execution-concurrency.test.ts`: corrección independiente de cada eje
  cuando maestro y ejecución difieren; antes/después de ambas ubicaciones;
  barrera PostgreSQL real verifica locks de autorización/publicación/ejecución/
  política/idempotencia hasta commit. No sustituye la base ni usa stubs.
- `driver-mobile.spec.ts`: handlers reales con navegador; datos sólo propios,
  token móvil no da acceso admin, CSRF, fotos diarias y eliminación, SSE de
  llegada/repunte, filtros conservados, sesión recargada, retiro y republicación.
- Backend E2E persiste una fixture de cálculo para preparar el estado publicado.
  No intercepta HTTP, no finge respuestas Google y no prueba conducción real.
- `DriverArrivalPolicyTest`: física/geofence/reloj puros sin Android simulado.
- `CancellationCleanupTest`: espera bloqueante real liberada al cancelar; cierre
  exactamente una vez ante retorno normal y excepción.
- `GuidanceResultPolicyTest`: respuesta tardía para otro punto, petición anterior,
  publicación retirada o pantalla destruida nunca inicia guía obsoleta. La
  identidad de destino incluye ejecución, parada y ambas coordenadas.
- `NavigationNoticePolicyTest`: confirmación versionada y reconstrucción íntegra
  del texto virtualizado, incluidas líneas vacías y límites de cada bloque.
  La lectura real del AAR y APK verificó la licencia completa; términos Google,
  fallo de almacenamiento local y presentación requieren el QA de dispositivo.

Infraestructura de QA Windows: una repetición bajo carga obtuvo 539 pruebas
correctas y un fallo de limpieza (más un afterAll): `embedded-postgres.stop()`
con `persistent:false` borraba la carpeta sin reintentos al salir el proceso padre,
mientras Windows aún retenía handles de hijos. La autopsia se hizo sobre el código
instalado de la librería. El helper ahora posee exclusivamente la eliminación
con `rm` acotado al directorio generado y diez reintentos ya existentes; PostgreSQL
se detiene primero y no hay doble propietario de la limpieza. Regresión de
lifecycle y transacciones pasó 3/3 tras el cambio; repetición completa posterior
pasó 540/541 (única omitida FCM opt-in), sin errores de limpieza.
No se alteró PostgreSQL de ejecución ni se borraron bases ajenas.

No se guardan tokens ni GPS en logs generales. Los eventos autorizados sí
contienen evidencia mínima de la muestra. La consulta administrativa omite
muestra cruda y política histórica; incluye antes/después, persona, pedidos,
fecha local y servicio. Historial no se borra al cancelar o borrar un borrador.
No se cambió retención de fotos ni se almacenan trayectorias GPS continuas.

## Reproducir

Raíz del repositorio, Node 24, PostgreSQL embebido real; sin credenciales externas:

```powershell
npm run test:coverage
npx stryker run stryker.driver-arrival.config.mjs
npx stryker run stryker.driver-stop-command.config.mjs
npx tsx scripts/qa-driver-execution-metrics.ts
npm run typecheck
npm run lint
npm run build
npx playwright test tests/e2e/driver-mobile.spec.ts tests/e2e/panel.spec.ts
npm audit --omit=dev
```

En `driver-app`, JDK y SDK locales configurados, sin ADB:

```powershell
.\gradlew.bat testDebugUnitTest createDebugUnitTestCoverageReport assembleDebug assembleDebugAndroidTest lintDebug
.\scripts\verify-arrival-mutations.ps1
.\scripts\verify-navigation-config.ps1
```

Informes ignorados por Git: `coverage/coverage-summary.json`,
`reports/mutation/driver-arrival.json`, `reports/mutation/driver-stop-command.json`,
`reports/driver-execution/latency.json`, `reports/screenshots/driver-incidents-live.png`,
`driver-app/app/build/reports/coverage/test/debug/report.xml`, JUnit y lint.
Mutaciones Android: directorio temporal
`ana-rutas-arrival-mutations-1e559a5a876649e69ee9d7467ef2af03`, con baseline/logs/resultados.
Configuración Gradle: `ana-rutas-navigation-config-d6f7e661dd42456e931a56177107a2ae`,
con siete casos y cinco mutaciones. Directorio privado: incluye el artefacto
de configuración real; sólo compartir `results.json`, nunca los archivos de clave.

Artefacto local (instalar sólo después de desplegar el backend de este bloque):
`driver-app/app/build/outputs/apk/debug/app-debug.apk`, copia en
`.local/releases/Five-Rutas-Chofer-0.5.0-develop.apk`, 0.5.0/code11,
SHA-256 `590a437890c6f37482e71c38e8ac5265b8907a4e1fa602270355832181ba85dc`.
Certificado debug SHA-256 `f92d2160eccdadb8b72ac5573ef07dc09eb8fdd57c10621d33afaeb7dd4c2e35`,
igual al artefacto 0.4.0 anterior. BuildConfig contiene la clave real configurada
y el origen correcto; comparación sin imprimir valores. Cero coincidencias de
esa clave en archivos versionados o nuevos no ignorados. No hay prueba física.

## Google Android configurado con autorización del usuario

24/09/2026, sesión real verificada como `figodidi@gmail.com`. Proyecto de Maps
`ana-rutas-develop` (287305573191), activo y con billing ya habilitado. El proyecto
FCM `ana-rutas-five-dev-2026` es independiente y permanece sin modificaciones.

Navigation SDK (`navigationsdk.googleapis.com`) y Maps SDK for Android
(`maps-android-backend.googleapis.com`) pasaron de DISABLED a ENABLED. Clave creada:
`projects/287305573191/locations/global/keys/ana-rutas-develop-android-navigation`.
Restricciones releídas de Google: sólo esos dos servicios y el paquete
`com.five.anarutas.driver`, SHA-1 `5d5f68abdda548bf6df535edcac9f52cbb48558e`.
Las dos claves previas conservaron nombre y restricciones. No se cambiaron
IAM, billing, cuotas, FCM, configuración del servidor ni producción. No se
ejecutó ninguna solicitud de navegación facturable para validar la credencial.

`driver-app/navigation.local.properties` generado sin imprimir la clave; ACL
sin herencia, acceso del usuario, SYSTEM y Administradores; ignorado por Git.
Carga automática sólo para su origen HTTPS. Una propiedad explícita Gradle tiene
prioridad. Si hay que sustituir una firma o entorno, configurar otra credencial
apropiada; no ampliar silenciosamente ésta. La clave es extraíble de una APK:
las restricciones de Google, no el ocultamiento del texto, protegen su uso.

## Puertas externas y prueba manual

No instalar esta versión en un backend anterior al esquema20.
Gates locales cerrados y commit/push a develop autorizados para esta prueba.
El usuario hace Deploy del nuevo backend antes de instalar la APK sobre la firma
instalada, sin desinstalar. La excepción aprobada no habilita main ni producción.

1. Configuración de clave/servicios/facturación existente verificada. No copiar
   una clave de servidor ni la credencial FCM a Android. Falta la comprobación
   nativa de autorización/atribuciones/términos en el teléfono del usuario.
2. Usuario instala la APK final de develop. Confirmar inicio de hoy con cinco
   fotos, apertura única y mapa real, todos los puntos y logo Five.
3. Probar sin permiso, permiso aproximado, GPS apagado, señal precisa, muestra
   vieja y límites del radio. Manipular teléfono sólo detenido y en lugar seguro.
4. «Mal punteado»: arrastrar/cancelar y usar GPS/confirmar. Ver nueva coordenada,
   una sola incidencia, cliente persistente y otra camioneta sin cambios.
5. Llegué habilitado sólo cerca del nuevo punto. Dos toques/reconexión no duplican;
   ficha muestra productos, no entrega completada. Comprobar hora real/ventanas.
6. Repetir con panel abierto filtrado por fecha y chofer; incidencia entra sola.
7. Cancelar desde panel durante mapa/edición/guía. Ya no se permite guardar ni
   revelar ruta retirada; republicar crea nueva ejecución sin llegadas previas.
8. Rotación, Atrás, reapertura, pantalla pequeña/fuente grande y fallo de red.
   Confirmación pendiente sólo afecta su ruta. GPS/listener dejan de observar
   al abandonar pantalla; guía activa conservada sólo por diseño del SDK.
9. Abrir Avisos y licencias sin conexión y revisar texto completo; Ahora no
   impide guía, Entendido se conserva al reabrir/rotar, un error de almacenamiento
   no se presenta como aceptado. Validar términos/atribución nativos Google,
   notificación/retiro y consumo real del SDK.

Hasta completar estas puertas no declarar producción lista, navegación probada,
QA visual de Android aprobado ni costes medidos. La configuración externa ya
verificada no sustituye la evidencia de dispositivo, que sigue pendiente.
