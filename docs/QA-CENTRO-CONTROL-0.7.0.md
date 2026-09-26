# QA — Centro de control y Ruta en vivo 0.7.0

Fecha: 26/09/2026. Base: `1dd7588`, rama develop. Sólo Ana Rutas.
No se modificó main, Five, Odoo ni PostgreSQL desplegado. Sin Deploy automático.

## Alcance e integridad

- Centro de control y Ruta en vivo son entradas independientes del menú.
- Agregar pantalla permite las 12 vistas del catálogo, incluidas todas las
  secciones administrativas; nunca incorpora recursivamente el propio centro.
- Varias copias de una vista conservan instancias y filtros independientes.
  Orden, tipo y filtro de chofer/camioneta se guardan por administrador en PG
  con control de versión. Fechas/filtros internos de otros paneles son locales
  a su instancia. Expandir no remonta el componente; quitar no borra datos.
- Una sola consulta de GPS compartida por los mapas; refresco cada 5 s,
  cancelación/timeout y pausa cuando el documento está oculto. Incidencias
  conserva SSE y recuperación cada 15 s. No recalcula recorridos de Google.
- Coordenadas y estado operativo provienen de tablas autorizadas, no de ETA ni
  del primer pedido de la lista. Consultar una ficha no cambia el destino.
  Destino de guía se actualiza al iniciar/detener/corregir, además del ciclo GPS.
- La línea representa el recorrido publicado, no historial de movimientos.
  Cuando hay repunte se omite la línea antigua. Pines terminales se ocultan;
  pedidos entregados y reprogramados siguen visibles en lista y métricas
  separadas. Reabrir un reprogramado restaura su parada pendiente.
- v24 es aditiva: sesiones de captura, última posición por ejecución y
  preferencias de centro por usuario. No hay cola ni historial de coordenadas.
  Autenticación/dispositivo/publicación se revalidan en cada POST; secuencia y
  sesión impiden retroceso o escrituras de una sesión desplazada.
- Android usa un foreground service location no exportado, iniciado desde el
  mapa visible/verificado, notificación y Detener/Reanudar. No arranque por boot
  ni captura fuera de ruta. Permisos FGS y FGS_LOCATION añadidos; HTTPS y
  allowBackup=false intactos. GPS simulado/no finito/caducado no se publica.

## Evidencia automatizada ejecutada

Comandos del repositorio:

```powershell
npm test
npm run lint
npm run typecheck
npm run build
npm audit --omit=dev
npx vitest run tests/live-tracking.test.ts tests/driver-service-commands.test.ts tests/driver-service-schema.test.ts --coverage --coverage.include=src/core/live-tracking-policy.ts --coverage.include=src/core/live-tracking.ts --coverage.include=src/core/live-routes.ts --coverage.thresholds.lines=95 --coverage.thresholds.branches=90 --coverage.thresholds.functions=100 --coverage.thresholds.statements=95
npx stryker run stryker.live-tracking.config.mjs
npx playwright test tests/e2e/control-center.spec.ts tests/e2e/driver-mobile.spec.ts tests/e2e/panel.spec.ts
```

Desde driver-app con JDK21 y Android SDK configurados:

```powershell
./gradlew.bat :app:testDebugUnitTest :app:createDebugUnitTestCoverageReport :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug --console=plain
./scripts/verify-arrival-mutations.ps1 -TrackingOnly
```

Resultados y límites:

- Regresión servidor: 56 archivos, **595 pruebas verdes**, una omitida de FCM
  real opt-in; no pertenece al transporte GPS añadido. 569.25 s.
- Cobertura dirigida: 16 pruebas PG/unit, **87/87 líneas, 111/111 statements,
  33/33 funciones, 112/114 ramas (98.24%)**. Política y escritura/autorización
  tienen 100% ramas. Las dos ramas restantes seleccionan polilínea publicada
  simple/segmentada; no son rutas de autorización. El repunte que la invalida
  sí está probado. Objetivo por riesgo: 100% política y autorización; >=95%
  líneas y >=90% ramas del bloque. No confundirlo con cobertura global del repo.
- Mutation servidor: 121/121 detectados sobre política de validación, estados
  y preferencias; reporte `reports/mutation/live-tracking.json`. No se afirma
  mutation coverage de SQL ni de componentes de Google.
- Cinco E2E verdes, ejecutados en dos comandos: dos del centro y tres de
  regresión móvil/panel. HTTP real y bases PG aisladas, sin mocks de API.
  Incluyen 401/403/409, CSRF, revocación, aislamiento, concurrencia/versiones,
  dos filtros independientes, persistencia, catálogo completo, fullscreen,
  orden/quitar sin borrar datos, recuperación de cerrado e incidencias.
- Latencia local POST GPS→lectura admin: **389 ms** en el pase final (517 ms
  en el anterior), incluida autenticación
  del admin en la medición. No es latencia celular ni SLO físico certificado.
  Objetivo de visualización con red sana <=15 s: envío 5 s + lectura 5 s + red.
- Regresión incidente cerrado: visible por SSE en 276 ms; recuperación sin
  SSE en 15,017 ms y reconexión del navegador en 34 ms. Medido en fixture local,
  no demuestra por sí mismo la causa del antiguo reporte de la instalación.
- Android: **78 pruebas JVM, cero fallos**, build/app y tests instrumentados
  compilados. Política LiveTrackingPolicyKt: 6/6 líneas, 46/46 ramas, 2/2
  métodos. JaCoCo global: 429/3346 líneas, 581/3215 ramas; no sirve para afirmar
  validación física de foreground, sensores, batería, Navigation SDK o IME.
- Mutation Android: **13/13 detectados por assertions**, ninguno contado por
  error de compilación. Copia temporal aislada:
  `C:/Users/figod/AppData/Local/Temp/ana-rutas-arrival-mutations-c7bef10a9c8a453485c3b2ebca32a93c/results.json`.
- Complejidad ciclomática ESLint: política máximo 7, proyección 11, callback
  transaccional de escritura 25 (incluye guardas y ternarios de preservación
  de GPS). Se mantiene una transacción para no separar validación y escritura;
  sus ramas están cubiertas al 100%. Android política: suma 25 de 2 métodos.
- Lint web sin errores, warning de configuración Stryker corregido; tipos y
  build verdes. Android lint: 0 errores, 33 warnings heredados; no se ocultan.
  Supply chain producción `npm audit --omit=dev`: 0 vulnerabilidades reportadas.
- Seis fallos detectados en el primer pase fueron expectativas v23 obsoletas y
  dependencia de un fixture que reconstruye v20; corregidos a v24 y repetidos
  con datos preservados. No se modificó una base desplegada para arreglarlos.
- Capturas reales de navegador en `.local/qa/control-center/desktop.png` y
  `narrow.png`, revisadas: no overflow horizontal. Consola sin errores React.
  La prueba local deshabilita configuración de Maps y valida su fallback real;
  **no sustituye una prueba de tiles/markers con la clave real de develop**.

## Seguridad y entrega de prueba

API privada no-store, límites de body, SQL parametrizado, origen mismo sitio
para preferencias y permisos existentes por instalación. Cambios de filtros no
exponen tokens, fotografías o coordenadas en preferencias. Sin secretos nuevos
en fuentes. La auditoría sólo registra inicio de sesión de tracking y cambios
de distribución, no genera un evento SSE global por cada muestra GPS.

Artefacto `.local/releases/Five-Rutas-Chofer-0.7.0-develop.apk`:
paquete `com.five.anarutas.driver`, versionName 0.7.0/code19, min26/target36.
Firma debug de pruebas verificada, igual a la APK anterior:
`f92d2160eccdadb8b72ac5573ef07dc09eb8fdd57c10621d33afaeb7dd4c2e35`.
SHA256 `2D728BCBFFC01729A6E28539E24F00537FBE6C1FFEA0C94B7EA05583BDFB05B4`.
Incluye el formulario 0.6.2, cuya validación física IF-T04 sigue pendiente.

No presentar como listo para producción. Publicar sólo develop requiere la
excepción explícita de pruebas físicas pendientes; Deploy lo hace el usuario.
Excepción aprobada el 26/09/2026: el usuario respondió «si haz push y commit a
develop» a la solicitud que enumeró Maps, GPS/segundo plano y teclado físicos
pendientes. Autoriza publicación de prueba, no certificación de esas pruebas
ni Deploy ni cambios a main.
Rollback: la reversión de UI debe conservar el migrador compatible con v24;
el binario anterior rechaza ese marcador como SCHEMA_VERSION_UNSUPPORTED.
Conservar tablas/auditoría; no bajar la versión ni borrar datos. Un cliente nuevo ante API
no disponible deja seguimiento detenido y muestra Reanudar, sin afectar pedidos.

## Procedimiento pendiente en develop / teléfono (sin ADB)

1. Tras Deploy manual y migración automática, abrir Centro de control y agregar
   Ruta en vivo para dos choferes, Incidencias en vivo y otra sección. Cambiar
   filtros, recargar, expandir/cerrar con Escape, mover y quitar. Comprobar
   instancia/zoom/foco y que otra cuenta conserve su propia distribución.
2. Instalar APK 0.7.0 sobre anterior sin borrar datos, abrir ruta iniciada propia
   y permitir ubicación precisa. Confirmar notificación, punto real, edad y
   precisión en el panel; nunca confundir "sin GPS" con vehículo detenido.
3. Consultar parada 2 sin Ir: destino del panel no cambia. Pulsar Ir: destino 2;
   Llegué: atendiendo; entregar/reprogramar: ocultar sólo pin y ajustar conteos;
   reintentar: reaparece. Repunte: nueva dirección/pin y sin línea vieja.
4. Minimizar app/bloquear pantalla durante varios minutos, luego circular de
   forma segura (operador acompañante). Registrar Android/modelo/batería,
   cadencia y desfase real. Cortar red: panel conserva última posición envejecida.
   Restablecer: no reproduce backlog. Apagar GPS: jamás rejuvenece última lectura.
5. Detener desde notificación: panel muestra detenido. Reanudar desde mapa:
   nueva sesión sin aceptar mensajes viejos. Logout/revocación/cancelación de
   ruta: servicio no continúa autorizado; publicar otra ruta no hereda su GPS.
6. Verificar Maps real de develop: tiles, pines/contornos, naranja en cerrado,
   zoom estable, seguir chofer, click de chofer y parada, controles/fullscreen,
   ruta sin puntos pendientes. No hacer un cálculo pagado para refrescar GPS.
7. Repetir QA físico del formulario 0.6.2 (teclado, cámara, rotación, notas,
   rechazo Otro y cerrado con foto) usando datos de prueba. Conservar folio y
   hora si falta un caso. Liquidación/cierre financiero siguen fuera del bloque.

Registrar resultado por paso. Hasta concluir estos puntos, CC-T06 e IF-T04
permanecen abiertos; no hay afirmación de cero defectos físicos.
