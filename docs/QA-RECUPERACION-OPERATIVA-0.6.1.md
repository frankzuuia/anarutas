# QA — recuperación operativa · 0.6.1 / BL-120..123

26/09/2026, Ana Rutas, sólo develop. Sin deploy, ADB, cambios en Five,
main, producción, Odoo ni liquidación. Usuario autorizó commit y push de
pruebas. No se presenta el QA local como certificación del teléfono real.

## Autopsia y conexiones

El reporte real de cliente cerrado sucedió antes de reprogramar. No hay
acceso de lectura al PostgreSQL desplegado; no se atribuye ese caso al filtro
de reintento. Ese filtro permanece: oculta durante una nueva llegada, no
durante el primer reporte. Se comprobó un hueco independiente en el panel:
heartbeats sin change no vuelven a leer una instantánea fallida/obsoleta.
Ahora SSE conserva la vía inmediata y una lectura visible cada 15 segundos
repara señales perdidas, sin consultas simultáneas. Foco/online/visibilidad
recuperan; cambio de filtro/desmontaje cancela la lectura anterior. Timeout
15 s y errores visibles, nunca se afirma que datos antiguos sean nuevos.
Una foto con error transitorio se reintenta automáticamente, no se confunde
con vencimiento. Retención y descarga privada no cambiaron.

APK exige recibo privado persistido y UUID de la incidencia, además de la
respuesta de envío. Sólo entonces descarta foto/outbox y muestra folio.
Respuesta perdida mantiene el comando cifrado y recupera el mismo recibo,
sin volver a subir la evidencia si ya está confirmada.

GPS anteriormente sólo caducaba lecturas del listener. Nuevo watchdog pide
ubicación actual GPS/red, mantiene edad monotónica/precisión/mock reales,
timeout 20 s, backoff 1–10 s derivado de la política. Cancela al detener,
desactivar proveedor, perder permiso o recibir una muestra válida. No
amplía 100 m ni convierte un cached fix caducado en reciente. El SDK de
navegación y la comprobación de llegada siguen siendo canales distintos.

Reapertura por pedido propia, autenticada/versionada/idempotente y atómica:
rescheduled → open, visita antigua invalidada, nueva llegada requerida;
resto de pedidos intacto. Admin Resolver no reabre. Migración automática v23
amplía vocabularios de eventos, conserva historia/identidad/constraints y
triggers de inmutabilidad. Fotos ya revocadas no se resucitan.
Naranja tiene prioridad sobre selección. Mapa/radio/destino SDK sólo para
paradas no terminales; lista completa sigue accesible y permite reapertura.

## Procedimiento reproducible

1. `npm run typecheck`; `npm run lint`; `npm run build`;
   `npm run bundle:migration`; `npm audit --omit=dev --audit-level=high`.
2. `npm run test:coverage`: PostgreSQL/archivos reales, fixtures explícitas;
   ningún Google/Odoo/FCM sustituido ni afirmación de que se probaron.
3. `npx stryker run stryker.driver-retry.config.mjs` y
   `npm run test:mutation:driver-service-policy`.
4. `npx playwright test tests/e2e/driver-mobile.spec.ts tests/e2e/panel.spec.ts`.
   Next/PG/HTTP/Chromium reales. Se corta SSE y una carga de imagen real,
   sin inyectar respuestas ni datos simulados. Raster JPEG declarado QA.
5. En driver-app, JDK 21/SDK local:
   `gradlew.bat :app:testDebugUnitTest :app:createDebugUnitTestCoverageReport
   :app:assembleDebug :app:lintDebug --console=plain`.
6. `scripts/verify-arrival-mutations.ps1 -RecoveryOnly`: copia aislada en
   TEMP, nunca muta checkout activo. Debe existir XML con fallos de pruebas
   para contar un mutante muerto; fallo de compilación no cuenta.
7. Inspeccionar capturas desktop/390 px, metadatos/firma/hash APK y diff
   completo; publicar sólo tras puertas verdes.

## Evidencia y métricas

| Puerta | Resultado / evidencia |
| --- | --- |
| Tipos / lint / build / bundle | Verdes; endpoint retry compilado y migración automática v23 incluida. |
| HTTP/Next/PG/SSE/Chromium | 3/3 aprobadas, 1,9 min. Caso con fotografía recuperado sin SSE en 15 084 ms; una carga de imagen abortada se recupera automáticamente. Reapertura, replay, llegada nueva, entrega y permisos reales. Reconexión 94 ms. |
| Android JVM / lint / build | 72 pruebas, cero fallos/errores; lint 0 errores, 34 advertencias preexistentes; APK 0.6.1/code17 compilada. |
| JaCoCo dirigido | GPS: 10/10 líneas, 26/26 ramas; recibo: 4/4 líneas, 12/12 ramas; servicio/mapa: 16/16 líneas, 38/38 ramas; paleta: 6/6 líneas, 8/8 ramas. 100 % dirigido, no cobertura de SDK/cámara reales. |
| JaCoCo app completa | 383/3158 líneas (12,13 %); 529/2983 ramas (17,73 %). No confundir políticas JVM con Compose/API/SDK instrumentados en teléfono. |
| Mutación Android aislada | 21/21 muertos mediante fallos de pruebas reales; evidencia TEMP `ana-rutas-arrival-mutations-988b78103e8345f081e15c5fdb28b4c5/results.json`. |
| Mutación política servidor | 109/109 muertos, cero supervivientes/timeouts/errores. |
| Regresión global / V8 | **55/55 archivos, 586 aprobadas, 1 omisión preexistente FCM live**, 503,00 s. Sentencias 94,01 %, ramas 88,80 %, funciones 96,62 %, líneas **95,47 %**. Ninguna falla. |
| V8 crítico dirigido | Reapertura: 32/32 líneas, 21/21 ramas, 2/2 funciones; política de servicio: 21/21 líneas, 39/39 ramas, 4/4 funciones; recibos: 12/12 líneas, 6/6 ramas. **100 %**, no sólo promedio global. |
| Mutación reapertura / seguridad | 44/44 muertos, 0 supervivientes/timeouts/errores. Política servidor + reapertura + Android: **174/174** dirigidos. |
| Supply chain runtime | `npm audit --omit=dev --audit-level=high`: 0 vulnerabilidades; ninguna dependencia añadida. |
| Firma / artefacto | Firma verificada, certificado SHA-256 `f92d2160eccdadb8b72ac5573ef07dc09eb8fdd57c10621d33afaeb7dd4c2e35`, mismo que 0.6.0. APK 69 255 015 bytes, SHA-256 `D2CE8D4A9F7B5B599C644CE91F8E3E15DBE3198639B994428E487B2AEDC9536F`. |

Artefacto local: `.local/releases/Five-Rutas-Chofer-0.6.1-develop.apk`.
Diff revisado y `git diff --check` verde. Puertas automáticas completas:
GREEN LIGHT para commit/push de pruebas a develop; INTEGRITY TOTAL de
contratos locales BL-120..123 y MATCH PERFECT RG01..10 salvo QA físico
explicitado. No se ha hecho Deploy ni se afirma reproducción/corrección
demostrada del incidente real sin lectura del entorno desplegado. La omisión
FCM requiere credenciales de envío real y no pertenece a estos cambios.

Incidencias de QA corregidas antes de publicar: prueba intentó actualizar
directamente una publicación iniciada; el trigger la rechazó correctamente.
Se usa cancelación administrativa real, sin debilitar el trigger. Un mutante
Android no compilable no se contó muerto; se reemplazó por equivalente
compilable y 21/21 quedaron verdes. Dos selectores E2E demasiado amplios/no
relativos se corrigieron; el fallo inicial provocó una dependencia preexistente
de fixture en el siguiente caso, resuelta al pasar la corrida completa. Tres
mutantes supervivientes detectaron comprobaciones incompletas de NOT_FOUND y
motivo de auditoría: se reforzaron, sin cambiar implementación para complacer
pruebas. Dos expectativas de versión 22 durante una corrida en progreso se
actualizaron a 23; se repite suite completa sobre el árbol estable.

Capturas desktop y 390 px inspeccionadas en
`reports/screenshots/driver-service-closed-live.png` y
`driver-service-closed-live-mobile.png`: foto QA visible, filtros completos,
fecha/chofer y métricas coherentes, sin desbordamiento horizontal.

Riesgo: objetivos 100 % líneas/ramas de políticas GPS/recibo/estado/mapa;
mutación dirigida ≥95 %, ningún superviviente de autorización/concurrencia
conocido. Cobertura core global existente ≥85 % líneas/sentencias, ≥90 %
funciones y ≥80 % ramas. Complejidad crítica nueva transacción 13, política
reapertura 2; UI JSX 33 (presentación, no motor de autorización). Respaldo
15 s: cuatro consultas PG por instantánea visible, sin llamadas Google.
Latencias son muestras locales, no p95 de red celular ni SLO garantizado.

Referencias: [cobertura AGP](https://developer.android.com/studio/test/coverage-report)
y [lectura actual cancelable de ubicación](https://developer.android.com/reference/androidx/core/location/LocationManagerCompat#getCurrentLocation(android.location.LocationManager,java.lang.String,android.os.CancellationSignal,java.util.concurrent.Executor,androidx.core.util.Consumer%3Candroid.location.Location%3E)).

## QA físico pendiente (usuario)

Primero Deploy manual develop con v23; después instalar APK 0.6.1 sobre la
anterior, sin borrar datos. Mantener ruta real y permisos precisos.

- Llegué → Cliente cerrado con fotografía. Guardar folio, comprobar tarjeta,
  imagen, fecha/chofer y marcador naranja aun seleccionado. Si no aparece,
  conservar folio/hora/ruta para investigar el caso real; no inventar éxito.
- Entregar todo/reprogramar todo: fuera de mapa/radio/destino rojo, aún en
  Ver paradas. Mezcla con algún pedido abierto: marcador permanece.
- Reprogramado en lista → Pedido → Reintentar. Cancelar no modifica;
  aceptar restaura sólo ese pedido/mapa, exige Llegué nuevo; entregar
  completa incidencia conservando auditoría. Entregado no ofrece reapertura.
- Permanecer quieto en destino, bloquear/desbloquear y desactivar/reactivar
  GPS: se recupera sin cambiar parada/reiniciar. Fuera de radio, permiso
  aproximado, mock o muestra vieja nunca habilitan Llegué.
- Cámara/red/rotación real: Verificar envío conserva una única incidencia.

El cierre/liquidación de ruta sigue siendo otro bloque. Se mantiene auditoría.
