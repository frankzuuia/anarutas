# QA — alarma global y llegadas tarde silenciosas

Fecha operativa: 2026-10-08. Repositorio Ana Rutas, rama develop, base
`49de523`. Bloque autorizado por «Sí, alarma en todo el panel y segundo plano»;
ampliado por las peticiones de color de encabezados y de excluir llegadas tarde
del sonido. Contrato AG01..10: BLOQUE-ALARMA-GLOBAL-2026-10-08.md.

## Causa y cambio revisado

El monitor dependía de LiveIncidentsPanel: desmontar la vista liberaba la última
suscripción y detenía la reproducción. La conexión SSE se cerraba al ocultar el
documento. Ahora Dashboard raíz, exclusivamente con rol routes, conserva la
suscripción entre secciones. Su misma conexión recibe novedades en segundo plano
cuando el sonido está activado; las pantallas ocultas no refrescan datos
operativos. Las pantallas embebidas comparten el almacén y no crean otro SSE.

Las llegadas tarde permanecen en la vista, en PostgreSQL y en Visto compartido.
Sólo el lector de alertas sonoras excluye `late_arrival` tanto al consumir
novedades como al reconciliar una ráfaga. El cursor sigue avanzando sobre sus
notificaciones: un lote silencioso no se repite ni oculta un faltante/devolución
del mismo lote. No hay migración ni modificación del exportador Excel.

Los encabezados por tipo y los apartados inferiores usan ámbar `#ffd080` mediante
dos selectores CSS acotados. Las tarjetas compactas conservan su estructura.

## Entorno real y procedimiento reproducible

Node 24, PostgreSQL 17 aislado por los fixtures existentes, Next compilado y
Chrome local con perfil temporal independiente. No se accede al perfil del
propietario, EasyPanel, producción, Odoo, Google ni OpenAI. No se simulan API,
SSE, PostgreSQL, permisos ni visibilidad del navegador. Las credenciales de QA
son aleatorias y sólo pertenecen a las bases temporales.

Desde la raíz del repositorio:

```powershell
npm run build
npm run typecheck
npm run lint
npm audit --omit=dev
npx vitest run --config vitest.incident-board.config.ts --coverage
npx vitest run tests/panel-events.test.ts tests/account-role.test.ts tests/product-incidents-excel.test.ts tests/product-incident-organization.test.ts tests/product-incidents.test.ts tests/driver-incidence-schema.test.ts tests/route-incidents.test.ts
npx stryker run stryker.incident-alarm.config.mjs
$env:PLAYWRIGHT_JSON_OUTPUT_FILE = '.local/qa/incident-global/final-e2e.json'
npx playwright test tests/e2e/incident-background.spec.ts tests/e2e/product-incidents.spec.ts tests/e2e/control-center.spec.ts --grep 'AG global|AG settlement|TA compact|IO reconnect|IO panel|IO v3|independent drivers' --reporter=list,json
git diff --check
```

El caso AG usa Chrome visible y CDP `noDefaults: true` para evitar la emulación
automática de foco de Playwright. Se comprueba `visibilityState=hidden` con otra
pestaña al frente y con la ventana realmente minimizada. Se retiran los flags de
automatización que desactivan la restricción de temporizadores; no se usa bypass
de autoplay. Los AudioContext, OscillatorNode y GainNode son nativos. Un
AnalyserNode observa PCM no nulo, además de las horas de inicio/fin. Esta
instrumentación conserva los nodos originales y la salida de audio.

## Resultados y métricas

| Puerta | Evidencia ejecutada |
|---|---|
| Núcleo/políticas e integración PG | 5/5 pruebas, con llegada real, tarjeta no vista, cursor silencioso, lote mixto y Visto |
| Regresiones de eventos, roles, contratos y Excel | 30/30 pruebas en siete archivos |
| E2E reales | 7/7, cero omitidas, fallidas o flaky; 183.57 s en la corrida final |
| Cobertura dirigida V8 | 100%: 97/97 líneas, 103/103 sentencias, 76/76 ramas, 26/26 funciones |
| Mutation testing | 23/23 Stryker y 4/4 mutaciones controladas adicionales detectadas |
| Compilación/tipos | Correctos con el código restaurado después de las mutaciones |
| Lint | Cero errores; un warning heredado en stryker.product-amendments.config.mjs |
| Supply chain productiva | `npm audit --omit=dev`: cero vulnerabilidades |
| Vista compacta de muestra | 122.09 px desktop y 155.89 px móvil; encabezados RGB(255,208,128) |
| Complejidad modificada medida | política de visibilidad 3; hook de tiempo real 2 y su aplicación diferida 7; coordinador poll existente 15 |

La cobertura corresponde a incident-board, su esquema/política y la nueva
política de visibilidad; no se presenta como cobertura del repositorio completo
ni del JSX/Web Audio. Umbrales configurados: líneas/sentencias 95%, ramas 90%,
funciones 100%. Se exige validación directa de los caminos de audio/seguridad en
Chrome además del porcentaje de cobertura.

Medidas finales de notificación real hasta crear audio nativo: otra sección
202 ms, pestaña oculta 191 ms, ventana minimizada 194 ms, reconexión oculta
32 ms. Duración nativa minimizada 4,995 ms; duración de 10/15 s en regresión
9,995/14,996 ms. Propagación Visto entre pestañas 226 ms. Objetivos de QA local:
inicio menor de 5 s y final de ráfaga de 5 s antes de 6.5 s; todos cumplidos.
Son muestras de laboratorio, no p95/SLO de producción ni garantía de red.

La llegada tarde real conservó la tarjeta roja/no vista, consumió el cursor y
produjo cero nodos de audio adicionales. Una incidencia de producto posterior
sí produjo sonido. El contrato PG también verifica ambos tipos en el mismo
lote. Las pruebas existentes drenan 105 notificaciones tras una desconexión,
no duplican ráfagas entre pestañas y preservan las duraciones 5/10/15 s.

Seguridad comprobada: rol liquidación sin monitor ni botón de sonido, endpoints
403; después de logout, alertas/eventos 401 y nuevo documento sin audio activo.
Pruebas de eventos conservan la revocación, expiración y reconexión. Identidad de
instalación/cuenta, Web Locks, reserva y Visto concurrente permanecen validados.
No hay cambio de autenticación, entrada pública ni secretos en el diff.

## Mutaciones y fallos de QA resueltos

Stryker: ocho mutantes de la nueva política y quince de la conservación de
ámbito/reserva: todos Killed, sin supervivientes, timeout ni rutas sin cobertura.

Cuatro defectos introducidos deliberadamente y restaurados en `finally`:

1. Cambiar el guard de Dashboard de routes a settlement: E2E falla porque no
   produce el segundo nodo esperado al llegar una incidencia en otra sección.
2. Quitar el despertar del lector desde SSE: el mismo recorrido falla por audio
   ausente. Cada mutación de frontend se compiló antes de probarse.
3. Quitar la exclusión late_arrival de las novedades: IO15 falla al recibir una
   fila sonora donde esperaba cero.
4. Quitar la exclusión de watching: IO15 falla al conservar una secuencia tardía
   en la ráfaga. Ambas ejecutan PG real con `--testNamePattern IO15`.

Para reproducir esas cuatro verificaciones, retirar únicamente el guard/callback
o el predicado indicado sobre una copia local aislada, ejecutar el caso señalado
y restaurar los bytes originales antes del siguiente caso y de compilar/entregar.
Las pruebas deben fallar por esas aserciones, no por un error de compilación.
Se repitió la cobertura original después de restaurar las dos mutaciones SQL.

Durante QA se corrigieron supuestos del harness: Playwright emulaba visible el
documento; logout sin cuerpo JSON obtenía correctamente 415; el menú de
liquidación existe deshabilitado; la búsqueda en la primera página no garantizaba
encontrar una notificación entre más de 100. Se sustituyeron por comprobaciones
reales de visibilidad, petición JSON, botón deshabilitado y secuencia SQL exacta.
La expectativa heredada de triggers se actualizó de 28 a 30 para incluir las dos
tablas de incidencias de la migración 47 ya existente. No se cambió el esquema.

## Evidencia guardada y límites

- `.local/qa/incident-global/final-e2e.json`: siete casos y stdout de métricas.
- `.local/qa/incident-global/regression.json`: regresión final.
- `reports/coverage/incident-board/coverage-summary.json`: cobertura dirigida.
- `reports/mutation/incident-alarm.json`: 23 mutantes Stryker.
- `.local/qa/incident-global/mutation-{root,events,late-source,late-watch}.json`:
  fallos esperados de las cuatro mutaciones controladas.
- `.local/qa/incident-global/complexity.json`: medición estática.
- `.local/qa/incident-compact/desktop.png` y `mobile.png`: evidencia visual.

La auditoría completa conserva cinco alertas heredadas de herramientas de
desarrollo ESLint/braces bajo la excepción de develop ya aprobada y documentada
en QA-TARJETAS-ALARMA-2026-10-08.md. No cambian dependencias ni lockfile.

Entrega limitada a develop mediante commit/push; no deploy, modificaciones de
main, APK, bases remotas ni configuración del propietario. El dueño ejecuta su
deploy y comprueba altavoces/Brave. La señal PCM en Chrome acredita reproducción
nativa, no el volumen de una salida física concreta.

Se necesita Activar sonido con clic por documento. El navegador debe seguir
ejecutándose y permitir audio. Cierre, descarte/congelación de página, reposo del
equipo o salida silenciada impiden prometer un aviso inmediato. Referencias
oficiales: [autoplay](https://developer.chrome.com/blog/autoplay),
[temporizadores en segundo plano](https://developer.chrome.com/blog/timer-throttling-in-chrome-88),
[ciclo de vida](https://developer.chrome.com/docs/web-platform/page-lifecycle-api).
