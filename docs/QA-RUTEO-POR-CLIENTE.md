# QA — pedidos del mismo cliente en una camioneta

Ejecución 11–12 septiembre 2026, sólo Ana Rutas / `develop`. Sin commit, push,
deploy, cambio de permisos ni escrituras a Odoo o al borrador remoto.

Entrega posterior: el 12 septiembre el usuario autorizó explícitamente commit y
push de este cambio a develop. El deploy de EasyPanel queda manual a su cargo;
no se autoriza promoción a main ni despliegue automático por esta entrega.

## Defecto y corrección

La regresión reprodujo cuatro fallos antes del cambio: dividir un cliente Alta,
dividir uno Media, visitar A→B→A y forzar dos camionetas para un solo cliente.
El snapshot no contenía identidad/grupos; las validaciones nunca exigían afinidad
y el uso de flota se contaba por pedidos.

Ahora el partner de entrega define un grupo opaco que conserva todas sus tarjetas.
Se valida una sola camioneta, consecutividad e integridad antes de evaluar y dentro
de la transacción de guardado. Google aporta una semilla; si rompe un grupo la
herramienta devuelve el error para que OpenAI replantee, sin reasignación heurística.
Flota y alternativas cuentan grupos, no pedidos. La huella incluye partnerId.

No se alteraron pesos/capacidad, ventanas, prioridades, comparación de métricas,
salida/regreso, Odoo 17/19, importación, movimientos manuales, V3 ni Luna.
El análisis master-architect situó la protección en ambas fronteras y comprobó
la identidad real de entrega antes de implementar.

## Puertas ejecutadas

| Puerta                               | Evidencia / comando                                                          | Resultado                                                                                                           |
| ------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Reproducción previa                  | `npx vitest run tests/route-ai-planner.test.ts` antes del fix                | 4 fallos esperados / 32 verdes                                                                                      |
| Suite y cobertura                    | `npm run test:coverage`                                                      | 326 pruebas, 32 archivos, PASS; 127.31 s                                                                            |
| Cobertura global                     | reporte V8 `coverage/coverage-summary.json`                                  | 91.03% declaraciones, 85.02% ramas, 96.90% funciones, 92.59% líneas                                                 |
| Cobertura de agrupación y huella     | mismos reportes, por archivo                                                 | 100% declaraciones/ramas/funciones/líneas                                                                           |
| Mutación agrupación/evaluador/huella | `npx stryker run stryker.delivery-groups.config.mjs`                         | 205/210 detectadas, 97.62%; sin timeouts; 52 pruebas en corrida final                                               |
| Mutación de agrupación               | subreporte del comando anterior                                              | 47/47 detectadas, 100%, cero supervivientes                                                                         |
| Mutación de huella                   | subreporte del comando anterior                                              | 10/10 detectadas, 100%                                                                                              |
| PostgreSQL real                      | `tests/routing.test.ts`                                                      | grupo dividido, parcial/intercalado y actor ajeno rechazados; rollback; reintento correcto; versión vieja rechazada |
| Compilación y tipos                  | `npm run build`, `npm run typecheck`                                         | PASS, Next.js 16.3.4                                                                                                |
| Estática y supply chain              | `npm run lint`, `npm audit --audit-level=high`                               | PASS, sin advertencias de lint; 0 vulnerabilidades                                                                  |
| E2E regresión                        | `npx playwright test` con sólo entorno Odoo y fecha QA 2026-09-11            | 2/2 PASS, 53.3 s; panel/permisos/concurrencia y selección Odoo real                                                 |
| E2E armado real                      | `npx playwright test tests/e2e/route-groups-live.spec.ts` con caso explícito | PASS, 43.5 s total; cálculo 29.63 s; 5 tools, 4 candidatos evaluados                                                |

Objetivo por riesgo: 100% en agrupación/huella, umbrales globales existentes
85% líneas/declaraciones, 90% funciones y 80% ramas. La mutación global dirigida
exige 90%; la agrupación crítica obtuvo 100%. Cuatro supervivientes y un mutante
sin cobertura pertenecen a defensas anteriores del parser (tipo redundante con
pertenencia a Set y prioridad ya garantizada por el contrato); no se ocultaron ni
se excluyeron para mejorar el porcentaje. Se añadió una regresión específica para
vehículos distintos con índices numéricos consecutivos, detectando el fallo que
una comprobación de posiciones por sí sola no descubre.

Mutación adicional de la frontera transaccional:
`npx stryker run stryker.group-persistence.config.mjs`, 3/3 mutaciones detectadas,
100%, cero supervivientes/timeouts, PostgreSQL real. Corrida dirigida final:
`npx vitest run --config vitest.delivery-groups.config.ts`, 52/52 PASS después
de añadir el caso de índices numéricos coincidentes entre camionetas.

Complejidad de agrupación y validación: O(pedidos + rutas), sin comparaciones por
nombre ni consultas adicionales a Odoo. Persistencia agrega una validación en
memoria antes del primer UPDATE, conserva los bloqueos/versiones existentes.
La latencia observada del smoke no es un SLO de producción ni una cota futura.

## Reproducción con servicios reales, sin sustituir respuestas

La lectura Odoo confirmó 8 pedidos / 5 partners de entrega. Se leyeron en la UI
los cinco puntos guardados, prioridades y ventanas, así como salida 08:00 y bodega.
La bodega se copió con los seis decimales que muestra la interfaz; no se presume
conocer precisión adicional. Nombres/vehículos de QA son locales; las identidades
de pedidos se releen mediante el conector Odoo real. La instalación PostgreSQL
es desechable, autenticada y enlazada a loopback, nunca al servicio DB de EasyPanel.

El script opt-in recibe `RUTAS_QA_ROUTING_CASE` como JSON con date, timezone,
departureTime, vehicleCount, orderNames, depot y customers (partnerId, priority,
windows, location). Se requiere configuración privada Odoo/OpenAI/Google propia de
Ana Rutas. No poner ese JSON con información operativa ni secretos en Git. El caso
observado quedó en `.local/route-groups-case.json`, ignorado por Git; las claves
se pasan sólo al entorno del proceso, no al archivo. La prueba no envía callbacks
ni escribe el Odoo de origen y verifica las tarjetas en el navegador real.

Resultado observado en la copia local:

- Camioneta QA 1: S00002, S00001 (Progreso); S00004, S00003, S00011 (Fonda Martha);
  S00006 (Cocina San Miguel); S00005 (café).
- Camioneta QA 2: S00007 (Taquería Los Arcos, ventana 12:00–13:00).
- Los 8 IDs conservados, 0 sin asignar, 5 grupos completos, una sola optimización
  auditada y una sola subida de versión. El reparto no promete igualdad de tarjetas:
  siguen vigentes la prioridad global y el comparador vial existente.

Primer ensayo: el armado real fue correcto, pero la aserción visual buscaba el
folio como nodo de texto exacto. Se corrigió la prueba para cerrar el mapa y buscar
el botón accesible de la tarjeta; la repetición completa fue verde. No se cambió
el dominio para satisfacer el test. La prueba no certifica el mapa JavaScript:
su clave de navegador no se configuró en la instalación local de QA.

La consulta auxiliar Geocoding respondió REQUEST_DENIED; no se cambiaron permisos.
Se resolvió la necesidad leyendo las coordenadas ya guardadas desde la UI real.
La sesión venció durante esa lectura; el usuario volvió a iniciar sesión. Al cerrar
la consulta sin guardar, el borrador remoto conservaba v24 y sus ocho pedidos.

## Aplicación y reversión

Sólo desplegar cuando el usuario autorice commit/push del fix y haga su deploy
manual de develop. No se reordena ningún borrador existente al instalar. Después,
pulsar Armar ruta para regenerar el plan con la regla nueva. Las ejecuciones con
la huella antigua quedan obsoletas; no se presentan como cálculos vigentes de la
nueva identidad. No hay migración ni borrado de historial.

Reversión mediante revert del commit autorizado en develop y reconstrucción,
sin reset destructivo ni migraciones inversas. No promover a main implícitamente.
