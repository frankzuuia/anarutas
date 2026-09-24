# QA — avisos FCM de ruta al chofer (develop)

## Autopsia y alcance

La APK recibía cambios por SSE sólo mientras estaba visible. Android no garantiza que ese canal siga vivo en segundo plano, de modo que publicar o retirar una ruta no podía avisar con la app cerrada. Se añade FCM como transporte de dos avisos, sin reemplazar el dashboard autenticado como fuente de verdad. La intención de envío nace dentro de la transacción de publicación; el envío externo ocurre después del commit y no puede revertir la ruta.

Firebase develop: proyecto `ana-rutas-five-dev-2026`, paquete Android `com.five.anarutas.driver`. El servidor usa una cuenta dedicada con el rol personalizado `anaRutasFcmSendOnly`, cuyo único permiso es `cloudmessaging.messages.create`. El JSON privado se guarda fuera de Git y sólo debe configurarse en `ana-rutas-develop/app` de EasyPanel en Brave. No tocar producción.

## Criterios de aceptación (Gherkin)

```gherkin
Característica: avisos nativos de rutas sin confiar en el contenido push
  Escenario: publicar una ruta para un chofer registrado
    Dado un dispositivo autenticado y registrado para ese chofer
    Cuando el administrador publica y confirma la ruta
    Entonces queda una entrega durable para ese dispositivo tras el commit
    Y el aviso dice que hay una ruta, sin incluir clientes, teléfonos ni direcciones
    Y al abrir la APK se consulta el dashboard autenticado y aparece la versión vigente

  Escenario: transacción fallida o publicación idéntica
    Dado un intento de publicar una ruta
    Cuando la transacción revierte o no cambia la revisión publicada
    Entonces no queda una nueva entrega FCM

  Escenario: retiro o cancelación administrativa
    Dado que el chofer recibió una ruta
    Cuando administración la retira o cancela
    Entonces se encola un aviso de retiro para ese chofer
    Y al abrir la APK la ruta ya no aparece como activa

  Escenario: reasignación de chofer
    Dado que una ruta pertenece al chofer A
    Cuando administración la reasigna al chofer B
    Entonces A recibe retiro y B recibe publicación
    Y ninguno recibe pedidos ni datos privados del otro en el payload

  Escenario: cambio obsoleto y edición ajena
    Dado un aviso pendiente de una revisión vieja
    Cuando la publicación ya pertenece a otro chofer o fue revocada
    Entonces el worker descarta el aviso obsoleto antes de enviarlo
    Y iniciar ruta, tomar fotos o cambiar otra camioneta no genera avisos de ruta

  Escenario: cierre de sesión, revocación y FID inválido
    Dado un dispositivo registrado
    Cuando su sesión termina, se revoca su acceso o FCM devuelve UNREGISTERED
    Entonces no se envían más avisos a ese registro
    Y no se afecta el registro de otro dispositivo legítimo

  Escenario: FCM caído, reinicio o dos workers
    Dado un envío pendiente
    Cuando FCM falla transitoriamente o reinicia el proceso
    Entonces la entrega permanece durable y se reintenta con retroceso hasta caducar
    Y dos workers no reclaman simultáneamente la misma fila

  Escenario: permiso Android negado
    Dado que el chofer niega permiso de notificaciones
    Cuando se publica su ruta
    Entonces no se promete aviso en la bandeja del sistema
    Pero al abrir la APK el dashboard carga la ruta vigente
```

## Procedimiento reproducible

1. Ejecutar `npm run lint`, `npm run typecheck`, `npm run build` y `npm run test:coverage` en `develop` local. Registrar pruebas pasadas, cobertura global y de `route-push.ts` y `route-push-registration.ts`.
2. Ejecutar `npm run test:mutation:route-push`. Inspeccionar supervivientes; la decisión de destinatario y el rechazo de identificadores inválidos son rutas críticas.
3. Ejecutar el E2E móvil HTTP (`npm run test:e2e -- --grep "admin provisioning"`): un POST anónimo al registro debe devolver 401, FID inválido 400, y el autorizado debe quedar ligado a su dispositivo. Publicar y revocar en PostgreSQL real.
   Para el contrato externo sin mocks, ejecutar `npx vitest run tests/route-push.test.ts` con `ANA_RUTAS_LIVE_FCM_QA=1` y las dos variables `RUTAS_FIREBASE_*` cargadas temporalmente desde el JSON privado local. Se usa un FID aleatorio inexistente: debe responder `UNREGISTERED`, sin entregar una notificación física.
4. Ejecutar en Android `:app:testDebugUnitTest :app:lintDebug :app:assembleDebug`; comprobar paquete, versión, firma y SHA-256 del APK de develop.
5. En EasyPanel **develop de Brave**, añadir `RUTAS_FIREBASE_PROJECT_ID` y `RUTAS_FIREBASE_SERVICE_ACCOUNT_JSON_BASE64`, guardar y hacer Deploy manual tras el push a `develop`. Nunca pegar el JSON o su base64 en Git, chat, capturas o logs.
6. Instalar el APK encima del anterior sin desinstalar. Abrir la app, autorizar notificaciones, iniciar sesión, cerrar la app y publicar una ruta de prueba. Comprobar aviso nativo y ruta visible al abrir. Retirar la ruta desde el panel y repetir. Probar además permiso denegado, red perdida/reconectada, cierre de sesión y reasignación entre dos choferes.
7. Inspeccionar la cola en PostgreSQL develop (`route_mobile_push_deliveries`): pendientes, entregadas, descartadas y antigüedad de la más vieja; correlacionar con `route_push.batch`/`route_push.send_failed` sin exponer FID ni secretos. Objetivo operativo: p95 publicación→entrega <60 s con red/FCM sanos, alerta si hay pendientes >5 min. La latencia real de sistema Android requiere el teléfono del usuario.

## Evidencia y límites

Resultados locales del 23/09/2026, rama `develop`:

- `npm run lint`, `npm run typecheck`, `npm run build`: verdes; el build incluye `/api/mobile/push-registration`.
- `npm run test:coverage`: 45 archivos, 511 pruebas aprobadas; cobertura global 94.68 % líneas, 87.34 % ramas. `route-push-registration.ts`: 92.30 % líneas; `route-push.ts`: 38.46 % líneas en la suite offline (el transporte externo no se simula).
- `npm run test:mutation:route-push`: 115/115 mutantes detectados, 100 % sobre las decisiones puras. La cola PostgreSQL y el envío externo se validaron por integración, no forman parte de ese porcentaje.
- E2E HTTP de aprovisionamiento móvil: 1/1, incluyendo registro anónimo 401, FID inválido 400 y registro autorizado. Publicación visible en 155 ms e inicio de chofer visible en 215 ms durante esa ejecución local; no son SLO de FCM.
- Integración opcional con OAuth + FCM HTTP v1 **reales**: 8/8 pruebas específicas; FID inexistente recibió `UNREGISTERED`, el worker descartó la entrega y desactivó ese registro, sin avisar a ningún teléfono real.
- Android `:app:testDebugUnitTest :app:lintDebug :app:assembleDebug`: 31/31 pruebas JVM, lint 0 errores/20 advertencias, APK compilada. Auditoría npm de dependencias de producción: 0 vulnerabilidades.
- APK `Five-Rutas-Chofer-0.4.0-develop.apk`, paquete `com.five.anarutas.driver`, versionCode 10, SHA-256 `3C8C134DD89969F9062947861605C7F4DB6505FC12B1E72849DF735E12E79557`; firma debug verificada e idéntica a 0.3.1 para instalación encima.

Pendiente de aceptación: colocar las dos variables FCM sólo en EasyPanel develop, desplegar el commit de `develop`, instalar la APK y comprobar con el teléfono físico notificación al publicar y retirar con app cerrada/abierta. No se certifica todavía entrega física ni producción. La APK visible conserva SSE y reconciliación; FCM añade entrega en segundo plano, sujeta a red, batería, permiso Android y disponibilidad de Google.
