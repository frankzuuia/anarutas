# QA — atención e incidencias en vivo · APK 0.6.0

26/09/2026. Ana Rutas, rama `develop`. PostgreSQL 17 real aislado, archivos
privados reales, HTTP/Next/Chromium y Android JVM/SDK local. Evidencia local
previa a publicación. **Sin deploy, ADB ni prueba física.** No se modifican
Five ni Odoo. El usuario autorizó commit/push sólo a develop el 26/09/2026
(«subelo»), con QA físico pendiente ya informado; no se declara producción lista.

## Autopsia y solución

La v20 confundía llegada histórica con visita activa, imponía una sola llegada
y ofrecía Iniciar guía después de Llegué. La v21 separa visita y estado por
pedido. Salir devuelve la visita a abierta sin inventar entrega/incidencia;
volver requiere GPS nuevo. La v22 conserva casos, enlaces por pedido,
fotografías privadas y eventos inmutables.

Comandos autenticados/versionados/idempotentes conectan cliente cerrado,
rechazo, entrega, reprogramación y teléfono. Reprogramar cierra sólo ese pedido,
sin fecha ni nuevo plan. Resolver administrativo no entrega/reabre y está
prohibido para cliente cerrado. La revisión final corrigió la lectura del
teléfono vigente en la ficha general y la propagación del pedido seleccionado
al abrir rechazo. Guardar teléfono conserva el formulario de incidencia.

## Evidencia automatizada

| Puerta | Ejecución / resultado |
| --- | --- |
| Tipos y build web | `npm run typecheck`; `npm run build`: verdes; nuevas rutas HTTP compiladas. |
| Lint web | `npm run lint`: verde, cero errores y avisos tras corregir exportaciones de configs de mutación. |
| Integración de comandos | `tests/driver-service-commands.test.ts`: 5/5 PG/FS reales; autorización, versiones, recibos privados, dos pedidos, reintento/abandono, entrega/reprogramación, teléfono, 24 h, limpieza fallida/recuperada y carrera. |
| Suite global y cobertura V8 | `npm run test:coverage`: **55/55 archivos; 582 aprobadas, 1 omisión preexistente**, 645,07 s. Sentencias 93,95 %, ramas 88,70 %, funciones 96,61 %, líneas **95,42 %**. |
| Mutación de visita | `npm run test:mutation:driver-service`: **53/53 muertos**, sin supervivientes/errores/timeouts. |
| Mutación de política | `npm run test:mutation:driver-service-policy`: **102/102 muertos**, sin supervivientes/errores/timeouts. |
| Mutación de contexto | `npm run test:mutation:driver-service-context`: **29/29 muertos**, sin supervivientes/errores/timeouts. Total dirigido: **184/184**. |
| HTTP/SSE/navegador | `npx playwright test tests/e2e/driver-mobile.spec.ts --grep "admin provisioning"`: **1/1**, 9,4 s prueba/29,9 s total; rechazo, resolver/cancelar, CSRF, foto privada, replay, recibo, filtro, teléfono HTTP, reintento, reprogramación y resolución durante desconexión real del navegador. Recuperación sin recarga. |
| Android JVM | **62 pruebas, 0 fallos/errores**; incluye archivos reales de outbox, límite 8 MiB, vencimiento, rutas ajenas y purga. |
| Android lint/build | `:app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:createDebugUnitTestCoverageReport`: verdes; 0 errores lint, 34 advertencias de API/configuración/KTX. No se certifica distribución de producción. Una corrida intermedia lint falló durante cambios de fuentes; repetida con árbol estable quedó verde. |
| Cobertura Android dirigida | `DriverServicePolicyKt`: 7/7 líneas, 19/20 ramas (95 %). Visita/marcadores: 100 % líneas/ramas. `IncidentCaptureStore`: 34/35 líneas (97,14 %), 34/48 ramas (70,83 %); constructor Context/carreras de disco pendientes de dispositivo. |
| Supply chain runtime | `npm audit --omit=dev --audit-level=high`: **0 vulnerabilidades** reportadas, sin dependencias añadidas. |
| Firma | `apksigner verify --print-certs`: verificada; mismo certificado debug SHA-256 `f92d2160eccdadb8b72ac5573ef07dc09eb8fdd57c10621d33afaeb7dd4c2e35`. |
| Diff | `git diff --check`: sin errores; avisos CRLF Windows. |

Gherkin: `tests/acceptance-driver-service.feature` (AI01..19/AI02a). Las
fixtures crean datos declarados en PostgreSQL real; no sustituyen Google,
Odoo ni FCM. La captura web contiene un raster sintético identificado como
evidencia QA, no una foto de comercio real.

## Seguridad y retención

- Servidor verifica dispositivo/chofer/ejecución/publicación/visita/pedido y
  versiones. Una carrera acepta sólo una acción; misma clave recupera recibo,
  distinto contenido se rechaza. El recibo sólo es visible al mismo dispositivo.
- Imagen realmente decodificada: 8 MiB entrada, 20 MP, metadata eliminada,
  orientación normalizada, WebP hasta 1,5 MiB. Admin activo para descargar,
  no URL pública: no-store/nosniff/same-origin.
- Acceso vence al resolver o cumplir 24 h, aun si unlink falla. Worker cada
  minuto con SKIP LOCKED; sólo marca removido tras borrado o ENOENT. Huérfanos:
  sólo nombres generados, propios y antiguos. Metadata/auditoría permanecen.
- Outbox móvil en noBackupFilesDir; comando cifrado con Keystore. Foto
  descartada al confirmar/fallar definitivamente; purga local al abrir la
  ejecución, sin prometer worker Android con la app cerrada.
- Teléfono sólo si falta, cliente vigente y versión correcta; overlay en
  lectura móvil. No sobrescribe número admin, Odoo ni snapshot publicado.
- Endpoint provee X-Request-ID, Server-Timing y errores sanitarios, sin fotos,
  números operativos, claves ni tokens en logs de estas operaciones.

## Corrección AI19 — módulos independientes (26/09/2026)

Causa: `IncidentsPanel` montaba `LiveIncidentsPanel` como tarjeta hija y
compartía sus filtros. Se retiró esa composición: `Dashboard` incorpora la
sección `live_incidents`, entrada lateral «Incidencias en vivo», revisión
propia y pantalla con sus filtros de fecha/chofer. «Incidencias» conserva
repuntes, llegadas fuera de horario y reglas de llegada. No cambian APIs,
autorización, esquema, estados de pedido ni APK.

QA reproducible: `npm run typecheck`, `npm run lint`, `npm run build`, luego
`npx playwright test tests/e2e/driver-mobile.spec.ts tests/e2e/panel.spec.ts`.
La primera corrida: **3/3 aprobadas, 1,0 min**. Verifica navegación de ida y
vuelta sin escritura, ausencia de llamadas live en la pantalla histórica,
rechazo/resolución, foto privada, filtros, reintento y reconexión. Revisión
visual de desktop/390 px detectó filtros estrechos: corregidos con grid
responsivo exclusivo del módulo y regresión del ancho de los tres campos.
Corrida final sobre ese ajuste: **3/3 aprobadas, 1,0 min**; tipos/lint/build
verdes. Validación local terminada; publicación y QA físico siguen pendientes.

Capturas inspeccionadas: `reports/screenshots/driver-service-closed-live.png`
y `reports/screenshots/driver-service-closed-live-mobile.png`. La evidencia
raster es QA sintética, no un negocio real. Medición de la corrida con el
ajuste responsivo: caso cerrado **138 ms**, reconexión **32 ms**; muestras
locales, no SLO ni p95. Cero desbordamiento horizontal a 390 px. Las métricas
de cobertura y mutación del bloque anterior no son una medición de cobertura
DOM de esta corrección; sus políticas críticas no fueron modificadas.

## Métricas y límites

Objetivo por riesgo: 100 % líneas/ramas en política de transiciones, pruebas
de cada ruta crítica de autorización/conflicto/rollback/recuperación y mutación
dirigida ≥90 %, sin superviviente conocido de autorización. Promedio global
no sustituye esos casos. Puerta existente: 85 % líneas/sentencias, 90 %
funciones y 80 % ramas.

Complejidad ciclomática ESLint medida en los siete módulos de servicio,
custodia/listado: máximo **15** en serviceAction; contexto **9**,
transacción pedido **10**, foto **6**, teléfono **8**, resolución **7**,
barrido **9**. Umbral de revisión ≤15 en este bloque: ramas de entrada
deliberadas con pruebas. No representa la complejidad del SQL.

Latencia de una corrida local HTTP/SSE: publicación **156 ms**, inicio
**207 ms**, repunte **257 ms**, cliente cerrado **230 ms**, cancelación previa
**119 ms**, recuperación tras reconexión **31 ms**. Muestras puntuales, no p95/carga/red celular. Cero defectos de
aislamiento/escritura parcial reproducidos en esos escenarios. Android
completo: 359/3073 líneas (~11,68 %); Compose/Google no están instrumentados
en teléfono y no se presentan como validados por las políticas JVM.

## QA físico reproducible (usuario, sin ADB)

1. Tras autorización de publicación y Deploy manual **develop**, instalar
   0.6.0 sobre la anterior: primero backend v22, luego APK. Iniciar ruta real
   con fotos del día y permisos/GPS precisos.
2. Llegué en 1: Atender/Registrar incidencia, no Iniciar guía. Ir a 2 sin
   atender: 1 abierta sin incidencia; volver exige llegada. Ver contorno de
   marcadores no activos.
3. Seleccionar segundo pedido y abrir rechazo: conserva selección. Otro vacío
   no envía; motivo válido afecta sólo segundo. Después puede entregarse;
   panel muestra completada y conserva rechazo auditado.
4. Cerrado sin foto no envía; cancelar cámara no crea nada. Con foto, todos
   los pedidos sin cerrar quedan pendientes, marcador ! y tarjeta/foto/chofer
   en vivo. Admin no ofrece Resolver para cerrado.
5. Reintentar guía no borra incidencia; llegada válida la oculta. Abandonar
   sin atender la restaura. Entregar un pedido no entrega el otro.
6. Reprogramar otro: cancelar no escribe; aceptar nota cierra sólo ese pedido,
   sin fecha/plan nuevo. Admin Resolver lo muestra resuelto, sin reabrirlo.
7. Teléfono ausente: cancelar no guarda; guardar actualiza ficha admin/móvil.
   Llamar abre marcador con teléfono operativo. Guardar desde incidencia
   conserva nota/foto/pedido.
8. Cortar red durante envío, rotar/reabrir: Verificar recupera el mismo
   comando, sin afirmar éxito antes de confirmación. Restaurar red, comprobar
   un solo caso. Cancelar publicación con envío pendiente no puede modificar
   la ejecución sustituta.
9. Filtrar fecha/chofer y reconectar panel: métricas/tarjetas mantienen ámbito.
   Foto inaccesible al resolver; expiración24h/fallo de FS tienen prueba
   automatizada, no alterar producción para repetirla.

## Artefacto y salida

`.local/releases/Five-Rutas-Chofer-0.6.0-develop.apk`, code16, 69 232 027 bytes.
SHA-256: `3C9A46AB405500679443DEC608BBA287A64B5FDC87B5760C038A59A328E3F7B6`.
Firma debug para pruebas, no release de producción.

**Liquidación/cierre es bloque posterior BL-118:** no se implementan cobros,
efectivo recibido, cuadre ni ocultación tras cierre real. Se conserva auditoría
para conectarlo después sin destruir historia. Sin autorización específica
no se hace commit/push/deploy.

Autorización de publicación de pruebas recibida el 26/09/2026: únicamente
commit/push a develop. Verificación del bundle de migración (`npm run
bundle:migration`) verde; v21/v22 se ejecutan automáticamente en el arranque
del contenedor según Dockerfile. Deploy manual y QA físico siguen pendientes.
