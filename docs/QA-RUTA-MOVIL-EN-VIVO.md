# QA — entrega automática de ruta al chofer

## Diagnóstico y alcance

La APK anterior consultaba al entrar y cada 30 segundos. Una publicación confirmada ya notificaba al panel administrativo, pero el móvil no tenía canal; Android no recibió push con la app cerrada. Este bloque añade SSE autenticado para la APK visible, huella de publicaciones autorizadas por chofer, reconciliación del dashboard y aviso dentro de la app. La consulta periódica permanece para recuperar cortes. No cambia los cálculos ni invoca Google/Odoo por evento.

El contrato no transporta pedidos, dirección, teléfono ni token en URL: sólo `reset`, `change`, `heartbeat` y `session-expired` con `data: {}`. La sesión se valida al conectar, en cambios y latidos; la lectura de publicaciones usa las mismas condiciones de asignación y actividad que el dashboard. Una publicación idéntica no incrementa revisión y no genera aviso nuevo. La conexión PostgreSQL LISTEN es compartida por proceso; el canal móvil termina ante desconexión, cancelación o revocación.

## Evidencia ejecutada en develop local

| Puerta | Resultado |
| --- | --- |
| TypeScript y Next 16 build | `npm run typecheck` y `npm run build` verdes; endpoint `/api/mobile/events` en build |
| Lint | `npm run lint` verde, sin errores; salida final verificada después de excluir artefactos generados Android |
| PostgreSQL/core | Suite final completa con 503/503 pruebas verdes; prueba focal con 14/14 verdes |
| Cobertura global | 95.55 % líneas, 87.87 % ramas en la suite final |
| Canal móvil focal | 96.05 % líneas, 78 % ramas; partes sin línea: coalescencia de una segunda señal durante una consulta ya en vuelo |
| Mutation testing | 92.31 % (12/13 detectados entre fallos y timeouts) en huella, aviso, latido e identidad inicial; sobrevive un mutante de eficiencia de la bandera `dirty`, no un permiso o payload |
| HTTP/E2E | 2/2; publicación real → evento SSE en 162 ms local, sin F5; acceso sin token 401 |
| Android | 28 unitarias, lintDebug y assembleDebug verdes; parser SSE, nueva revisión y aviso sin duplicado inicial |
| Supply chain | `npm audit --omit=dev --audit-level=high`: cero vulnerabilidades reportadas |
| APK | `0.3.1`/code 9; 67,204,796 bytes, firma v2 verificada y misma huella de desarrollo que `0.3.0`, actualización sin desinstalar |

Artefacto local: `.local/releases/Five-Rutas-Chofer-0.3.1-develop.apk`. SHA-256: `5007A045846B6FA1BF5535F8D1E0F695EC8C4D6A04D39F7B3382B4066E51489C`.

Objetivo proporcional al riesgo: el flujo de publicación/autorización/lectura está cubierto por integración real y E2E; el núcleo nuevo supera 95 % de líneas y 90 % de mutación dirigida. El 78 % de ramas refleja defensas de carrera/desconexión difíciles de forzar sin instrumentar red o pool; no se presenta como cobertura total. El primer barrido de mutación fue 50 % y se reforzaron las pruebas antes del segundo barrido verde.

## QA manual pendiente tras entrega a develop

1. En EasyPanel **de develop en Brave**, pulsar **Deploy** del servicio `ana-rutas-develop/app`; no tocar producción en Chrome. Confirmar que `/api/mobile/events` ya no responde 404 a una sesión móvil vigente.
2. Instalar la APK 0.3.1 sobre la anterior en el teléfono de prueba, sin desinstalar. Abrir Inicio con el chofer autenticado.
3. Publicar una ruta nueva o actualizar su revisión desde el panel. Verificar que aparezca sola y el aviso se muestre sin pulsar Actualizar. Repetir publicación idéntica: no debe duplicar aviso.
4. Cambiar otra camioneta: el chofer anterior no debe recibir su ruta. Retirar o reasignar una ruta: debe salir del dashboard del chofer anterior.
5. Desconectar/reconectar red y reabrir app: `reset` y consulta de respaldo recuperan el estado. Revocar acceso y comprobar que el canal cierra sin exponer datos.
6. Medir en el proxy real el tiempo publicación→pantalla; objetivo operativo <2 s con conexión sana. El dato local de 162 ms no sustituye esa medición.

La prueba física Android/BlueStacks queda a cargo del usuario por su decisión de no habilitar ADB. No se hizo Deploy en EasyPanel ni se tocó producción.

## Pendiente de otra integración

SSE sólo funciona mientras la app está visible. Para la **notificación del sistema con la APK cerrada** hace falta el proyecto Firebase real de `com.five.anarutas.driver`, su `google-services.json` de Android y una credencial de envío del servidor guardada como secreto de EasyPanel; después se requiere registro de token por dispositivo, envío idempotente tras commit, revocación, permiso Android 13+, reintento y QA físico. Sin ello no se declara push implementado. No se mantiene un servicio Android permanente en segundo plano.
