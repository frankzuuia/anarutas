# QA — panel en vivo y fotos por día

Fecha: 23/09/2026. Alcance: develop, BL-100, RT01..08 y MR29.

## Causa demostrada

- La captura enviada muestra **405 al eliminar foto**, no 404. La consulta OPTIONS de sólo lectura al endpoint móvil en develop devolvió `GET, HEAD, OPTIONS`: el servidor desplegado aún no tenía el DELETE del commit `d2841e0`. La corrección es desplegar el backend compatible, no desproteger la foto ni cambiar DELETE por un método incorrecto. El DELETE real pasa pruebas HTTP, permisos, carrera contra Inicio y conteo 5→4→5.
- El inicio móvil modifica la publicación, no la versión del plan. El panel dependía de esa versión o de Actualizar; por eso no veía Inicio automáticamente.
- Una recarga real en la pestaña de Brave conservó la sesión. No se reprodujo una pérdida inmediata por F5. La configuración existente sí caduca tras 30 minutos sin actividad y a las 12 horas absolutas por defecto. El canal visible ahora cuenta como actividad; ocultarlo deja de renovar inactividad. Nunca se omiten revocación ni expiración absoluta.
- El servidor ya filtra fotos por fecha local, plan, unidad, conductor y vigencia. Se agregó regresión de medianoche de México y limpieza de la pantalla Android cuando cambia `serviceDate`; el reloj del teléfono no decide permisos.

## Diseño y límites

Migración aditiva 18: 16 tablas operativas notifican tras commit con una señal constante sin datos privados. Los latidos de sesión no generan notificaciones. Una conexión LISTEN compartida por pool/proceso abastece a los navegadores; cada canal SSE revalida su cookie. Reconectar dispara reset y lectura del estado confirmado. Eventos concurrentes se agrupan; una lectura activa no acumula validaciones detrás de un bloqueo de base de datos. Un cliente que no lee no acumula una cola ilimitada.

El navegador relee la sección visible. No ejecuta sincronización Odoo, Google, optimización ni publicación al recibir eventos. Conserva formularios abiertos y sus versiones de edición: un cambio remoto no autoriza sobrescribir silenciosamente.

La captura móvil de «Llegué» e incidencias todavía no existe. El módulo no inventa incidencias a partir de ETA; deberá conectar su persistencia/eventos cuando se implemente. Este bloque actualiza en vivo los módulos reales existentes, no declara terminada esa funcionalidad futura.

## Comandos reproducibles y evidencia local

1. `npm run test:coverage`: **44 archivos, 497 pruebas aprobadas**. Una ejecución previa falló al limpiar una carpeta temporal PostgreSQL por EBUSY de Windows; la repetición completa terminó con exit 0, sin cambiar ni omitir pruebas ni ocultar el error.
2. `npm run build`, `npm run typecheck`, `npm run lint`: exit 0, sin advertencias de lint.
3. `npx playwright test tests/e2e/driver-mobile.spec.ts tests/e2e/panel.spec.ts`: **3/3 aprobadas** sobre build final, PostgreSQL, HTTP y navegadores reales. Cubre inicio/cancelación sin F5, fotos, dos sesiones, conservación de edición y 409, reconexión tras offline, sesión tras recarga/reinicio, CSRF, revocación y aislamiento de rutas.
4. `npx stryker run stryker.panel-events.config.mjs`: **82.22 %**, puerta ≥80 % aprobada; 45 mutantes, 33 detectados por aserciones, 4 por timeout, 7 sobrevivientes y 1 sin cobertura. Mide autenticación/heartbeat y guardas del listener, no todo el repositorio. Los sobrevivientes incluyen limpieza de la bandera de cambio, cierre concurrente y condiciones defensivas de tipo/status/canal; el fallo de LISTEN tiene un camino no cubierto. No se afirma detección del 100 % ni se cuentan los timeouts como aserciones explícitas.
5. `npm audit --omit=dev --audit-level=high`: cero vulnerabilidades reportadas en dependencias productivas. `npx tsx scripts/quality-metrics.ts`: 357 funciones core declaradas, complejidad máxima estimada 24; 14 artefactos cliente revisados, sin los secretos locales de QA. El estimador no mide callbacks anidados anónimos: no es una certificación de complejidad total ni un escáner exhaustivo de secretos.
6. En `driver-app`, con JDK 17/SDK local: `./gradlew.bat testDebugUnitTest assembleDebug lintDebug --no-daemon`: **18 pruebas Android, cero fallos/errores**, build y lint con exit 0. Android lint conserva **18 advertencias** de dependencias/SDK, orientación, backups, icono, recursos y estilo KTX; no se presentan como resueltas ni se amplía este bloque a una actualización general del stack. APK de pruebas **0.2.4 / versionCode 7**, firma debug, no distribución de producción. SHA-256 `6035FC2D55FB8B79E37137FE1DB4E3F7C1540AA0B28F06FDAFB0AA16B2361551`.
7. `git diff --check`: verde. Escenarios Gherkin en `tests/acceptance-panel-realtime.feature`; MR29 en `BLOQUE-APK-RUTA-PUBLICACION.md`. QA visual de la insignia compacta y recorridos responsive existentes a 375/768/1024/1440 px.

## Métricas

| Área | Líneas | Ramas | Funciones |
| --- | ---: | ---: | ---: |
| Core global medido | 95.54 % | 88.07 % | 97.35 % |
| SSE / sesión | 93.10 % | 82.92 % | 90.90 % |
| Listener compartido | 87.87 % | 91.66 % | 85.71 % |
| Migración de eventos | 100 % | 100 % | 100 % |
| Inicio de ruta | 100 % | 86.66 % | 100 % |
| Fotos de unidad | 93.70 % | 84.81 % | 72 % |

Las puertas globales existentes son líneas/sentencias ≥85 %, ramas ≥80 % y funciones ≥90 %. En seguridad se exigen además casos concretos de autenticación, revocación, expiración, aislamiento y fecha; el promedio no sustituye esas pruebas. Los fallos de conexión, transacciones rollback, revocación y base de datos lenta se ejercitan con PostgreSQL real, sin reemplazar auth o el pool por mocks. Algunos caminos defensivos de cierre simultáneo/error de LISTEN no se fuerzan individualmente; no se afirma cobertura exhaustiva.

Objetivo de propagación local: <2 s con conexión sana. Última ejecución: **208 ms** desde respuesta de Inicio hasta estado visible; ejecuciones anteriores 198/238 ms. Son muestras E2E locales, **no p95 ni SLO productivo**. Los eventos no dispararon llamadas de ruteo ni sincronización de proveedores. Retención de fotos y permisos permanecen sin cambios.

## Entrega y comprobación en develop

- Commit/push sólo a develop tras puertas locales; el usuario ejecuta **Deploy**, sin Rebuild forzado ni acceso a producción. La migración corre mediante el arranque existente. `RUTAS_PANEL_HEARTBEAT_SECONDS` es opcional, default 15; el navegador recibe ese intervalo para detectar un canal estancado.
- Después del Deploy: confirmar que OPTIONS del recurso móvil permite DELETE y que el panel muestra **En vivo**. Si el proxy interrumpe/bufferiza SSE, investigar el canal en develop; la insignia no debe presentarse como verde sin recibir eventos.
- En teléfono físico: actualizar a APK 0.2.4, tomar cinco fotos de hoy, descartar una (conteo 4, Inicio deshabilitado), tomar reemplazo, iniciar y observar el panel sin F5. Tras iniciar, Eliminar no aparece y una petición directa sigue rechazada. Cancelar administrativamente debe retirar la ruta en la siguiente sincronización móvil.
- Al día siguiente en la zona horaria de la instalación: abrir ruta de hoy, fotos de ayer no habilitan Inicio, capturar cinco nuevas. Abrir/cerrar/recargar panel conserva la cookie mientras la sesión siga vigente; revocar sesión debe volver al acceso.
- Pendiente externo: proxy live, cámara/dispositivo físico, volumen real y métricas p95/error bajo carga. El informe habilita pruebas de desarrollo, **no certifica producción**.
