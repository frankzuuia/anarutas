# Progreso — bloque 1

## Archivo y productos — BL-143..146

- [x] PI-T01: esquema aditivo v27 y archivo dominical 20:00 auditable sin borrar datos.
- [x] PI-T02: contrato, comando móvil, cantidades exactas, permisos y recibos.
- [x] PI-T03: captura por partida/faltante, Departamento y confirmación de atención APK.
- [x] PI-T04: historial, reposiciones en vivo, corrección administrativa y Excel privado de nueve columnas.
- [x] PI-T05: QA automatizado documentado en `QA-INCIDENCIAS-PRODUCTOS.md`:
  633 pruebas, 91 JVM, 9 E2E + repetición final; 217 mutantes TS y 17 Android
  detectados. Cobertura dirigida 100% líneas/97.5% ramas; build/tipos/lint verdes.
- [x] PI-T06: foto obligatoria en reposiciones/devoluciones, opcional en faltantes;
  miniatura y apertura privada en panel. Chofer, Concepto y foto excluidos del Excel.
- Publicación de prueba a develop autorizada por el usuario; main queda fuera
  del alcance. Preflight confirma rama develop, PostgreSQL privado y volumen
  persistente de fotos en el servicio exclusivo de Ana Rutas.
- Deploy manual a cargo del usuario; no activar ni reiniciar servicios desde
  este bloque. Pendientes externos: comprobar respaldo, prueba física APK/cámara
  y reintentos. No declarar salida productiva completa.

## Ventanas diarias de clientes — BL-142 / VH01..VH08

- [x] VH-T01: contrato y validación de intervalos diarios con control de versión existente.
- [x] VH-T02: migración v26 transaccional, consolidación y archivo auditable; PostgreSQL real y concurrencia.
- [x] VH-T03: directorio, Excel y pedidos sin selector/filtro de días.
- [x] VH-T04: 625 unitarias/integración, 1 omitida, E2E 1/1, cobertura global
  95.72% líneas/89.59% ramas en corrida anterior y cobertura dirigida final
  90.9% líneas/90.47% ramas, migración 100%, 125/125 mutantes detectados,
  build/tipos/lint y auditoría de dependencias verdes. Evidencia y procedimiento
  en `QA-VENTANAS-DIARIAS.md`.
- [ ] Preflight de la base del entorno de destino antes de promover; sin commit,
  push ni despliegue hasta autorización explícita.

## Tiempo al destino — BL-141

- [x] ETA-T01: contrato opcional, migración v25 repetible/concurrente, validación/persistencia/proyección; PostgreSQL real.
- [x] ETA-T02: tiempo SDK en Registry, servicio y barra Android; invalidación; 87 JVM, política ETA con 100% líneas/ramas y 15 mutantes eliminados.
- [x] ETA-T03: resumen individual/lista por ejecución, filtros locales y accesibilidad; E2E de filtros/teclado/geometría.
- [ ] ETA-T04: QA local y APK 0.7.2/code21 generados; falta prueba física de Navigation SDK y publicación de backend/panel. Evidencia y procedimiento en `QA-TIEMPO-AL-DESTINO.md`. No declarar salida productiva completa.

## Vista individual compacta — BL-140 / CC20

- [x] CC-T15: encabezado único/ayuda, pie global retirado y mapa flexible al viewport.
  5 E2E verdes: escritorio/móvil, actualización, fullscreen, cuatro pantallas
  y regresión general del panel (sesiones/CSRF/cuentas/reinicio);
  12 unitarias, política 100% líneas/ramas, 42/42 mutantes de regresión.
  Build/tipos/lint verdes; causa móvil detectada por E2E y corregida antes de
  entrega. Geometría y procedimiento en QA-RUTA-VIVO-COMPACTA-2026-09-26.md.

## Continuación después de atención — BL-139 / NC01..06

- [x] NC-T01: política y aviso tras confirmación; candidato dinámico, cierre manual.
- [x] NC-T02: excluir preview durante cálculo/guía restaurada, conservar pines.
- [x] NC-T03: 85 JVM, política 100% líneas/ramas, 18/18 mutantes Android,
  16 contratos PG y 2 E2E móvil HTTP verdes; APK 0.7.1/code20 y tests Compose
  compilados, firma igual a 0.7.0. Lint 0 errores/33 warnings heredados.
  Evidencia, primer timeout de preparación y repetición en QA-CONTINUACION-0.7.1.md.
- [ ] NC-T04: QA físico del usuario sin ADB (guía restaurada, entrega, cámara y rotación).

## Resumen separado de créditos — BL-138 / CC19

- [x] CC-T14: eliminar colisión confirmada en Maps real con fila propia de 19 px;
  3 E2E reales, 12 unitarias/100% política y 42/42 mutantes de regresión verdes.
  Canvas 215.25/199.25 px, sin intersección con resumen; build/tipos/lint verdes.
  QA reproducible en QA-CONTINUACION-0.7.1.md; revisión Maps tras Deploy pendiente.

## Resumen al pie — BL-137 / CC18

- [x] CC-T13 / CC18a..c: resumen compacto mediante control Google BOTTOM_LEFT,
  fallback inferior, portal/limpieza y regresión responsive sin cambiar datos.
  Build/tipos/lint, 12 unitarias y 3 E2E verdes; 42/42 mutantes de política como
  regresión. Resumen fallback 22 px a 3 px del borde, sin cambiar canvas. QA
  documentado en QA-MAPA-PRIORITARIO-2026-09-26.md; Maps real tras Deploy pendiente.

## Mapa prioritario — BL-136 / CC17

- [x] CC-T11 / CC17a..c,e: controles opacos, sólo chofer, mapa sin recorte,
  detalle desplegable y regresión de persistencia/teclado/fullscreen.
- [x] CC-T12 / CC17d: encuadre al primer GPS, política probada/cobertura/mutación,
  contratos de telemetría reales y diagnóstico sin fingir prueba física.
  Usuario confirmó GPS al actualizar de APK anterior a 0.7.0. Marcador cambiado
  a camioneta sin nombre visible. 20 unit/PG, 3 E2E, 42/42 mutantes detectados,
  política 100% cobertura; mapa 75.02%/73.67% de tarjeta sin recorte. Evidencia
  y límite Maps real en `QA-MAPA-PRIORITARIO-2026-09-26.md`. Sin nueva APK/Deploy.

## Mutación del panel en vivo — BL-135 / RT09

- [x] RT-T07 / RT09a..c: pruebas PG/SSE para latido posterior a cambio, canal
  heredado, fallo real de LISTEN, errores 401/no 401 y abort concurrente;
  cierre de timer instrumentado sin mocks; 43/43 mutantes detectados, umbral
  elevado a 100%, 20 pruebas dirigidas, 3 E2E, build/tipos/lint verdes.
  Evidencia en `QA-CENTRO-CONTROL-BARRA-2026-09-26.md`.

## Barra única del Centro de control — BL-134 / CC16

- [x] CC-T10 / CC16a..c: unir título, ayuda, estado, agregar y actualizar en
  una barra compacta; medir altura ganada y validar refresco, persistencia,
  teclado, cuatro pantallas y ventana estrecha mediante E2E real.

  Evidencia en `QA-CENTRO-CONTROL-BARRA-2026-09-26.md`. Commit/push a develop
  autorizados por el usuario; publicar tras completar RT-T07. Sin Deploy.

## Densidad del Centro de control — BL-131 / CC13

- [x] CC-T07 / CC13a..c: retirar pie lateral, compactar encabezado, ayuda
  accesible junto al título y validar navegación, teclado y tarjetas en E2E.
- [x] CC-T08 / CC14a..d: incidencias vivas sin fechas, filtro por chofer,
  fichas compactas expandibles y verificación PG/API/E2E/mutación dirigida.
- [x] CC-T09 / CC15a..d: cuatro tarjetas completas a 1500×800 y 1366×768, scroll interno,
  pantalla completa y regresión del selector de chofer.

  Evidencia reproducible en `QA-CENTRO-CONTROL-DENSIDAD-2026-09-26.md`.

## Centro de control — BL-126..130 / CC01..CC12

- [x] CC-T00: inspección real, autorización y contratos; GPS sólo local confirmado.
- [x] CC-T01 / CC01..05,09: v24, telemetría autorizada/ordenada, snapshot y preferencias CAS;
  PostgreSQL/HTTP reales, sin alterar revisiones de atención.
- [x] CC-T02 / CC01..05,11: servicio Android visible, ciclo de vida/destino/revocación;
  código compilado y política probada, ejecución física reservada a CC-T06.
- [x] CC-T03 / CC06..08,12: mapa/progreso compartido y tablero adaptable persistido;
  fullscreen conserva instancia, todas las secciones disponibles en el selector.
- [x] CC-T04 / CC07..10: filtros independientes e integración incidencias, accesibilidad;
  E2E duplicación, persistencia, ordenar/quitar y catálogo completo verdes.
- [x] CC-T05 / todos: 595 pruebas servidor, 78 JVM, 5 E2E; cobertura dirigida
  100% líneas/98.24% ramas, mutaciones 121 servidor y 13 Android detectadas;
  tipos/lint/build/audit y firma APK 0.7.0 verificados. Límites y procedimiento
  reproducible en QA-CENTRO-CONTROL-0.7.0.md. FCM opt-in no ejecutado.
- [ ] CC-T06 / CC04,11: QA físico del usuario (sin ADB), Deploy manual develop.
  Incluye Maps real, GPS/segundo plano y formulario/IME. No declarar producción
  ni publicar sin excepción explícita de estas puertas pendientes.
- [x] CC-PUB-AUTH: 26/09/2026, usuario autorizó commit y push sólo a develop
  para pruebas con CC-T06 e IF-T04 pendientes. No autoriza Deploy ni main.

## Formulario de incidencias 0.6.2 — BL-124..125 / IF01..IF07

- [x] IF-T00: inspección de raíz/develop, contenedor, foco, insets, cámara y
  contratos; especificación y referencias oficiales, sin tocar five/main.
- [x] IF-T01 / IF01..02: tarjetas con vectores, selección exclusiva/accesible,
  paleta y mismas restricciones de envío.
- [x] IF-T02 / IF03..06: formulario anclado, insets una vez, encabezado fijo,
  scroll/editor acotado y borrador conservado, Done sin envío.
- [x] IF-T03 / todos: 76 JVM, política 100 % líneas/ramas y 8/8 mutaciones;
  dos instrumentadas nuevas compiladas (no ejecutadas), lint 0 errores,
  assemble, seguridad/diff y APK 0.6.2/code18 con misma firma verificada.
  Evidencia y límites en QA-FORMULARIO-INCIDENCIAS-0.6.2.md.
- [ ] IF-T04 / IF03..07: teclado/cámara/GPS/rotación físico por usuario sin ADB;
  no declarar completo el comportamiento del IME sin esa prueba.

## Corrección operativa 0.6.1 — BL-120..123 / RG01..RG10

- [x] RG-T00: autopsia, reglas y contratos; aprobación del bloque y de commit/
  push sólo develop; causa real de foto aún no demostrada, sin tocar datos live.
- [x] RG-T01 / RG05..08: v23 y reapertura por pedido autenticada, atómica,
  versionada/auditable/idempotente, visita invalidada y nueva llegada necesaria.
- [x] RG-T02 / RG03..06: APK naranja, mapa filtrado/lista íntegra, reintento
  explícito desde ficha, retiro destino SDK terminal y revisión de estado.
- [x] RG-T03 / RG09..10: watchdog GPS actual, cancelación/lifecycle/backoff,
  sin ampliar radio ni confianza de lecturas.
- [x] RG-T04 / RG01..02: recibo privado con ID y recuperación de lectura del
  panel con señal ausente; contratos/HTTP/SSE/E2E/foto reales.
- [x] RG-T05 / todos: 586 servidor/72 JVM/3 E2E, 174 mutaciones y cobertura
  dirigida 100 %, tipos/lint/build/seguridad verdes. QA medido y APK 0.6.1
  firmada lista; commit/push sólo develop autorizados, verificación remota al
  publicar. Evidencia en QA-RECUPERACION-OPERATIVA-0.6.1.md.
- [ ] RG-T06: Deploy manual y QA físico por usuario, sin ADB; no certificar
  reproducción del reporte real ni SDK/GPS por pruebas automatizadas solamente.

## Atención e incidencias en vivo — BL-111..117

- [x] AI-T00: autopsia de estado de llegada/guía, almacenamiento privado,
  teléfono operativo y canal SSE; reglas BL-111..116 registradas.
- [x] AI-T01: contrato de reprogramación sin fecha ni asignación; GREEN LIGHT
  documental, INTEGRITY TOTAL y MATCH PERFECT contra AI01..AI17/AI02a.
- [x] AI-T02a: v21, migración no destructiva de visita y estados por pedido;
  backfill de llegada 1 y pedidos abiertos, replay seguro, PostgreSQL real.
- [x] AI-T02b: v22 aditiva crea caso, pedidos vinculados, evidencia con caducidad
  de 24 h y eventos inmutables; PostgreSQL real verifica FKs, aislamiento,
  unicidad de caso activo, replay de migración y rollback. Comandos conectados
  con locks de ejecución/visita/pedido y limpieza física reintentable.
- [x] AI-T03: salida de visita idempotente, llegada repetible y rescate de APK
  anterior; comandos de incidente, reintento, entrega, reprogramación y teléfono;
  contratos HTTP/autorización/regresión y recuperación privada del recibo.
- [x] AI-T04: custodia privada de fotografías, lectura admin y limpieza automática
  a 24 h o resolución; pruebas de seguridad, fallo y recuperación.
- [x] AI-T05a: APK: botones según estado, captura, causas, llamada, reintento,
  reprogramación sin fecha, selección explícita de pedido y marcadores legibles.
- [x] AI-T05b: 62 JVM, lint sin errores, build/cobertura y APK 0.6.0/code16
  con firma debug verificada; reporte en QA-ATENCION-INCIDENCIAS.md.
- [ ] AI-T05c: QA físico de cámara, GPS, guía, red incierta y rotación por el
  usuario, sin ADB. Primero requiere backend v22 desplegado en develop.
- [x] AI-T06: tarjeta «Incidencias en vivo», filtros/métricas por chofer, foto
  autorizada y «Resolver»; E2E PostgreSQL/HTTP/SSE con reconexión.
- [x] AI-T06b / AI19: «Incidencias en vivo» separada como entrada lateral y
  pantalla propia; tipos/lint/build verdes, E2E 3/3 con navegación, filtros,
  aislamiento visual, foto, SSE/reconexión y ancho móvil verificado.
- [x] AI-T07a: Gherkin AI01..AI18/AI02a, 582 pruebas servidor, 62 JVM,
  cobertura 95,42 % líneas servidor, 184/184 mutantes dirigidos, HTTP/SSE/E2E
  con reconexión, seguridad, QA reproducible y latencias documentadas.
- [x] AI-T07b: autorización explícita de commit/push sólo a develop recibida
  el 26/09/2026 («subelo»), con QA físico pendiente ya informado. Main y Odoo
  fuera de alcance; evidencia automatizada en QA-ATENCION-INCIDENCIAS.md.
- [ ] AI-T07c: Deploy manual develop por el usuario y QA físico de APK 0.6.0;
  la subida de código no certifica despliegue ni GPS/cámara en su teléfono.
- [x] AI-T08a / BL-119 / AI18: contorno de marcadores no activos, paleta por
  estado probada en JVM (100 % ramas de la política) y compilación/lint Android;
  sin mezclar visita con entrega. No cierra ni liquida la ruta.
- [ ] AI-T08b / AI18: validación visual física pendiente del usuario; no se
  declara validado el render del SDK en teléfono antes de esa prueba.

## Liquidación y cierre real — BL-118 (bloque posterior, sin autorización de implementación)

- [ ] LQ-T00: documentar origen real de importes, formas de cobro, devoluciones,
  diferencias, roles y flujo de entrega/recepción; matriz de riesgos y permisos.
- [ ] LQ-T01: diseñar libro auditable de cobros/liquidación y estado de cierre,
  con reglas exactas de conciliación y conservación de evidencia.
- [ ] LQ-T02: implementar sólo tras aprobación y pruebas financieras reales;
  ninguna ruta se marcará cerrada con estimaciones de navegación.

## Ajuste 0.5.4 — destino explícito y repunte desde GPS o mapa

- [x] NV01..02: ficha de pedidos permanece de sólo lectura hasta «Ir a esta parada»;
  selección local cambia destino y solicita guía sin alterar pedidos ni llegadas.
- [x] NV03..04: respuesta asíncrona vieja, fallo SDK y estados no autorizados
  conservan invariantes y reintento seguro.
- [x] RP01..02: GPS actual válido centra y mueve pin aunque el anterior esté lejos;
  selección manual mediante arrastre/toque prolongado permanece disponible.
- [x] RP03..04: GPS inválido no desbloquea confirmación; radio y transacción de
  repunte/llegada existentes permanecen intactos.
- [x] QA automatizado: Gherkin NV/RP, 52 JVM, 3 PostgreSQL, cobertura, 35/35
  mutantes, lint/build Android y APK local 0.5.4/code15. Evidencia en
  `QA-NAVEGACION-REPUNTE-0.5.4.md`.
- [ ] QA físico con teléfono del usuario; sin ADB, commit, push ni deploy de este
  bloque hasta autorización específica.

## Corrección 0.5.3 — lista para prueba física

- [x] F01..02: evaluar GPS con reloj monotónico vivo; regresión de lecturas entre pulsos y caducidad sin callbacks.
- [x] F03..06: selección común del mapa según asignación real; vista explícita Sin asignar y estado vacío sin métricas engañosas.
- [x] Pruebas, cobertura, mutación, E2E PG/HTTP, build/lint y APK 0.5.3/code14. Evidencia en `QA-REGRESIONES-MAPA-GPS-0.5.3.md`.
- [ ] Validación física por el usuario sin ADB. Sólo develop; no deploy automático ni main.

## Ajuste 0.5.2 — vista previa manual y controles de navegación

- [x] Mapa del borrador completo: primera apertura solicita recorrido manual una vez por versión; aperturas siguientes reutilizan resultado/trabajo. Publicar sigue siendo una decisión separada.
- [x] GPS: una lectura imprecisa posterior no invalida visualmente una muestra todavía aceptable para el servidor; lectura confiable fuera del radio, simulación o caducidad sí bloquean. Se descartan callbacks anteriores.
- [x] Audio aplicado al crear/iniciar/reanudar la guía; tarjeta ETA y botón de reporte de Google desactivados con las APIs oficiales. La atribución permanece visible.
- [ ] Deploy del panel y QA físico de GPS, voz y Navigation SDK con el teléfono del usuario. Sin autorización para main.

Evidencia y métricas: `QA-AJUSTE-MAPA-NAVEGACION-0.5.2.md`. APK debug local 0.5.2/code13; el usuario autorizó commit y push sólo a `develop` tras las puertas locales.

## Ajuste 0.5.1 — mapa del chofer y domicilio de repunte

- [x] Ficha inferior plegable, consulta de un marcador sin cambiar la guía y voz de Navigation SDK silenciable con preferencia persistida.
- [x] En 0.5.1 el GPS usaba la muestra más reciente y amortiguaba imprecisión sólo 3 s; el ajuste 0.5.2 en curso extiende la amortiguación únicamente hasta la vigencia del servidor y revoca ante una nueva lectura confiable fuera del radio. No se amplían radio ni precisión; GPS simulado o proveedor desactivado falla cerrado.
- [x] Repunte en dos confirmaciones: primero pin y después modal obligatorio de dirección, colonia, código postal y ciudad. Cerrar el modal no escribe. Cliente, búsqueda, ejecución propia e incidencia se actualizan en una transacción; Odoo y snapshots de otras camionetas permanecen intactos. APK anterior sin campo nuevo conserva compatibilidad.
- [ ] QA físico del usuario: plegar/expandir mapa, tocar marcador, silenciar/reactivar voz, llegada en radio y modal de domicilio al repuntar. No se usó ADB por decisión del usuario.

Evidencia reproducible y métricas en `QA-MAPA-LLEGADA-REPUNTE.md`. La APK 0.5.1/code12 es de `develop`; Deploy del backend e instalación manual de la APK corresponden al usuario. No hay promoción a `main`.

## Mapa/llegada/repunte — BL-105..108 / ML01..24

Documento: `BLOQUE-MAPA-LLEGADA-REPUNTE.md`. Implementado, con puertas locales cerradas;
no entregar como integración Google terminada. El usuario confirmó repunte permanente y filtros
de incidencias por fecha/chofer. Bloque y parámetros aprobados con «dale» el 24/09.

- [x] ML-T00: autopsia, documentación oficial y bloque/política aprobados; MATCH PERFECT documental. Integración Google física sigue pendiente.
- [x] ML-T01: migración 19→20, ejecución/paradas, política y autoría/histórico; PostgreSQL/backfill/rollback reales.
- [x] ML-T02: lectura autorizada, revisión operativa y SSE; HTTP prueba retiro y nueva ejecución; APK anterior conserva contratos.
- [x] ML-T03: llegada, GPS/ventanas/hora/idempotencia; pruebas de unidad, PostgreSQL y HTTP.
- [x] ML-T04: repunte atómico e historial/incidencia/versiones; aislamiento y carreras PG, sincronización del cliente preservada.
- [ ] ML-T05: código y APK debug compilan, política GPS probada; falta validación visual/GPS/rotación en dispositivo por el usuario.
- [ ] ML-T06: guía de destino único, limpieza y avisos locales implementados; licencia original del SDK empaquetada automáticamente y verificada byte a byte. Clave Android restringida ya configurada; pendientes navegación y diálogo real de términos Google en dispositivo.
  ML24: usuario autoriza configuración Android en develop. Proyecto Maps con billing
  existente verificado; FCM independiente e intacto. Navigation SDK y Maps SDK Android
  habilitados, clave restringida a paquete/firma/APIs e inyección local ignorada y
  protegida por ACL. Siete casos Gradle reales y cinco mutaciones detectadas;
  APK recompilada con clave real, 43 JVM y lint/assemble verdes, sin prueba vial.
- [x] ML-T07: incidencias fecha/chofer, política, paginación y SSE; prueba HTTP muestra repunte sin recargar y conserva filtros.
- [ ] ML-T08: Gherkin ML01..24, unidad/PG/API/E2E/seguridad, cobertura/mutación,
  métricas, QA y APK; dispositivo y navegación Google pendientes. Backend antes
  de APK, Deploy manual del usuario. Evidencia local y límites en `QA-MAPA-LLEGADA-REPUNTE.md`;
  puertas locales cerradas: 540 pruebas servidor, 43 JVM Android, 3 E2E navegador;
  cobertura core 95.11 % líneas; mutación 98.61 % política, 98.96 % comando y
  18/18 Android. APK 0.5.0/code11 compilada y firma anterior verificada. T08
  permanece abierta por términos de Google y prueba física.
  Commit y push exclusivamente a develop autorizados por el usuario para probar
  la APK, con excepción explícita para GPS/navegación físicos pendientes.
  Deploy manual del usuario; main y producción fuera de alcance.

## Cancelación antes del inicio y cambios propios — BL-104

- [x] CP-T01 (CP01,02,05,06): cancelar publicación sin exigir inicio, conservar pedidos/asignaciones/orden/fotos, locks/permisos/auditoría y retiro móvil/outbox FCM.
- [x] CP-T02 (CP03,04): comparación por camioneta sin versión ni posiciones globales, API de cambios pendientes y botones coherentes; compatible con snapshots anteriores.
- [x] CP-T03 (CP01..06): 506 pruebas locales, 2 E2E, cobertura 94.82 % líneas, mutación 94.74 % / 96.15 %, tipos/lint/build; evidencia y límites en `QA-CANCELACION-PUBLICACION.md`. Los escenarios dependientes se agruparon para impedir falsos positivos de mutación.
- [ ] CP-T04: Deploy manual del usuario en develop y prueba física del aviso de cancelación. No requiere otra APK ni cambio de esquema. Producción no se toca.

## Push FCM nativo — BL-103 / PN01..09

- [x] PN-T00: auditoría del flujo de publicación/cancelación, sesión, SSE, Android y documentación oficial; proyecto y app Android Firebase develop registrados.
- [x] PN-T01: migración de registro FID y cola transaccional por dispositivo; prueba PostgreSQL de rollback, retiro y reasignación.
- [x] PN-T02: API de registro autenticado y desactivación al salir/revocar; pruebas HTTP/seguridad.
- [x] PN-T03: worker HTTP v1 con credencial de servicio en runtime, lease, reintento, caducidad y observabilidad; contrato FCM real negativo y pruebas PostgreSQL.
- [x] PN-T04: SDK Android, permiso, recepción y refresco; APK 0.4.0 de develop compilada y firmada.
- [ ] PN-T05: Gherkin, cobertura, mutación, QA reproducible, lint, tipos y build en `QA-PUSH-FCM-RUTAS.md`; el usuario configuró las variables en develop y confirmó recepción real de «Nueva ruta disponible» con APK 0.4.0. Falta smoke físico del aviso de retiro/cancelación; sin certificación productiva.

## Entrega móvil en vivo — BL-102 / MN01..08

- [x] MN-T01: endpoint SSE móvil autorizado con huella propia, reset, coalescencia, latidos y limpieza.
- [x] MN-T02: APK observa eventos visible, reconecta y conserva consulta de respaldo; aviso de ruta nueva/revisada sin duplicado inicial.
- [x] MN-T03: Gherkin, PostgreSQL/HTTP, Android, cobertura/mutación, tipos/lint/build y QA reproducible; evidencia local en `QA-RUTA-MOVIL-EN-VIVO.md`. Smoke del proxy y dispositivo pendiente del usuario.
- [ ] MN-T04: integración FCM real implementada y validada contra Google con FID inexistente; pendiente configuración EasyPanel develop y smoke con APK cerrada en teléfono del usuario. No se instalaron servicios de fondo improvisados.

## Espacio del chofer — BL-101

- [x] UX-T01 (UX01,02): tema, iconos, logo original Five, shell con drawer y barra compacta, Inicio de tarjetas.
- [x] UX-T02 (UX03..05): Ruta/Pedidos/Unidad/Mis rutas, búsqueda virtualizada, detalle y fotos con estilo compartido.
- [x] UX-T03 (UX06,07): mapa actual persistente, preferencias reales y perfil; clave Android sigue pendiente de configuración.
- [x] UX-T04 (UX04,08): 25 pruebas Android, 20 PostgreSQL y 2 E2E HTTP/panel verdes; 8/8 mutantes detectados, política 100 % líneas / 95.89 % ramas.
- [x] UX-T05: APK 0.3.0/code 8 y APK instrumentada compiladas, lint sin errores; entrega de desarrollo. No necesita Deploy/Rebuild del panel.
- [ ] UX-T06: aprobación visual y E2E Android en dispositivo. Usuario eligió explícitamente probar la APK él mismo y no habilitar ADB en BlueStacks. No se declara certificación productiva. Evidencia y QA: `QA-ESPACIO-CHOFER.md`.

## Panel en vivo — BL-100 / RT01..08

- [x] RT-T01: migración de eventos transaccionales y listener compartido con limpieza y reconexión.
- [x] RT-T02: SSE privado, sesión visible activa, revocación y vencimiento absoluto.
- [x] RT-T03: invalidación de secciones, estado de conexión y formularios conservados.
- [x] RT-T04: Gherkin, 497 pruebas PostgreSQL/core, 3 E2E HTTP/navegador, 18 Android, cobertura 95.54 % líneas, mutación dirigida 82.22 %, tipos/lint/build y QA local. Entrega a develop autorizada; Deploy manual del usuario. Limitaciones explícitas en el informe, sin certificación productiva.
- [x] RT-T05 / MR29: APK 0.2.4 limpia fotos/pantalla al cambiar el día del servidor sin cerrar sesión; regresión de medianoche local rechaza Inicio del día anterior.
- [ ] RT-T06: smoke en proxy develop tras Deploy, teléfono físico y métricas de carga. Evidencia local y limitaciones en `QA-PANEL-TIEMPO-REAL.md`; captura de incidencias sigue siendo un módulo pendiente.

## Ruta publicada, inspección e inicio móvil — 22/09/2026

Especificación: `BLOQUE-APK-RUTA-PUBLICACION.md`; MR01..17.

- [x] MP-T01 (BL-088..095): auditar esquema, API, Android, recálculo lateral, almacenamiento y facturación oficial; escenario y contrato documentados.
- [ ] MP-T02 (BL-088..089 / MR01..05): migración de snapshot por camioneta, API admin individual/global idempotente y lectura móvil sólo publicada.
- [ ] MP-T03 (BL-091 / MR10..12): proteger camioneta iniciada en plan, pedidos, flota, importación, optimización y recálculo, sin bloquear otras camionetas.
- [ ] MP-T04 (BL-092..093 / MR06..09,13..14): fotos WebP privadas fuera de PostgreSQL, volumen, limpieza 15 días y control admin por fecha.
- [ ] MP-T05 (BL-090 / MR06..12): inicio transaccional con foto/fecha/asignación, respuesta idempotente y auditoría.
- [ ] MP-T06 (BL-094 / MR15..16): APK compacta con Ruta activa, detalle/recorrido/secuencia, captura, inicio y mapa Navigation SDK real, accesible abajo tras iniciar.
- [ ] MP-T07 (BL-088..089,095 / MR02..05,17): panel de publicación individual/global con modal y Control de unidades.
- [ ] MP-T08 (todos): Gherkin, unitarias, PostgreSQL/API real, Android/E2E, seguridad, cobertura, mutación, cuotas/latencia, diff, dispositivo y smoke; sin commit/push/deploy hasta autorización.

Estado local al 22/09: MP-T02, T03, T05 y T07 tienen implementación y pruebas locales; T04 aún necesita volumen persistente, T06 clave Android y dispositivo físico, y T08 sigue abierto por QA real, métricas y avisos legales. Evidencia exacta en `QA-BLOQUE-APK-RUTA-PUBLICACION.md`. Ninguna tarea se marca cerrada ni lista para despliegue. La asignación de chofer a camioneta persiste entre días y puede cambiarse para planes futuros; la ruta ya iniciada conserva su responsable y no se transfiere automáticamente.

### Ajuste de prueba live — 23/09/2026

- [ ] MP-T09 (BL-098 / MR18,23): distinguir endpoint ausente del 404 de autorización, no abrir Fotos con error y verificar commit/volumen de develop antes de probar.
- [ ] MP-T10 (BL-096 / MR19..20): quitar galería, robustecer cámara/caché, deduplicar por unidad entre fechas y mantener idempotencia en la misma ruta.
- [ ] MP-T11 (BL-097 / MR21..22): confirmación compacta con paradas reales y revisión esperada validada en la transacción de inicio.
- [ ] MP-T12 (BL-096..098): actualizar aceptación, unitarias, PostgreSQL/HTTP, Android, cobertura, mutación y QA; no declarar listo sin prueba física y volumen.

### Ajuste de foto descartable — 23/09/2026

- [x] MP-T13 (BL-099 / MR24,26..28): DELETE móvil autenticado, bloqueo transaccional con inicio, aislamiento, auditoría, retiro privado de WebP y recuperación de archivo huérfano.
- [x] MP-T14 (BL-099 / MR24..26): vista previa y confirmación compacta por foto en APK, acción ausente tras inicio y conteo recargado desde el servidor.
- [ ] MP-T15 (BL-099 / MR24..28): PostgreSQL/HTTP reales, carrera con Inicio, Android, Gherkin, cobertura, mutación, seguridad y QA físico; sin declarar listo para producción por sólo compilar.

## Higiene de almacenamiento de pruebas — 15/09/2026

- [x] HA-T01: autopsia local confirmó 4,042 clústeres PostgreSQL temporales y diez sandboxes Stryker abandonados; no eran código ni datos productivos.
- [x] HA-T02: el helper PostgreSQL usa clústeres no persistentes, cierre idempotente y limpieza defensiva aun cuando fallen pool, servidor, arranque o migración.
- [x] HA-T03: todas las configuraciones Stryker heredan una sola política con `cleanTempDir: "always"` y exclusiones de artefactos generados.
- [x] HA-T04: regresiones reales sin mocks, 449/449 pruebas, cobertura global 95.77% líneas, mutación controlada 5/5, lint, tipos y build verdes; cero `pg-*` y cero `.stryker-tmp` después de cada puerta.
- [ ] HA-T05: commit/push a `develop` requieren autorización explícita; no cambia runtime, EasyPanel ni producción.

Evidencia y recuperación: `QA-HIGIENE-ALMACENAMIENTO-PRUEBAS.md`.

## FD — corrección de autopsia, respuesta Google directa

- [x] FD-T00: diagnóstico del recorrido 257632 m sustituido por 442329 m, contrato
      oficial revisado y escenario/documentación previa; usuario autoriza el arreglo.
- [x] FD-T01: modelo global dinámico con prioridades internas, ventanas alternativas
      y visitas físicas compatibles; una solicitud sin semilla medida.
- [x] FD-T02: expansión pura conservando secuencia, tiempos, trazos y cobertura.
- [x] FD-T03: éxito directo; recuperación sólo ante fallo, sin reintento Fleet.
- [x] FD-T04: quitar veto de prioridad sin tocar integridad, permisos ni arrastre.
- [x] FD-T05: 425/425 pruebas, núcleo directo 100% cobertura, mutación 98.99%,
      PostgreSQL, Gherkin, tipos/lint/build, E2E local y seguridad. `QA-FLEET-DIRECTO.md`.
- FD-T06: entrega autorizada únicamente a develop con esta evidencia local;
  deploy y validación vial facturable permanecen manuales. Estado de publicación
  verificable en Git, no en una declaración de perfección del algoritmo.

## Avance autorizado a develop — 12/09/2026

El usuario autorizó commit/push de logística e incidencias para probar en develop
después de conocer las puertas locales verdes y la validación live pendiente.
Deploy manual en EasyPanel a cargo del usuario; sin autorización para main ni
producción. Los informes QA conservan la evidencia previa al commit/push.

## Parada física y objetivo operativo — 14/09/2026

- [x] PF-T01: autopsia live de Prueba 2 confirmó Hotel Moto/Vincent Chapalita en la misma coordenada pero camionetas distintas y Abarrotes Franco visitado dos veces.
- [x] PF-T02: cada coordenada confirmada es indivisible durante el reparto; clientes, `partnerId`, pedidos y tarjetas permanecen independientes.
- [x] PF-T03: compactación entre prioridades sólo cuando mantiene cero inversiones; fallback continúa compactando dentro de cada nivel.
- [x] PF-T04: score v7 conserva prioridad, tardanzas y uso de flota; después minimiza conducción total más jornada máxima, viaje y distancia antes que equilibrio/espera.
- [x] PF-QA: 367/367 pruebas, cobertura global 94.62% líneas, núcleo geográfico 100% líneas/96.66% ramas, mutación logística 98.32%, tipos, lint, build, E2E y auditoría de dependencias verdes.
- [x] PF-T05: deploy manual y nueva auditoría facturable en develop; comparar kilómetros, tardanzas, retornos y puntos compartidos contra la corrida v32.

## Búsqueda global geográfica multisemilla — 14/09/2026

- [x] MG-T01 (BL-078..082 / MG01..08): autopsia live de 397.9 km; causa localizada en dos repartos y hasta tres secuencias sin vecindad global. GREEN LIGHT y MATCH PERFECT documental.
- [x] MG-T02: tercera semilla multicentro con puntos físicos indivisibles, balance dinámico y mejora `relocate/swap` hasta convergencia, sin matriz N×N ni consumo cuadrático.
- [x] MG-T03: búsqueda de secuencia `relocate/2-opt` hasta convergencia dentro de cada nivel de prioridad, conservando cobertura, grupos, puntos y precedencias.
- [x] MG-T04: deduplicación por firma, recálculo vial exacto de cada alternativa con Google Routes, logs naturales y guardado transaccional existente.
- [x] MG-QA: 382/382 pruebas, PostgreSQL real, Gherkin y regresiones; cobertura global 93.74% statements/94.92% líneas y planificador geográfico 99.7% statements/95.37% ramas; mutación dirigida 95.53%, tipos, lint, build, E2E local y dependencias verdes. Evidencia en `QA-BUSQUEDA-GLOBAL-VIAL.md`.
- [x] MG-T05: cambio versionado y enviado a `develop`; deploy y smoke facturable permanecen manuales.

## Refinamiento global entre camionetas — 14/09/2026

Estado histórico: sustituido por FC01..FC07 para eliminar la amplificación de
solicitudes Fleet Routing.

- [x] IR-T01 (BL-083..086 / IR01..08): autopsia live de 311.2 km; causa localizada en ausencia de una reapertura global posterior al ganador medido. Referencia oficial, GREEN LIGHT y MATCH PERFECT documental.
- [x] IR-T02: warm start por grupos desde el ganador preliminar y reparto global completo, sin fijar camionetas ni limitar pedidos.
- [x] IR-T03: revalidación, resecuenciación con precedencias, medición Routes y comparación contra línea base inmutable; fallo opcional no bloqueante.
- [x] IR-T04: 383/383 pruebas, integración PostgreSQL real, Gherkin y regresión; cobertura global 94.76% líneas y contrato Google 97.58% líneas/96.39% ramas; mutación logística 97.57% y Google 100%, tipos, lint, build, E2E local y dependencias verdes. Evidencia en `QA-REFINAMIENTO-GLOBAL-INTER-RUTA.md`.
- [x] IR-T05: cambio versionado y enviado sólo a `develop`; deploy y smoke facturable permanecen manuales.

## Logística por prioridad — BLOQUE-LOGISTICA-PRIORIDADES.md

- [x] LP-T01 (BL-058 / LP01..03,10): política de prioridad por destino/camioneta y diagnóstico compartido.
- [x] LP-T02 (BL-059 / LP02,04): semilla Google agrupada con horarios flexibles y expansión exacta; contrato local validado, proveedor live en LP-T07.
- [x] LP-T03 (BL-060 / LP04..07,09,11): herramientas con feedback por parada, comparación y logs.
- [x] LP-T04 (BL-061 / LP07..10,12): reutilizar mediciones, medir flota en paralelo y guardar avisos.
- [x] LP-T05 (LP01..16): puertas locales verdes: 361 pruebas, cobertura, mutación dirigida 197/197 más consulta transaccional 4/4, PostgreSQL, E2E local, build, tipos, lint y auditoría. Ver QA-LOGISTICA-PRIORIDADES.md y QA-INCIDENCIAS-PANEL.md; no certifica integración live.
- [x] LP-T06 (BL-062 / LP13..16): evidencia independiente de reparto y secuencia, holguras y comparación contra la semilla. Salida 23:59 con todas las ventanas vencidas conserva todas las entregas.
- [ ] LP-T07: ejecutar caso real con proveedores en develop, comprobar ambos experimentos, precedencia, retrasos, cobertura exacta y medir costo/latencia. Pendiente después del deploy manual; avance a develop autorizado para esta prueba.
- [x] LP-T08 (BL-064 / LP17..20): regresión live 33/20/5/2 corregida localmente con score de carga por pedidos/destinos, línea base balanceada obligatoria, feedback/logs por unidad y candado de confirmación. 368/368 pruebas, política y observabilidad con cobertura total, mutación dirigida 235/235, build, lint, tipos, E2E local y auditoría verdes. Sin commit/push/deploy; requieren nueva autorización explícita.

## Ruteo determinista sin LLM — BLOQUE-RUTEO-DETERMINISTA.md

- [x] RD-T01 (BL-065..068 / RD01..08): autopsia, referencias oficiales, reglas, escenarios, flujo y puertas; GREEN LIGHT y MATCH PERFECT documental.
- [x] RD-T02: OpenAI retirado del endpoint; orquestador Google determinista conserva lease, versión, cobertura y guardado atómico.
- [x] RD-T03: modelo Google con makespan y balance blando dinámico, sin límite duro ni umbral de 100 pedidos.
- [x] RD-T04: score prioridad → ventanas → flota → jornada/recorrido → carga como desempate, conservando grupos indivisibles.
- [x] RD-T05: 332/332 pruebas, PostgreSQL real sin OpenAI, Gherkin, cobertura 93.05% statements/94.54% líneas, mutación crítica 96.96%, lint, tipos, build y diff auditados. Ver `QA-RUTEO-DETERMINISTA.md`.
- [ ] RD-T06: commit/push a `develop` sólo con autorización explícita; deploy manual y smoke real del usuario.

## Control de costo Fleet Routing — BLOQUE-CONTROL-COSTO-FLEET-ROUTING.md

- [x] FC-T01: autopsia comprobó hasta seis solicitudes `OptimizeTours` por una sola pulsación.
- [x] FC-T02: una semilla global y una única secuenciación opcional del finalista; máximo absoluto de dos solicitudes, sin límite de pedidos.
- [x] FC-T03: fallo o intento adicional conserva el mejor candidato completo y nunca bloquea el guardado.
- [x] FC-T04: movimientos manuales conservan camioneta/orden y usan cero Fleet Routing; sólo recalculan tramos/ETA.
- [x] FC-T05: 385/385 pruebas, cobertura global 95.29% líneas, presupuesto Fleet 100%, mutación 5/5 (100%), tipos, lint, build, E2E local y dependencias verdes. Commit/push `develop` autorizados en este bloque; deploy y auditoría EasyPanel manuales.
- [x] FC-T06 (FC08..FC14): contrato oficial revisado en tres pasadas; el ganador local medido se inyecta en una única solicitud global y el modelo incorpora costo por kilómetro y atraso ponderado por prioridad.
- [x] FC-T07: máximo central reducido a una solicitud; fallo, omisión o respuesta inválida conserva la ruta local completa sin reintento. Movimientos manuales permanecen en cero Fleet Routing.
- [x] FC-T08: 385/385 pruebas, integración PostgreSQL real 2/2, cobertura global 95.43% líneas, Google 97.58% líneas/95.94% ramas, mutación Fleet 100% y logística 97.67%, tipos, lint, build, E2E aislado y dependencias verdes. Commit/push autorizados únicamente a `develop`; deploy y smoke facturable permanecen manuales.

## Secuencia vial con prioridad — BLOQUE-SECUENCIA-VIAL-PRIORIDAD.md

- [x] SV-T01 (BL-069..071 / SV01..08): autopsia visual y de logs del zigzag amarillo; causa localizada en el `sort` posterior a Google; referencia oficial y MATCH PERFECT documental.
- [x] SV-T02: constructor puro de segunda optimización con asignación fija y precedencias por camioneta, sin barrera global ni límite propio de pedidos.
- [x] SV-T03: `prioritizeCandidate` retirado del runtime; el evaluador conserva y mide exclusivamente la secuencia resuelta por Google.
- [x] SV-T04: distribución → secuenciación → medición → comparación → guardado atómico, con deduplicación de asignaciones equivalentes.
- [x] SV-T05: regresiones de no reordenamiento, precedencia por unidad, destinos agrupados, cobertura exacta, vehículos/pedidos inválidos y fallo seguro.
- [x] SV-T06: 337/337 pruebas, cobertura 93.06% statements/94.50% líneas, mutación crítica 375/375 (100%), typecheck, lint, build y diff verdes. Commit/push a `develop` autorizados; deploy manual y smoke facturable pendientes, sin autorización para `main`.

## Corrección geográfica y FinOps — BLOQUE-RUTEO-GEOGRAFICO-FINOPS.md

- [x] GF-T01 (BL-072..076): autopsia del reparto balanceado sin coordenadas y del `TIMESTAMP` numérico de BigQuery; reglas, referencias y Gherkin registrados.
- [x] GF-T02 (BL-072..075): partición geográfica balanceada, secuencia de fecha límite condicional y comparación vial completa.
- [x] GF-T03 (BL-076): normalización segura del contrato temporal real y regresión del corte observado.
- [x] GF-T04: 353/353 pruebas, cobertura 93.15% statements/94.57% líneas, núcleo geográfico 100% líneas, mutación geográfica 95.71%, FinOps 93.46%, tipos, lint, build y E2E panel verdes. Evidencia en `QA-RUTEO-GEOGRAFICO-FINOPS.md`; commit/push a `develop` autorizados y smoke facturable pendiente del deploy manual.

## Incidencias del panel — BLOQUE-INCIDENCIAS-LLEGADA.md

- Regla confirmada: el chofer pulsa «Llegué» e inicia surtido; no equivale a pedido entregado. Kalamar 10:00–11:30 / llegada 12:00 → 30 min tarde, sin bloquear ruteo.
- [x] IN-T01: usuario confirma que la APK aún no existe; implementar sólo consulta del panel, sin inventar eventos reales.
- [x] IN-T02 (BL-063 / IN01..08): previsiones agrupadas por destino, consulta autenticada consistente, selector, búsqueda, refresh y estados explícitos; llegadas reales identificadas como pendientes.
- [x] IN-T03: unidades y PostgreSQL real, carrera con edición concurrente de ventanas, 100% cobertura del modelo/consulta, mutación 58/58 y 4/4, E2E local y QA responsive. Evidencia y alcance en QA-INCIDENCIAS-PANEL.md.
- [ ] IN-T04: comprobar tarjetas pobladas con cálculo real en develop después del deploy manual; avance a develop autorizado para esta prueba.
- [ ] IN-T05: bloque móvil futuro: autenticación de chofer, evento idempotente Llegué, ventanas históricas y recepción offline. No incluido en la consulta del panel actual.

## Observabilidad de ruteo — BLOQUE-OBSERVABILIDAD-RUTEO.md

- [x] RO-T01 (BL-055/RO01): logger estructurado para stdout/stderr con mensaje natural, sistema, etapa, requestId, planId y duración.
- [x] RO-T02 (BL-056/RO01): avance histórico conectado a los sistemas entonces vigentes; el flujo actual informa Ana Rutas, Google Route Optimization, Google Routes y PostgreSQL, sin LLM.
- [x] RO-T03 (BL-057/RO01): lista cerrada de métricas, cero PII/secretos y logging fail-open; pruebas unitarias e integración del recorrido completo.
- [x] RO-T04: 332 pruebas, cobertura, mutación 100%, lint, tipos, build, auditoría y E2E local verdes; evidencia en `QA-OBSERVABILIDAD-RUTEO.md`.
- [ ] RO-T05: smoke visible en EasyPanel develop después del deploy manual; confirmar secuencia completa y privacidad con la corrida real.

## Resiliencia de volumen — BLOQUE-RUTEO-VOLUMEN.md

- [x] RV-T01 (BL-051 / V01..04): cobertura exacta antes de medir y dentro de la transacción; regresión del lote actual de 61 pedidos con PostgreSQL real, sin convertir esa cantidad en límite.
- [x] RV-T02 (BL-052..054 / V05..10): retirar abortos locales arbitrarios, enviar el deadline REST exigido por Google, convertir ventanas/prioridades en preferencias y permitir confirmar desde el primer candidato completo medido.
- [x] RV-T03: 330 pruebas, PostgreSQL real con 61 pedidos, cobertura, mutación dirigida 100%, lint, tipos, build, auditoría y E2E local verdes; evidencia en `QA-RUTEO-VOLUMEN.md`.
- [ ] RV-T04: smoke facturable con los 61 pedidos reales en `develop` después del deploy manual del usuario; confirmar 61 asignados, cero omitidos y grupos de cliente intactos.

## Corrección de agrupación por cliente — BLOQUE-RUTEO-POR-CLIENTE.md

- [x] RC-T01 (BL-048/RC01..03,06): regresión reproducida, agrupación por partner de entrega y validación indivisible/consecutiva.
- [x] RC-T02 (BL-049..050/RC04,05,07): grupos opacos en snapshot/tools, flota por grupos y retorno de propuesta inválida a la IA.
- [x] RC-T03 (BL-050/RC08..10): validación transaccional, regresión, PostgreSQL real, Gherkin, cobertura/mutación, 2 E2E de regresión y E2E adicional con los 8 pedidos reales/OpenAI/Google, todos verdes. Agrupación y frontera de persistencia: mutación 100%. Evidencia en QA-RUTEO-POR-CLIENTE.md. Commit/push a develop autorizados por el usuario el 12 septiembre; deploy manual a cargo del usuario.

## Selección Odoo autorizada — BLOQUE-SELECCION-ODOO.md

- [x] SC-T01: autopsia/línea base y muestra live 19.4 done/assigned; contrato 17 por capacidades (C01,C15).
- [x] SC-T02: contratos/validadores y migración v9, backfill, expiración y restricciones (BL-041..046/C11,C12,C17).
- [x] SC-T03: lector por estado, fecha, cantidades, techo y relectura (BL-042,044/C01,C07,C08,C10,C15,C18). La paginación queda cubierta estructuralmente; volumen live >50 pendiente antes de promoción.
- [x] SC-T04: preview/API y confirmación atómica, recibo y reintento (BL-041,043..046/C01..14).
- [x] SC-T05: modal, selección global/indeterminado y estados del tablero; consumidores downstream sin cambios (BL-043,047/C02..04,C09,C10,C14,C16).
- [x] SC-T06: regresiones downstream/manual conservando íntegramente pesos, prioridad, horarios y ruteo existentes (BL-046..047/C08,C14,C16,C19).
- [x] SC-T07: Gherkin, unitarias, integración, E2E live 19.4, cobertura, mutación, seguridad y evidencia (C01..19). Ver QA-SELECCION-PEDIDOS-ODOO.md; preflight live 17 y volumen >50 pendientes antes de promoción.

## Bloque 5C — control de consumo oficial de Google

Especificación: `BLOQUE-5C-CONSUMO-GOOGLE.md`. Sólo sección lateral; sin tarjeta ni
consultas de consumo en el mapa. Google Billing/BigQuery es la autoridad y PostgreSQL
únicamente cachea resultados sustituibles.

- [x] G-T01 (BL-037..039 / G01-09): configuración FinOps separada, OAuth, descubrimiento seguro de exports y cliente BigQuery acotado.
- [x] G-T02 (BL-037..038 / G03, G05, G07-08): query parametrizado, parser estricto, agregado por SKU/ciclo y escalones derivados de Pricing export.
- [x] G-T03 (BL-038..039 / G04-06, G09): migración v8, cache idempotente, lease, backoff, sincronización periódica/manual y auditoría sanitaria.
- [x] G-T04 (BL-039..040 / G01-02, G06, G09): API autenticada GET/POST, privacidad, frescura y estados configurado/desactualizado/error.
- [x] G-T05 (BL-040 / G01, G06-10): navegación y pantalla responsive con costo, créditos, historial y medidores independientes; mapa intacto.
- [x] G-T06 (todas / G01-10): 293 pruebas, PostgreSQL real, Gherkin, E2E, seguridad, 90.40% statements, 93.80% mutación, lint, typecheck y build verdes. Evidencia en `QA-BLOQUE-5C-CONSUMO-GOOGLE.md`.
- [ ] G-T07: configurar Standard + Pricing export e IAM en develop; smoke oficial y evidencia antes de promoción.
- [x] G-T08: regresión develop del contrato real de Pricing Export: aceptar el recurso canónico `businessEntities/Maps`; el filtro anterior `Maps` producía `GOOGLE_CONSUMPTION_RESPONSE_INVALID` y ocultaba uso, cuota y restante aunque ambas tablas existieran.
- [x] G-T09 (BL-076): aceptar el `TIMESTAMP` numérico real de BigQuery REST y forzar representación textual estable desde SQL; conserva validación estricta y último corte válido.

## Bloque 5B histórico — recálculo automático y OpenAI (sustituido)

Especificación histórica: BLOQUE-5B-RECALCULO-IA.md. La hora de salida y el recálculo
durable permanecen; el planificador OpenAI quedó retirado por BL-065..068 y
`BLOQUE-RUTEO-DETERMINISTA.md`.

- [x] R-T01 (BL-032 / R01-03): hora de salida por plan, migración aditiva, API versionada y formulario 24 h.
- [x] R-T02 (BL-033 / R04-07, R09): recálculo durable después de ediciones, invalidación de puntos y compare-and-swap.
- [x] R-T03 (BL-034 / R04-08): recorrido manual conservado, ETA/conflictos y métricas por camioneta.
- [x] R-T04 (BL-035 / R10-13): planificador OpenAI con tools nativas, recuperación y credenciales runtime.
- [x] R-T05 (BL-036 / R14): evaluación de alternativas por espera, tiempo, distancia y paradas con prioridad obligatoria.
- [x] R-T06 (R01-14): puertas locales, PostgreSQL real, contratos de proveedores, E2E, cobertura y mutación verdes. Evidencia en `QA-BLOQUE-5B-RECALCULO-IA.md`; el smoke facturable OpenAI/Google posterior al despliegue permanece explícitamente pendiente.
- [x] R-T07: regresión ROUTING_RESPONSE_INVALID por listas ProtoJSON omitidas en camionetas vacías; normalización, diagnóstico por campo y continuidad del flujo OpenAI. 242 pruebas, 486 mutantes detectados, build/E2E verdes. Evidencia en `QA-FIX-GOOGLE-PROTOJSON.md`.

## Bloque 5 autorizado — optimización vial Google

- [x] O-T01 (BL-026 / S32-33): migración v6 y configuración versionada del punto de salida, con sugerencia runtime y confirmación visual.
- [x] O-T02 (BL-027-028 / S34-35): configuración privada Google, OAuth, constructor de modelo sin peso y parser estricto de Route Optimization.
- [x] O-T03 (BL-029 / S34, S36-37): llamada externa fuera de transacción y aplicación atómica/versionada con métricas, omisiones y auditoría.
- [x] O-T04 (BL-030 / S38-39): UI Armar ruta, salida editable, polilíneas/ETA/km y estado obsoleto tras cambios manuales.
- [x] O-T05 (BL-030): conservar route tokens privados por transición para la futura APK Android; no exponerlos al tablero web.
- [x] O-T06: referencias, errores sanitarios, métricas operativas y documentación de QA/reversión.
- [x] O-T07: unidades, PostgreSQL real, contrato Google, E2E, Gherkin, cobertura, mutación, lint, typecheck y build verdes. Evidencia local en `QA-BLOQUE-5-OPTIMIZACION.md`; smoke facturable posterior al deploy permanece explícitamente pendiente.
- [x] O-T08 (BL-031 / S40): bloquear coincidencias parciales o aproximadas del origen, mostrar el resultado normalizado y exigir domicilio completo; regresión, cobertura, mutación, build y E2E verdes. Evidencia en `QA-BLOQUE-5-OPTIMIZACION.md`.

## Bloque 4 autorizado — clientes, horarios y puntos

- [x] C-T01 (BL-018..019): migración v5, identidad Odoo estable, jerarquía y sincronización paginada compatible por capacidades.
- [x] C-T02 (BL-019..022): búsqueda normalizada, edición versionada, horario de 24 horas, prioridad, ubicación confirmable y archivo/restauración.
- [x] C-T03 (BL-023): resolución única de preferencias en planificador/mapa y exportaciones XLSX de clientes y plan.
- [x] C-T04 (BL-018..024): API y UI compacta completa con estados accesibles, recuperación y auditoría.
- [x] C-T05: puertas locales unitarias, PostgreSQL, contrato, E2E, Gherkin, cobertura, mutación, seguridad, rendimiento, build y evidencia en `QA-BLOQUE-4-CLIENTES.md`. Smoke real Maps/Odoo 17 y 19.4, y aplicación del directorio Excel permanecen condicionados a configuración y preflight explícito.
- [x] C-T06 (BL-025 / S30): editor ocultable con descarte confirmado, directorio a ancho completo, reapertura por selección, ausencia verificable de Importar Excel y controles destructivos compactos/táctiles.
- [x] C-T07 (BL-023 / S31): distintivos de prioridad consistentes en planificador y directorio; Alta amarilla, Media azul y Por horario neutra, con texto y validación E2E de estilos calculados.

## Bloque 3B — planificador compacto, mapa y notas

- Implementados menú plegable, borradores compactos, columnas acotadas y scroll propio.
- Segunda compactación: alta de borrador en modal, barra de trabajo única, avisos
  flotantes y tres pedidos completos visibles a 768 px de alto.
- Tarjetas adaptables más densas, sin truncar datos y conservando 44 px en táctil.
- Modal Google preparado; integración live pendiente de configuración del propietario.
- Notas Studio por contrato QR verificado mediante lectura; sin cambios en Five.
- Evidencia y límites en BLOQUE-3B-PLANIFICADOR.md.
- [x] T22 (BL006 / S41): el conteo dinámico de pendientes de validación Odoo
      dejó de ser una notificación fija que cubría pedidos y ahora vive en el encabezado
      del borrador; contempla cero, singular, plural y ajuste responsive sin cambiar Odoo,
      pedidos ni ruteo. Unidad, navegador real con PostgreSQL, tipos, lint y build verdes.

## Bloque 3A autorizado — BLOQUE-3-PEDIDOS.md

- [x] O-T01: esquema v3, identidad/envíos/flota por día e integridad concurrente.
- [x] O-T02: lectura real Odoo, contratos de esquema, idioma y fechas locales.
- [x] O-T03: API, modal de carga y tablero persistente con asignación.
- [x] O-T04: QA real, Gherkin, regresión, cobertura y mutación crítica.
- [x] O-T05: evidencia en QA-BLOQUE-3A-PEDIDOS.md; sin promoción implícita.

## Bloque 2A autorizado — BLOQUE-2-FLOTA.md

- [x] F-T01 (F01): migración aditiva e integridad de datos anteriores.
- [x] F-T02 (F02..06): dominio/API de unidades, choferes y asignación; versiones, idempotencia y auditoría.
- [x] F-T03 (F07..08): documentos raster privados, límites y permisos.
- [x] F-T04 (F09..10): interfaz compacta y conexión de navegación/planificador.
- [x] F-T05 (F01..10): QA real, cobertura/mutación/regresión, migración local preservando datos; sin commit/push. Evidencia en `QA-BLOQUE-2A-FLOTA.md`.
- [x] F-T06 (F09): control accesible de disponibilidad desde la tarjeta, estado textual permanente y foto privada del chofer asignado con fallback; persistencia y restricciones verificadas por E2E. Evidencia en `QA-BLOQUE-2A-FLOTA.md`.

- [ ] T01 (BL001/S01-03,15): configuración portable, DB propia, migraciones con ownership.
- [ ] T02 (BL002-003/S04-10,17): contraseñas, sesiones, bootstrap, gestión de cuentas y seguridad HTTP.
- [ ] T03 (BL004/S11-12): borradores persistentes, idempotencia, versión y auditoría.
- [ ] T04 (BL005/S13-15): diagnóstico Odoo sólo lectura y company scope.
- [ ] T05 (BL006/S16): interfaz real de acceso/planificación/cuentas/auditoría, estados vacíos honestos; conector Odoo sin pantalla administrativa.
- [ ] T06 (todas): pruebas unitarias, Gherkin, integración PostgreSQL, E2E, cobertura/mutación, build y auditoría dependencias.
- [ ] T07 (BL001): Docker/operación portable, procedimiento backup y promoción sólo autorizada.

No se incluyen cambios a repositorio five, sus entornos, vendedores, precios o V3.

- [x] T10 (BL002 / S20): mínimo 6 caracteres sincronizado en servidor, formularios y mensajes; mantener altas por administradores, comprobar límites, API, login, cobertura y mutación. No cambiar cuentas existentes. Evidencia en QA-CONTRASENA.md.

## Ajuste de interfaz solicitado: fecha de validación

- [x] T14 (BL011, BL006 / S24): carga Odoo con una sola Fecha de validación de pedidos, editable e inicializada con el día civil actual de la zona horaria; el cliente conserva el contrato enviando el mismo día como inicio/fin y el servidor mantiene límites y protección del plan.

## Bloque 3C autorizado — carga manual y retiro recuperable

- [x] T15 (BL015 / S25): carga manual atómica de hasta 50 folios `S` exactos fuera de fecha, reutilizando el adaptador Odoo sólo lectura y compatible por capacidades.
- [x] T16 (BL016 / S26): bote por pedido, confirmación accesible y DELETE transaccional versionado; una recarga Odoo puede recuperar el pedido. El control visual compacto queda en su propia esquina, mantiene el objetivo táctil y no cubre prioridad ni horario.
- [ ] T17 (BL015-016 / S25-26): unidades, PostgreSQL real, contrato estático Odoo, E2E, Gherkin, cobertura, mutación y seguridad verdes; falta smoke read-only de la ruta manual contra develop 19.4 y preflight de producción 17. Evidencia local en `QA-BLOQUE-3C-PEDIDOS-MANUALES.md`.

## Bloque 3D autorizado — independencia, reutilización y borrado de plan

- [x] T18 (BL013, BL015 / S27): retirar «Guardar camionetas» y separar estados; la restricción histórica de no guardar camionetas en carga manual se sustituye por S27 revisado para permitir iniciar un plan sólo con folios.

## Bloque manual en curso — folios independientes y publicación sin reoptimizar

- [x] MA-T01 (S27 revisado): folios + camionetas marcadas en una transacción, con versión, fuente Odoo, flota y auditoría; sin consulta previa por fecha.
- [x] MA-T02 (S39A): primer cálculo manual durable e idempotente al confirmar publicación; después, recálculo automático únicamente de camionetas afectadas mediante huellas v16. Conserva camioneta y orden exactos, no usa Fleet Routing y no publica si falta recorrido vigente.
- [x] MA-T03: barra compacta con Armar ruta junto a Publicar rutas, Cargar pedidos con distintivo Odoo y violeta tenue.
- [ ] MA-T04: pruebas unitarias, PostgreSQL, contrato, E2E, Gherkin, cobertura, mutación, seguridad y QA reproducible antes de commit/push/deploy. Puertas locales verdes (ver `QA-PEDIDOS-MANUALES-RECALCULO-SELECTIVO.md`); validación real de Google/Odoo y despliegue develop pendientes.
- [x] T19 (BL012-013 / S28): migración v4 e idempotencia por plan; permitir el mismo pedido en múltiples planes y eliminar el concepto operativo «en otro plan».
- [x] T20 (BL017 / S29): DELETE versionado y auditado del plan, confirmación accesible y actualización coherente del selector.
- [x] T21 (BL012-017 / S27-29): regresión unitaria, PostgreSQL, contrato API, E2E, Gherkin, cobertura, mutación, seguridad, build y evidencia QA en `QA-BLOQUE-3D-PLANES.md`.

## Ajuste de interfaz solicitado: nombre del borrador

- [x] T13 (BL003, BL006 / S23): bote rojo por carril con modal de confirmación; DELETE transaccional retira sólo la camioneta del borrador y regresa sus pedidos a Sin asignar, conservando datos, orden, flota y Odoo; versión, auditoría, concurrencia, foco y E2E.

- [x] T12 (BL003, BL006 / S22): botón Añadir camioneta en el planificador; operación POST aditiva y atómica, sin retirar carriles ni reasignar pedidos, con disponibilidad, chofer activo, versión, auditoría, vacío accesible y pruebas de concurrencia/E2E.

- [x] T09 (BL006 / S19): densidad compacta del panel y tarjetas con divulgación progresiva; mínimo seis pedidos cerrados visibles a 768 px, detalles y controles bajo demanda, responsive y QA visual. Evidencia en QA-PANEL-COMPACTO.md y BLOQUE-3B-PLANIFICADOR.md.

- [x] T08 (BL004, BL006 / S18): título guardado con «Cambiar nombre», editor bajo demanda, cancelar sin escritura, conservar contrato PATCH; unidades, E2E real, QA visual y regresiones. Evidencia en QA-NOMBRE-BORRADOR.md. No cambia el alcance pendiente del bloque 1.

## Ajuste de interfaz solicitado: conexión Odoo interna

- [x] T11 (BL005, BL006 / S21): retirar del panel la pestaña, diagnóstico y explicación de entornos; conservar conector, configuración runtime, API interna, pruebas de sólo lectura y auditoría histórica. Sin cambios en Odoo, credenciales, V3, ventas o precios. Evidencia en `QA-CONEXION-ODOO-INTERNA.md`.

## APK chofer — primer bloque autorizado el 21/09/2026

- [x] M-T01 (BL-083..087 / M01..M14): auditar asignación real, autenticación existente, costos laterales y herramientas Android; especificar fronteras y escenarios en `BLOQUE-APK-CHOFER-ACCESO.md`.
- [x] M-T02 (M01..M09): migraciones aditivas v10/v11, teléfono mexicano canónico, PIN protegido, enrolamiento automático, desafío, sesión y revocación; sin afectar cuentas administrativas.
- [x] M-T03 (M01..M04): panel «Editar chofer» configura acceso móvil; la APK entra únicamente con teléfono + PIN y fija el HTTPS del entorno por compilación.
- [x] M-T04 (M10..M13): API móvil autenticada expone sólo camioneta, plan y pedidos del chofer; discrepancias y cálculo ausente son explícitos.
- [x] M-T05 (M05..M14): proyecto Android nativo compila APK debug inicial de acceso y ruta real, sin botones de acciones aún no implementadas.
- [ ] M-T06 (todos): automatización local verde y documentada en `QA-BLOQUE-APK-CHOFER-ACCESO.md`; falta smoke test en Android físico antes de cerrar la puerta de salida.

El traspaso de pedidos, eventos de llegada, incidencias, navegación y finanzas
permanecen pendientes de bloques propios. El acceso directo teléfono + PIN
se prepara primero en `develop`; producción requiere su propia aprobación.
## BL-147 — mejora de captura aprobada

- [x] PI-T07: contrato v2, clasificación/comentarios, migración v28 y evidencia 1..3 atómica compatible; legacy/recibo preservado en PG.
- [x] PI-T08: outbox múltiple y formulario compacto con miniaturas, eliminación y pie visible; 95 JVM, 42 mutantes Android detectados.
- [x] PI-T09: faltantes como tarjetas seleccionables; panel con todas las fotos y Excel sin nuevas columnas; doce incidencias en el mismo pedido sin cerrarlo.
- [x] PI-T10: validación automatizada/PG/HTTP, cobertura y APK 0.8.1 completas;
  ejecución Compose/cámara/rotación pendiente por conexión ADB cerrada.
  Evidencia, corrección de expectativa de regresión y procedimiento físico en
  `QA-CAPTURA-INCIDENCIAS-0.8.1.md`. Se integra con BL-148 en develop;
  despliegue y QA físico siguen pendientes del propietario.
## BL-148 — edición/cancelación y saldo de incidencias

- [x] PI-T11: migración v29, enmienda/cancelación idempotente, autorización/CAS y auditoría sin borrar evidencia.
- [x] PI-T12: API/lecturas y desglose Android con saldo neto, alertas y faltantes manuales separados.
- [x] PI-T13: formulario enviado/editado/cancelable, X de foto discreta y outbox recuperable.
- [x] PI-T14: unitarias, PostgreSQL, contrato HTTP, Android, E2E, Gherkin, cobertura/mutación, build APK y evidencia QA automatizada. Instrumentación física pendiente por ADB offline; ver `QA-EDICION-INCIDENCIAS-0.8.2.md`.
- [x] PI-T15: commit/push a develop autorizado; despliegue manual por el propietario.

## BL-149 — revisión de uso real de incidencias

- [x] PI-T16 (PI28..30): cantidades limpias y formulario específico de faltantes con una cantidad/unidad, sin cámara y comentario rápido pertinente.
- [x] PI-T17 (PI31..32): excluir canceladas en consulta/paginación/conteos y destacar Resolver en verde.
- [x] PI-T18: regresiones JVM/PG/HTTP/E2E, cobertura/mutación aplicable, build/lint y APK 0.8.3; evidencia en `QA-INCIDENCIAS-0.8.3.md`. QA físico/instrumentación pendiente por ADB offline; entrega develop para prueba, no certificación de producción.
- [x] PI-T19 (BL-150 / PI33..38): migración30 y eliminación administrativa autenticada, idempotente, con CAS, auditoría; pedidos cerrados conservan cantidades y revisiones.
- [x] PI-T20 (BL-150 / PI33..38): bote rojo/confirmación y validaciones PG, concurrencia, seguridad, contrato/E2E y mutación crítica (39/39 administrativa, 7/7 filtros).

- [x] PI-T21 (BL-150A / PI39..41): fallo INVALID_PRODUCT_LINE reproducido en PG y corregido con exclusión de reporte bajo bloqueos de publicación/ejecución, sin modificar datos históricos; regresión concurrente aprobada.
- [x] PI-T22 (BL-150A / PI42): modal del tema existente, explicación de rutas canceladas, accesibilidad y regresión visual desktop/mobile, 2 E2E aprobados.
- [x] PI-T23 (BL-150A / PI39..42): regresión general 649 aprobadas/1 FCM omitida, dirigida ampliada 8/8 y 100 % de cobertura, E2E 2/2, mutación amplia 96.30 % y repetición focalizada 9/9 tras reforzar bloqueos; lint/build aprobados. Evidencia en `QA-RETIRO-INCIDENCIAS-RUTA-CANCELADA.md`; commit/push develop autorizado, deploy manual por el propietario.
## BL-151 — miniaturas de producto

- [x] PT-T01 (PT01..07): endpoint privado, resolución de identidad sin cambiar snapshot, lector Odoo fijo y caché acotada/deduplicada.
- [x] PT-T02 (PT02..03, PT07..08): campo opcional Android, miniatura y logo Five atenuado, caché privada; mantener clicks/alertas/cantidades.
- [x] PT-T03A (PT01..08): PG/Odoo real 6/6, regresión 29/29, HTTP E2E 1/1 y regresión de incidencias 2/2, 100% líneas dirigidas; mutación crítica TS 37/37 y Android 4/4; JVM 103/103, build/lint y APK 0.8.4. Evidencia en `QA-MINIATURAS-PRODUCTO-0.8.4.md`.
- [ ] PT-T03B: validación visual Compose/QA físico. APK de instrumentación compilada; ejecución bloqueada por ADB (`closed`), sin contarla como aprobada. El propietario autorizó expresamente commit/push a develop con esta prueba pendiente a su cargo el 2026-09-29. Deploy manual del propietario; no certificación de producción.

## BL-152 — corrección acotada autorizada

- [x] RF-T01 (RF01..06): máximo durable y asignación de revisión sin reusar ejecución; migración automática aditiva y regresión PG 3/3, preservando rutas activas e historial.
- [x] RF-T02 (RF07..08): normalizar foto real grande conservando límites, permisos y contrato de APK; Odoo real validado sin escrituras.
- [x] RF-T03: 9/9 pruebas dirigidas, cobertura de líneas 100%, mutación 15/15, HTTP 3/3, typecheck/lint/build y bundle de migración aprobados. Suite general: 661 aprobadas, 1 timeout de limpieza PG aprobado al repetirlo sin cambios, 2 omitidas (Odoo aprobado por separado; FCM no afectado). Salvedad y evidencia en `QA-RECREACION-RUTA-Y-FOTO-ODOO.md`. Commit/push a develop autorizados por el propietario el 2026-09-29 tras informar los resultados; sin modificar ruta remota ni desplegar.
## BL-153 — color de iconos en Tu ruta

- [x] RC-T01: tintes explícitos azul/rojo/lima/dorado en los cuatro iconos originales; sin modificar métricas ni acciones.
- [x] RC-T02: APK 0.8.5/code27 compilada, JVM 103/103 y lint 0 errores/33 advertencias existentes. Contraste de los cuatro tintes 9.18:1..12.70:1; vectores sin cambios. Entrega en `.local/releases/Five-Rutas-Chofer-0.8.5-develop.apk`; QA visual física pendiente (ADB offline). Evidencia en `QA-ICONOS-RUTA-0.8.5.md`.

## BL-154 — regreso a bodega

- [x] WB-T01: origen real autorizado, sin reescribir publicaciones; regresión PG/HTTP confirmada.
- [x] WB-T02: aviso/botón/SDK bodega con guardas de IDs, estados, callbacks y restauración. BL-155 amplía a reprogramados terminales, nunca entregados.
- [x] WB-T03A: 53 dirigidas, 110 JVM, HTTP2/2, cobertura crítica100%, mutación Android13/13 y APK0.8.6. Evidencia en `QA-REGRESO-Y-CIERRE-BODEGA-0.8.6.md`.
- [ ] WB-T03B: instrumentación/QA físico pendiente por ADB `closed`; no se declara aprobada ni autoriza deploy.

## BL-155 — cierre y reprogramación remota (ampliación solicitada)

- [x] WF-T01: migración32, cierre transaccional inmutable/recibos, lecturas y rechazo de nuevas operaciones; reprogramación remota sólo caso cerrado real.
- [x] WF-T02: botón/modal/GPS/cola cifrada y relectura, estado terminado en app/control, detener guía/seguimiento; consultas y datos conservados.
- [x] WF-T03A: PG/HTTP/JVM, cobertura crítica100%, mutación32/32 política y10/10 integración, build/lint/audit runtime0 vulnerabilidades, APK0.8.6/code28; QA documentado. Regresión general: 669 aprobadas inicialmente; 3 fallos de preparación de bases antiguas corregidos sólo en fixture y sus 2 archivos repetidos completos (16/16); 672 escenarios aprobados y 2 omitidos, con recuperación explícita en QA.
- [ ] WF-T03B: QA físico/instrumentación pendiente por ADB `closed`; no certificación de producción. El propietario autorizó expresamente commit/push a develop para probar el 2026-09-29, con esta salvedad informada; deploy manual del propietario, sin cambios en main.

## BL-156 — bodega en seguimiento administrativo

- [x] WD-T01 (WD01..08,10): metadato nullable/migración33, validar origen/terminales/ETA, transiciones auditadas y lectura consistente sin tocar negocio; PG/HTTP y mutación verde.
- [x] WD-T02 (WD01..02,06..09): Android comparte destino/ETA real y borra al detener; etiquetas comunes avance/resumen/tiempos, APK0.8.7/code29 compilada, firma compatible; 116 JVM y mutación13/13. QA física separada y pendiente.
- [x] WD-T03A (WD01..10): 42 dirigidas, 679 regresión/0 fallos/2 omisiones externas anteriores, HTTP2/2, 116 JVM; cobertura crítica100%, ramas agregadas99.19%; mutación289 políticas +8 PG +13 Android, todas detectadas. Typecheck/lint/build/audit y evidencia en `QA-REGRESO-EN-VIVO-0.8.7.md`.
- [ ] WD-T03B: GPS/SDK físico; no declarar listo producción sin evidencia. El propietario autorizó expresamente commit/push a develop para probar el 2026-09-29, con esta salvedad y las dos omisiones externas anteriores informadas; deploy manual del propietario, sin cambios en main. Autorización permanente para subir a develop los cambios solicitados y verificados, registrada en AGENTS.md; main sólo con instrucción explícita.

## BL-157..159 — liquidación, bloque 1 aprobado el 2026-09-30

- [x] F-T00: autopsia de código/Odoo real, propuesta y aprobación del usuario («dale»). Base develop485ab3f, Five excluido.
- [x] F-T01: contrato monetario e identidad estable, lectura Odoo coherente por IDs; dos pedidos reales y redondeo S00093 verificados.
- [x] F-T02: migración34 aditiva, cola automática e historial inmutable; upgrade/repetición/rollback comprobados con PG real.
- [x] F-T03: sincronizador exclusivo, recuperación, backoff y métricas; desconexión real durante RPC y aislamiento de objetivos fallidos verificados.
- [x] F-T04: consulta autorizada de servidor, sin activar UI/cobros; HTTP real activa seguimiento automático y conserva snapshots operativos.
- [x] F-T05: Gherkin LQ01..14;108/108 financieras con PG/Odoo reales,787 regresión/0 fallos/3 omisiones externas identificadas (financiera aprobada aparte),3/3 E2E,99.62% líneas/99.24% ramas,598/606 mutaciones de dominio y12/12 PG. Evidencia/límites en QA-FUENTE-FINANCIERA-BLOQUE-1.md.
- [x] F-T06: revisión independiente final; typecheck/lint/build/bundle aprobados, audit0 vulnerabilidades, escaneo de credenciales sin coincidencias. Commit/push develop bajo autorización permanente; sin deploy ni cambios en main. Dos integraciones externas preexistentes ajenas al bloque permanecen omitidas, identificadas en QA.

Los bloques2..6 están implementados; la evidencia de cobros, roles, solicitudes, recepción e historial se registra en QA-LIQUIDACION-COMPLETA-0.8.9.md. La QA física de dispositivo sigue pendiente a cargo del propietario.

## BL-157..161 — bloque 2 aprobado («dale al bloque 2 y probamos completa»)

- [x] PF-T00: autopsia de publicación/import/trigger/captura/ViewModels/eventos, plan y matriz PF01..18 antes de implementación.
- [x] PF-T01: contrato/proyección/reparto decimal con identidad, estados y valores conservados (PF01..06,10,11,14,18).
- [x] PF-T02: migración35, referencias/elección de reposición, validación SQL, historia y compatibilidad (PF07..10,12..15).
- [x] PF-T03: lectura autorizada y comandos versionados atómicos (PF01,04..15).
- [x] PF-T04: fingerprint/heartbeat y actualización de ambos consumidores Android (PF01,09,11,16).
- [x] PF-T05: fichas/captura/resumen accesibles y APK0.8.8 (PF04..06,09,11,14,17).
- [x] PF-T06A: QA automatizado unitario/PG/Odoo/HTTP/JVM, cobertura/mutación/regresión/seguridad y evidencia final en QA-IMPORTES-CHOFER-BLOQUE-2.md. Excepción de dispositivo aprobada por el propietario el 2026-09-30; commit/push develop autorizado, deploy manual.

- [ ] PF-T06B: QA físico/Compose asumido por el propietario al completar bloques3..6, autorizados expresamente el 2026-09-30.

## BL-162..168 — bloques3..6 autorizados el 2026-09-30

- [x] CF-T01 (bloque3, CF01..06,14): contrato, esquema36, autorización histórica, confirmación y recibos inmutables; API y captura Android.
- [x] CF-T02 (bloque4, CF05,07,08,14): esquema37, roles, formularios, principal/eventos y aislamiento de endpoints.
- [x] CF-T03 (bloque5, CF09..15): esquema38, solicitudes/decisiones/reservas, lecturas, métricas y panel agrupado.
- [x] CF-T04 (bloque5, CF04,05,09..13,15): tarjeta móvil, detalle y recuperación durable, cambios automáticos.
- [x] CF-T05 (bloque6, CF01..16): 855 pruebas de regresión aprobadas/0 fallos/3 omisiones externas, 28 dirigidas, 125 JVM y E2E HTTP completo; cobertura 99.55% líneas/98.78% ramas, mutación 164/165 políticas +14/14 PG +13/13 Android. Typecheck/lint/build, seguridad, migrador y APK0.8.9/code31 verificados; entrega develop bajo autorización permanente. Evidencia y límites en QA-LIQUIDACION-COMPLETA-0.8.9.md; sin deploy.
- [ ] CF-T06: QA física final a cargo del propietario; excepción informada aprobada, no certificación de producción.

## BL-169 — simplificar captura y ampliar tarjetas de pago
- [x] PC-T01 (PC01,04,05): tarjetas grandes con emojis, selección accesible y campo por medio.
- [x] PC-T02 (PC02,03,06): captura neta sin cambio, payload validado y regresiones de vacío/precisión/saldo.
- [x] PC-T03: 127JVM, 28contrato/PG, 6mutantes detectados, política100%líneas/95.71%ramas, Compose compilado, lint/build y APK0.8.10 compatibles. Evidencia en QA-CAPTURA-COBRO-0.8.10.md; QA física del propietario, commit/push develop autorizado sin deploy.

## BL-170 — formularios de cuentas sin correo obligatorio
- [x] AC-T01 (AC01..03): semántica HTML explícita, secciones/IDs únicos y ayuda de usuario interno en ambos roles, contrato intacto.
- [x] AC-T02 (AC01..05): alta/login y permisos E2E real para ambos roles1/1(21.4s), validación HTML, typecheck/lint/build aprobados. Causa Brave y límite documentados en QA-CAMPOS-CUENTAS-2026-09-30.md; commit/push develop, deploy manual.

## BL-171..174 — sincronización y cobro antes del cierre

- [x] CP-T01 (BL171, CP01..04): actualizar borrador desde worker Odoo con identidad, locks, conservación y eventos; unidad/PG/Odoo lectura.
- [x] CP-T02 (BL172, CP05..07,13): atención+cobro atómicos, recuperación histórica, guardas bodega y outbox; PG/HTTP/JVM.
- [x] CP-T03 (BL173, CP08,12): combinado, versión de captura, SQL/componentes/totales exactos y migración compatible; unidad/PG/mutación.
- [x] CP-T04 (BL174, CP09..12,14): recepción individual durante ruta activa, tarjetas/detalle/modales/estado en tiempo real; permisos y E2E.
- [x] CP-T05 (todos): Gherkin y QA reproducible; 894 regresión/0 fallos/3 omisiones externas identificadas, Odoo real aprobado aparte, 55 financieras/14 origen/131 JVM y HTTP completo. Cobertura financiera99.60% líneas, origen100%; mutación254/255 monetaria (superviviente equivalente),139/139 origen,20/20 PG financiera,9/9 PG origen y22/22 Android. Typecheck/lint/build/audit/migrador y APK0.8.11/code33 verificados. Evidencia y límites en QA-COBRO-POR-PEDIDO-2026-09-30.md; entrega a develop autorizada, deploy manual y QA física a cargo del propietario según excepción vigente.

## BL-175..178 — liquidación clara, aprobado 2026-10-01

- [x] LC-T01 (LC01..03): worker/PG/SSE/DOM con pedido sin asignar, Odoo real sólo lectura; actualización automática verificada y cadencia normal aproximada1–2min documentada.
- [x] LC-T02 (LC04..07): formato exacto y descuentos por identidad, snapshot intacto; 7 pruebas, cobertura100%, mutación125/128 (reparto79/79).
- [x] LC-T03 (LC08..11): tarjetas compactas sin recuadro interior, una actualización, filtros/página12, modal con pedido completo/totales/incidencias amarillas; 2/2 E2E incluyendo50 pedidos, rol y geometría real.
- [x] LC-T04 (LC04..12): Android equivalente, sólo entregados/cobrados; 132JVM, 11mutantes, lint/build/APK0.8.12/code34 y firma compatible; Compose compilado, ejecución física pendiente por excepción del propietario.
- [x] LC-T05 (todos): 902 regresión/0 fallos/3 omisiones externas identificadas, Odoo real aprobado aparte; Gherkin, typecheck/lint/build/audit0 y métricas/QA reproducible en QA-LIQUIDACION-CLARA-2026-10-01.md. Entrega develop/APK autorizada; QA física y deploy del propietario.
- [x] LC-T06: Cantidad final usa physicalRemaining congelado, no quantity original; regresión roja/verde PG/HTTP1/1 y 41 pruebas de política/formato aprobadas. Next/TypeScript/lint y escaneo cliente verdes; evidencia añadida a QA-LIQUIDACION-CLARA-2026-10-01.md. Ajuste exclusivo del modal web, sin nueva APK.

- [x] LC-T07: orden estable por cobro confirmado, incorporación a la derecha; flecha roja y tarjetas web más compactas. 55 pruebas PG/contratos y2 E2E verdes, evento374ms sin desplazar tarjetas; unidad100%/mutación5de5. Contrato operativo conserva orden de paradas.
- [x] LC-T08: icono superior del mismo modelo financiero, spinner de lectura, retorno con borde lima y tarjetas compactas. 134JVM, mutación3de3, lint/build/Compose compilado; APK0.8.13/code35 firma compatible. QA física por excepción del propietario; evidencia en QA-LIQUIDACION-CLARA-2026-10-01.md.
- [x] LC-T09: Android retorno junto a encabezado, Atrás del detalle vuelve al listado financiero; tres métodos en fila de tarjetas cuadradas y signo de pesos en acceso. 138JVM/0 fallos, retorno100% líneas/ramas y mutación4de4; lint0 errores/35 avisos previos, app/Compose compilados. APK0.8.14/code36 y firma compatible; QA física del propietario por excepción vigente. Evidencia en QA-LIQUIDACION-CLARA-2026-10-01.md; entrega develop autorizada, sin deploy.
- [x] LC-T10/LC17: Android cantidad final del snapshot, devolución total y precisión física sin inferir unidades del dinero. 140JVM/0 fallos, selector100% líneas y mutación2de2; Gherkin/lint0 errores/35 avisos previos, APK0.8.15/code37 y firma compatible. QA física por excepción del propietario; evidencia en QA-LIQUIDACION-CLARA-2026-10-01.md.

Liquidación completa: reglas confirmadas por el propietario; especificación en
PROPUESTA-LIQUIDACION-RUTA-2026-10-01.md, CP12 conservado.
- [x] FW-T01: previsualización revisada, cierre durable separado, esquema40 aditivo, servidor/SQL/roles/idempotencia/eventos; LR02..12,14..24. Política y comando100% líneas/ramas, 93/93 mutaciones de política y10/10 guards PG nuevos detectados; migración repetible y aislamiento comprobados.
- [x] FW-T02: tarjeta visible de recepción de ruta y modal con pedidos/tickets, confirmación completa y actualización automática; LR02,04..06,09..14,17,22. Tres E2E HTTP/Chrome/PG aprobados, incluyendo50 pedidos y recepción individual después de rechazo agrupado.
- [x] FW-T03: acción de ruta al final, modal/recuperación, Finalizar trabajo tras recepción y Buen trabajo con resumen real; LR02..08,13,16..20,24. 140JVM verdes, app/instrumentación compiladas y APK0.8.16/code38 firmada con certificado compatible; ejecución Compose física por excepción vigente del propietario.
- [x] FW-T04: Gherkin y QA reproducible en QA-LIQUIDACION-RUTA-0.8.16.md; 922 regresión/0 fallos/3 omisiones externas preexistentes, 72 financieras/PG, cobertura99.69% líneas/98.34% ramas y20/20 guards PG anteriores detectados. Seguridad, typecheck/lint/build/migrador/audit0 y métricas locales verificados. Entrega develop autorizada; sin deploy.
- [ ] FW-T05: QA física Android y despliegue a cargo del propietario según excepción informada vigente; seguir QA-LIQUIDACION-RUTA-0.8.16.md. La compilación no certifica ejecución en dispositivo.

## BL183 — prueba temporal sin bodega, autorizada 2026-10-01

- [x] TB-T01: configuración real esquema41, política compartida con SQL y comandos; TB01..09. 80 PG/contratos verdes, política/lectura/comando100% líneas/ramas,115/115 mutaciones de política y7/7 guards PG detectados; restauración/migración/replay e inconsistencia histórica probados.
- [x] TB-T02: acciones al final Android y modo devuelto por servidor; recepción y resumen completos sin fabricar cierre operativo; TB01,04,05,10. 143JVM/0 fallos, visibilidad100% líneas/ramas y3/3 mutaciones; cuatro E2E reales aprobados con/sin bodega,50 pedidos y recepción individual. APK0.8.17/code39 firmada compatible; instrumentación compilada, QA física por excepción vigente del propietario.
- [x] TB-T03: TB01..10, Gherkin y QA reproducible en QA-LIQUIDACION-PRUEBA-0.8.17.md; 930 regresión/0 fallos/3 omisiones externas preexistentes, 80 financieras, 143JVM y cuatro E2E reales aprobados. Política/lectura/comando/visibilidad100% líneas y ramas;115/115 mutaciones de política,7/7 SQL/configuración,1/1 guarda financiera modificada y3/3 Android detectadas. Typecheck/lint/build/migrador/audit0 y APK0.8.17/code39 compatible verificados. Entrega develop autorizada, sin deploy; QA física por excepción vigente del propietario.

## BL184..185 — cierre de ruta conectado, autorizado 2026-10-01

- [x] CR-T01: modal Android ancho, tres métodos sin scroll lateral/cifras recortadas; CR11..12. Pruebas Compose compiladas; ejecución física bajo excepción vigente del propietario.
- [x] CR-T02: cierre financiero terminal en dashboard/publicación/live/guardas; CR01..09, históricos automáticos, locks/replay e historial. 84 financieras/PG,13/13 mutaciones servidor y cuatro E2E reales verdes.
- [x] CR-T03: reconciliación/eventos Android, QA reproducible y Gherkin; CR01..12. 934 regresión/0 fallos/3 omisiones externas existentes,148JVM,100% líneas/ramas de selector/comando/transición y7/7 mutaciones Android; typecheck/lint/build/audit0 y APK0.8.18/code40 compatible. Evidencia en QA-CIERRE-RUTA-0.8.18.md. Develop autorizado, sin deploy; QA física del propietario por excepción vigente.

## BL186..187 — varios borradores del mismo día, autorizado 2026-10-01

- [x] MB-T01: migración42, identidad por intención/reintentos/tombstone, listado estable; MB01..11. Migración transaccional/concurrente/repetible y conservación comprobadas; creación18/18 sentencias y10/10 ramas.
- [x] MB-T02: formulario, selector, exclusión de salida simultánea y mensaje Android; MB12..20. Segunda salida tras recepción/cierre, historial y fotos propios;22/22 mutaciones detectadas,150JVM verdes y APK0.8.19/code41 compatible.
- [x] MB-T03: MB01..22, Gherkin y QA-MULTIPLES-BORRADORES-0.8.19.md. Regresión consolidada955 aprobadas/0 fallos pendientes/3 omisiones externas previas;39 pruebas enfocadas y8 recorridos E2E aprobados. Cobertura100% líneas/95% ramas; typecheck/lint/build/migrador/audit0. Develop autorizado, sin deploy; ejecución física bajo excepción vigente del propietario.

## BL188 — filtros de liquidación, autorizado 2026-10-01

- [x] FL-T01 (BL188): contrato aprobado en FILTROS-LIQUIDACION-2026-10-01.md;
  menú debajo de Auditoría, fecha de ruta fija y controles compactos.
- [x] FL-T02 (FL01..05): roster mínimo autorizado, filtro existente conectado,
  alcance consistente al cambiar/volver/refrescar, comandos intactos.
- [x] FL-T03 (FL01..07): 88/88 financieras, 2/2 E2E reales, 5/5 mutantes PG;
  lectura100% líneas, global financiera99.70% líneas/98.46% ramas. Typecheck,
  lint/build/audit verdes; QA-FILTROS-LIQUIDACION-2026-10-01.md. Entrega autorizada
  a develop, sin deploy ni APK; flujo financiero intacto.

## BL189 — menú lateral móvil, autorizado 2026-10-01

- [x] NM-T01 (NM01..10): diálogo lateral nativo, navegación compartida, estado
  móvil independiente cerrado al entrar, hit-testing y CSS acotado.
- [x] NM-T02 (NM01..12): unidad/Gherkin/cobertura/mutación, navegador real con
  ambos roles, foco, scroll, resize, estado y regresión de pantallas embebidas.
- [x] NM-T03: métricas/QA reproducible, typecheck/lint/build y entrega develop
  conforme a autorización; sin despliegue ni APK.

Evidencia: QA-MENU-LATERAL-MOVIL-2026-10-01.md;26/26 unitarias,100% cobertura
de dos contratos nuevos,33/33 mutaciones,3/3 E2E menú/táctil y7/7 regresión
real sobre el mismo build. Foco completo, texto20px, roles403 y SSE verificados.
Typecheck/build/lint aplicable/audit verdes;0 fallos pendientes. Entrega develop,
sin despliegue ni cambios de liquidación.

## BL190 — continuación y reintentos, autorizado 2026-10-02

- [x] CN-T01 (CN01..05): continuación por posición y menú existente de reintentos.
- [x] CN-T02 (CN06..10): conservar aviso tras lectura fallida, identidad de recibo,
  aislamiento de ejecución, deduplicación y compatibilidad de operaciones.
- [x] CN-T03 (CN01..10): JVM/cobertura/mutaciones, contratos reales PG/HTTP,
  instrumentación compilada, QA y APK compatible. QA física del propietario bajo
  excepción vigente; entrega develop autorizada, sin despliegue.

Evidencia: QA-CONTINUACION-REINTENTOS-0.8.20.md. 161JVM/0 fallos;100% líneas y
ramas en ambas políticas afectadas;34/34 mutaciones;20 contratos PG y2 E2E HTTP
reales aprobados; lint0 errores/35 avisos previos. App e instrumentación compiladas,
APK0.8.20/code42 con firma compatible. Ningún cambio a servidor/esquema/permisos
ni comandos operativos/financieros. QA física del propietario, excepción vigente.

## BL191 — inicio validado por camioneta, aprobado 2026-10-02

- [x] IV-T01: selección de pendientes y guarda transaccional; IV01..06.
- [x] IV-T02: proyección/aviso móvil y actualización existente; IV07..08.
- [x] IV-T03: unidad/PG/HTTP, cobertura/mutación, QA y APK/develop autorizados.

Evidencia: QA-INICIO-VALIDADO-0.8.21.md;11 servidor/PG y162JVM verdes,
selector/lectura y líneas de inicio100%, guardas Android100% líneas/ramas,
10/10 mutantes servidor y6/6 Android;1 HTTP/Chrome real con validación/SSE,
rechazo, inicio, seguridad y recuperación. Typecheck/lint/build verdes;
APK0.8.21/code43 firma compatible. Fotos, publicación/armado de pendientes,
cadencia Odoo y comandos posteriores intactos. QA física por excepción vigente;
entrega develop sin despliegue.

## BL192 — activación validada en el panel, corrección autorizada 2026-10-02

- [x] AVP-T01: Activar ruta y confirmación individual bloqueados por folios propios;
  Publicar rutas conserva activación de completas y avisa las camionetas omitidas.
- [x] AVP-T02: guarda transaccional autoritativa; aislamiento, estados desconocidos,
  legado, roles, revisiones, replay y worker/concurrencia verificados.
- [x] AVP-T03:10 unidad/PG,2 recorridos HTTP/Chrome reales,100% política nueva,
  10/10 mutantes; typecheck/lint/build y QA verdes. Entrega develop autorizada.

Evidencia: QA-ACTIVACION-VALIDADA-PANEL-2026-10-02.md. Corrige la interpretación
de publicación permitida de BL191. Última validación→botón habilitado por SSE
221ms local, sin modificar el intervalo de Odoo. No cambia Android, liquidación,
recorrido ni esquema; no se genera APK ni se despliega producción.

## BL-ZD01..03 — zonas y descarga, autorizado 2026-10-02

- [x] ZD-T01: migración43/contrato/editor, permisos/versionado y compatibilidad.
- [x] ZD-T02: duración de visitas, recálculo, huellas e invalidación.
- [x] ZD-T03: zonas de proximidad, modelo Google y recuperación con la misma asignación.
- [x] ZD-T04: regresión consolidada 1,004 aprobadas/3 omisiones externas;
  cobertura nueva 100%, mutaciones14/14, E2E2/2, lint/typecheck/build aprobados.
  Evidencia: QA-ZONAS-DESCARGA-2026-10-02.md. Entrega develop, sin deploy.

## ZH — zonas flexibles y horarios, autorizado 2026-10-02

- [x] ZH-T01: preferencias geográficas, duración total y flota dinámica.
- [x] ZH-T02: aviso de atrasos previstos con snapshot vigente.
- [x] ZH-T03: comparación Google real, puertas de calidad y develop.

Especificación: BLOQUE-ZONAS-HORARIOS.md. Clientes de prueba sólo en evidencia;
ninguna regla especial ni cantidad fija de camionetas en producción.

Evidencia: QA-ZONAS-HORARIOS-2026-10-02.md; 44/44 pedidos, Google real en una
solicitud, reparto 5/10/29→13/15/16 y atrasos18→4, con +4.039km observados.
1,015 regresiones aprobadas/3 omisiones externas; 100% cobertura crítica,
29/29 mutaciones detectadas, 3 E2E reales y typecheck/lint/build verdes.
El aviso distingue previsión y recuperación; no oculta atrasos. Entrega
develop autorizada, sin guardar el experimento remoto, APK ni despliegue.

## PH — corrección de atrasos y vueltas, autorizado 2026-10-02

- [x] PH-T01 (PH01..08): regresión roja y opciones de visita con costo fijo
  dinámico; servicio, prioridades, flota y cobertura conservados.
- [x] PH-T02 (PH04,06,09..10): política versionada, contratos, persistencia y
  seguridad existentes; una solicitud Fleet por cálculo.
- [x] PH-T03 (PH01..11): caso real Google, cobertura/mutación, PG/HTTP,
  regresión, lint/typecheck/build y QA reproducible antes de entregar develop.

Especificación y matriz: BLOQUE-PREFERENCIA-HORARIOS.md. Sin cambios a main ni
despliegue; el propietario despliega manualmente.

Evidencia: QA-PREFERENCIA-HORARIOS-2026-10-02.md. Google real 44/44, cero atrasos,
cero conflictos de prioridad y 228.703 km. Modelo final idéntico; 72 contratos,
100% cobertura crítica, 26/26 mutaciones, 1,021 regresiones aprobadas/3 omisiones
externas preexistentes y 2 E2E reales. Typecheck/lint/build y auditoría de
dependencias aprobados; p95 del modelo 72.52 ms. Entrega develop autorizada.

## RA — recepción anticipada y punto único, autorizado 2026-10-04

- [x] RA-T01: reproducción roja; apertura informativa, cierre por miembro y
      punto físico indivisible; servicio y evaluación manual coherentes.
- [x] RA-T02: una llamada Google real con 44/44 pedidos, 39 visitas físicas,
      cero puntos compartidos entre camionetas, cero revisitas y 220.678 km.
      Tres atrasos de tráfico explícitos; no se declara puntualidad perfecta.
- [x] RA-T03: contratos, cobertura, mutaciones, Odoo/PG/HTTP, regresión y QA
      comprobados antes de entrega a develop. Sin deploy ni APK.

Evidencia y límites: QA-RECEPCION-ANTICIPADA-2026-10-04.md. Política v5 sustituye
la interpretación rígida de apertura de PH. El déficit temporal que Google marca
por tráfico se propaga a las llegadas/regreso y auditoría sin perder su reparto.
Los cierres, clientes, descarga y prioridades conservan datos originales.

## SP — prioridad individual estricta, autorizado 2026-10-04

- [x] SP-T01: autopsia y regresión roja del punto mixto; altas, medias y por
  horario por camioneta, conservando asignación y clientes contiguos.
- [x] SP-T02: medición real de los vehículos reordenados, revisión de cobertura,
  punto único, descarga, cierres, recuperación, reservas y versiones.
- [x] SP-T03: escenarios SP01..12, cobertura, mutaciones, Odoo/Google/PG y
  HTTP/Chrome reales; QA, regresión y controles estáticos antes de develop.

Evidencia: QA-PRIORIDAD-ESTRICTA-2026-10-04.md. 44/44 pedidos reales, reparto
11/16/17 conservado, una camioneta recalculada, cero inversiones y cero puntos
compartidos entre camionetas; una revisita exigida por la prioridad individual.
Un atraso previsto de 481 s permanece visible. Política v6 sustituye el rango
promovido del punto de RA; el conteo v5 no certificaba prioridades individuales.
245 contratos afectados y una prueba real aprobados, 100% cobertura nueva,
56/56 mutantes, 1061 regresiones consolidadas, 37 contratos posteriores de
publicación/ejecución y un E2E final. Typecheck/lint/build/audit verdes.
Entrega a develop autorizada; despliegue y nuevo armado a cargo del propietario.
