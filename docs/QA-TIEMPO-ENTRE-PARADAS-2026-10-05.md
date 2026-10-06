# QA — tiempo entre paradas

Solicitud aprobada el 2026-10-05. Alcance: consulta en el panel administrador,
sin modificar orden, publicación, comandos del chofer, cobros ni liquidación.
Rama `develop`; despliegue manual del propietario. No requiere nueva APK.

## Resultado comprobado

- 15 unitarias/contratos y 4 integraciones del bloque: **19/19** con PostgreSQL
  aislado y Google Routes real, sin sustituir HTTP ni fabricar tiempos de Google.
- **3/3 E2E** nuevos: sesiones/rol/CSRF/entradas/caché, selección/teclado/móvil,
  avance de parada, pérdida/recuperación de GPS y cuatro pantallas independientes.
- **5/5 E2E** existentes del Centro de control: GPS/ETA, filtros, persistencia,
  geometría, fullscreen y controles. Sin errores JavaScript en el recorrido nuevo.
- **15/15 mutaciones dirigidas detectadas** en copia temporal aislada, incluyendo
  origen vivo, descarga restante, exclusión del destino, orden/tráfico de Google,
  continuidad entre segmentos, invalidación tras la red y recuperación del caché.
  Es un conjunto dirigido a invariantes, no un score exhaustivo Stryker global.
- Typecheck y build de producción verdes. Lint sin errores; un warning previo
  en `stryker.product-amendments.config.mjs`, fuera de este bloque.
- **56/56 regresiones** en 10 archivos: ETA/GPS/bodega, presentación, comandos
  de atención, reintentos, cierre de ruta, cierre de trabajo y segunda ruta diaria.
- `npm audit --omit=dev --audit-level=high`: **0 vulnerabilidades** después de
  actualizar únicamente `source-map-js` 1.2.1 → 1.2.2 en el lockfile. Versión
  compatible con los rangos existentes; sin cambio a `package.json`.
  Referencia del mantenedor:
  https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2
- Auditoría completa de herramientas de desarrollo: 5 alertas altas heredadas
  en la cadena ESLint → fast-glob → micromatch → braces. No son dependencias
  del artefacto productivo; `npm audit` propone degradar ESLint de Next 16 a 14.
  No se ejecuta ese cambio incompatible ni `audit fix --force`.
  Se comprobó además que `braces` no está en `.next/standalone/node_modules`.
  Excepción explícita del propietario el 2026-10-05, conforme a su regla 11:
  «Sí, subir a develop con la excepción documentada». Autoriza commit/push
  manteniendo esas alertas heredadas de herramientas; no autoriza despliegue.
- Tras actualizar `source-map-js`, se repitieron build, las 15 unitarias del
  bloque, lint, auditoría productiva y los **8/8 E2E** en una sola corrida verde.

## Métricas y riesgo

| Métrica del bloque `src/core/live-segment*.ts` | Resultado |
| --- | --- |
| Líneas V8 | 120/123 = **97.56%** |
| Ramas V8 | 145/154 = **94.15%** |
| Funciones V8 | 37/37 = **100%** |
| Sentencias V8 | 155/163 = **95.09%** |
| Política de orden, descarga, GPS y selección | **100% líneas/ramas** |
| Complejidad AST máxima del bloque | **27**, `buildSegmentPlan` |
| Complejidad del servicio / adaptador vial | **9 / 12** |
| 12 consultas concurrentes + cambios de contexto en PG | **208 ms**, corrida enfocada |
| Contrato Google: recorrido real de tres coordenadas | **682 s** de traslado devuelto |
| Grupo de pruebas Google y recuperación | **1,000 ms**, una corrida; no es un percentil productivo |
| Mutaciones en datos de ejecución/paradas/pedidos al consultar | **0** |
| Defectos conocidos abiertos del bloque | **0** en escenarios comprobados |

Objetivo por riesgo: 100% de la política pura que suma tiempos y selecciona
paradas; umbrales del bloque >=85% líneas/sentencias, >=90% funciones y >=80%
ramas, sin usar el promedio para omitir permisos, contexto o recuperación.
Las defensas de cuerpo excesivo/malformado y cuota externa no se provocaron
contra Google: validación de formato se prueba directamente y errores de red
mediante una señal de cancelación real. No se declara un ensayo de cuota ni
una prueba física de tráfico. La disponibilidad del proveedor no es garantizada.

Límites operativos verificables: petición Google con timeout total de 25 s;
vigencia máxima de 60 s; hasta 8 cálculos simultáneos y 128 entradas por
proceso/base. Múltiples réplicas no comparten ese caché. El panel deja de mostrar
un tiempo vigente cuando el GPS supera 30 s en modo Desde ahora. Se vuelve a
consultar cada 60 s o al cambiar contexto; no se extrapolan segundos exactos.

## Evidencia y reproducción

1. `npm run typecheck`, `npm run lint`, `npm run build`.
2. Con `RUTAS_GOOGLE_ROUTES_API_KEY` sólo en el entorno privado y
   `RUN_SEGMENT_GOOGLE_REAL=1`:
   `npx vitest run tests/live-segment.test.ts tests/live-segment-integration.test.ts --coverage --coverage.include=src/core/live-segment*.ts --coverage.reportsDirectory=coverage/live-segment`.
   El contrato externo se omite expresamente si no se habilita; esa corrida
   incompleta no reemplaza la evidencia Google real.
3. Con el mismo entorno privado:
   `node scripts/verify-live-segment-mutations.mjs`.
   Exige Google real y baseline verde antes de mutar. Copia temporal verificada
   bajo `.local`; no cambia el árbol de trabajo ni una base desplegada.
4. `npx playwright test tests/e2e/live-segment.spec.ts tests/e2e/control-center.spec.ts`.
   PostgreSQL, servidor Next de producción y navegador reales. Las paradas del
   fixture comparten coordenada para medir sólo descarga de forma determinista;
   esto no se presenta como un cálculo vial de Google. El mapa web no está
   configurado en esa instalación aislada; se prueban los controles sobre su
   estado real de mapa no configurado, sin reemplazar Google Maps.
5. `npx tsx scripts/quality-metrics.ts` y `npm audit --omit=dev --audit-level=high`.
6. Regresión:
   `npx vitest run tests/live-eta.test.ts tests/live-eta-integration.test.ts tests/live-tracking.test.ts tests/live-warehouse-integration.test.ts tests/driver-route-completion.test.ts tests/driver-service-commands.test.ts tests/live-route-presentation.test.ts tests/live-warehouse.test.ts tests/route-lifecycle-integration.test.ts tests/same-day-routes.test.ts`.

Artefactos locales (ignorados por Git):
`coverage/live-segment/coverage-summary.json`,
`reports/mutation/live-segment.json`, `reports/complexity.json`,
`.local/qa/live-segment/google-contract.txt`,
`.local/qa/live-segment/{desktop,mobile,four-screens}.png`.
Gherkin en `tests/acceptance-live-segment.feature`; escenarios ligados a las
unitarias, integraciones y E2E citadas, sin declarar ejecución de Cucumber.

## Hallazgos corregidos durante QA

- La selección debía seguir mostrando llegada cuando la parada activa alcanza
  el destino elegido. Se admite ese caso vivo sin sumar su descarga y el reloj
  seleccionado sigue a la parada actual, incluso al limpiarlo.
- El parser de duración rechaza coerciones ajenas al formato de Google.
- El primer test de GPS intentaba retroceder una observación por el escritor;
  el escritor lo rechaza correctamente. Se envejece exclusivamente la fila
  del PostgreSQL aislado para probar vencimiento, sin relajar tracking.
- Una aserción HTTP incluía el reloj `serverTime` en la igualdad de negocio;
  se excluye únicamente ese reloj. Ejecución, revisiones, paradas y pedidos
  siguen comparándose completos. Las tres pruebas E2E se repitieron verdes.

## Límites del estimado

Desde ahora incluye ubicación actual, llegada a la parada activa, descarga
restante y visitas intermedias abiertas hasta llegar al destino. Al salir
calcula desde la salida del origen fijo. Descargas no configuradas se advierten,
incluido el resumen inferior. Un reintento no seleccionado no se añade como
visita automática. Se consulta el orden vigente; no se reoptimiza la ruta.
Google estima el tráfico del trayecto y se suman las descargas configuradas;
no representa una predicción exacta del tráfico tras cada descarga futura.
La navegación física y la comprobación tras el despliegue quedan en el entorno
del propietario; no se ha desplegado ni modificado ninguna ruta remota.
