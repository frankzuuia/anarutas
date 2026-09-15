# Bloque — control de costo de Fleet Routing

Fecha: 2026-09-14. Rama: `develop`. Alcance exclusivo: Ana Rutas.

## Autopsia

El orquestador ejecutaba una semilla global, una secuenciación Fleet Routing por
cada reparto geográfico, un refinamiento global y, cuando era nuevo, otra
secuenciación. Un armado podía alcanzar seis solicitudes `OptimizeTours`. Cada
solicitud enviaba nuevamente el lote completo de destinos y multiplicaba el SKU
`RouteOptimization - FleetRouting` sin que el administrador lo hubiera pedido.

Veredicto anterior: **RED ALERT** por amplificación de costo. FC01..FC07 quedan
como historial de la reducción inicial a dos solicitudes. La política vigente
es FC08..FC14: `Armar ruta` conserva todo el lote y envía como máximo **una**
solicitud Fleet Routing.

## Reglas de negocio

| ID   | Regla                                                                                                                                                                                                                                              |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FC01 | La primera solicitud Fleet Routing envía todos los destinos elegibles y produce una semilla global. No existe límite local de pedidos.                                                                                                             |
| FC02 | Google, balance circular y clúster multicentro compiten primero mediante secuencias deterministas por prioridad/ventana y medición vial. La cantidad de semillas no multiplica solicitudes Fleet Routing.                                          |
| FC03 | Sólo el mejor reparto ya medido puede usar una segunda solicitud Fleet Routing, con camionetas fijas y precedencias Alta → Media → Por horario. Si cada camioneta tiene como máximo un destino, se omite por no aportar una secuencia.             |
| FC04 | Dos solicitudes Fleet Routing son un máximo absoluto por pulsación. Una tercera intención se omite, se registra sin PII y se conserva el mejor candidato completo ya medido.                                                                       |
| FC05 | Fallo, cuota, rechazo, omisión o respuesta inválida de la segunda solicitud no bloquea `Armar ruta`: gana la línea base local completa. Nunca existe un tercer reintento Fleet.                                                                    |
| FC06 | Mover o reordenar pedidos manualmente conserva la autoridad del administrador. PostgreSQL guarda el acomodo y el recálculo posterior sólo actualiza tramos/ETA; no llama Fleet Routing ni redistribuye pedidos.                                    |
| FC07 | EasyPanel informa solicitudes Fleet usadas, máximo configurado y unidades-destino enviadas. Son observabilidad de esta ejecución; Google Cloud Billing sigue siendo autoridad del consumo facturable.                                              |
| FC08 | Ana Rutas construye y mide primero repartos locales completos por balance y clúster geográfico. Esta fase no consume Fleet Routing y nunca recorta el lote.                                                                                        |
| FC09 | El mejor reparto local medido se envía como `injectedFirstSolutionRoutes` dentro de la única solicitud `optimizeTours`. Los índices, grupos, vehículos y tiempos se validan antes de la red.                                                       |
| FC10 | La única solicitud permanece libre para cambiar asignaciones y secuencias. El modelo pondera tiempo, kilómetros, jornada global, ventanas suaves y balance blando; ningún `penaltyCost` permite omitir pedidos.                                    |
| FC11 | No se generan precedencias masivas en el modelo global: Google documenta que pueden provocar rechazo en lotes grandes. La semilla ya respeta Alta → Media → Por horario y toda propuesta se vuelve a ordenar y medir localmente antes de competir. |
| FC12 | Una pulsación puede intentar como máximo una solicitud Fleet Routing. Error, cuota, rechazo, omisión o respuesta inválida conserva el ganador local completo; no hay reintento ni segunda llamada.                                                 |
| FC13 | Mover o reordenar pedidos manualmente continúa usando cero Fleet Routing y no dispara una nueva optimización global.                                                                                                                               |
| FC14 | EasyPanel informa `fleetRoutingRequests`, límite `1`, unidades-destino enviadas y si Google mejoró o si se conservó la semilla local, sin PII ni secretos.                                                                                         |

## Escenarios y recuperación

| Caso                                    | Disparador                               | Resultado                                                     | Recuperación                                    |
| --------------------------------------- | ---------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------- |
| Cualquier cantidad de destinos          | `Armar ruta`                             | Semilla local medida y una optimización global con warm start | Máximo una solicitud                            |
| Única solicitud no disponible           | Error de proveedor                       | La línea base local se guarda                                 | Sin reintento ni bloqueo                        |
| Google omite o devuelve datos inválidos | Respuesta del proveedor                  | La propuesta se descarta                                      | La línea base local completa se guarda          |
| Futuro código intenta otra solicitud    | Contador ya en uno                       | La solicitud se omite antes de la red                         | Log seguro y ruta vigente                       |
| Movimiento manual                       | Arrastrar, subir, bajar o cambiar unidad | Acomodo intacto y ETA/tramos recalculados                     | Cero Fleet Routing                              |
| Lote mayor de 100                       | `Armar ruta`                             | Todo el lote entra a la única solicitud permitida             | Timeout dinámico del proveedor, sin corte local |

## Flujo técnico

```text
snapshot + lease
  -> balance circular + clúster multicentro
  -> prioridad/ventanas + búsqueda espacial local
  -> Google Routes mide alternativas únicas
  -> ganador local completo
  -> Fleet Routing 1 y única: optimización global con ganador inyectado
  -> validación, prioridad local y medición de la propuesta Google
  -> comparador logístico + guardado transaccional
```

Los movimientos manuales recorren otro flujo:

```text
PATCH pedido -> PostgreSQL conserva vehículo/posición
             -> worker recalcula tramos y ETA con Routes
             -> cero OptimizeTours / cero Fleet Routing
```

## Puertas de salida

1. Integración con PostgreSQL real que exige exactamente una llamada, valida el
   warm start completo y prohíbe una segunda salida de red.
2. Regresión de fallo de la única solicitud que todavía guarda la ruta local.
3. Regresión de movimiento manual que conserva orden y camioneta sin
   redistribución.
4. Logs con contador seguro, Gherkin, cobertura, mutación, typecheck, lint,
   build, auditoría de dependencias y E2E local.
5. Cero smoke facturable durante QA local; prueba real sólo tras deploy manual
   del usuario en `ana-rutas-develop`.

## Referencias oficiales verificadas tres veces

- Contrato `optimizeTours`, timeout, `injectedFirstSolutionRoutes` y validación:
  https://developers.google.com/maps/documentation/route-optimization/reference/rest/v1/projects/optimizeTours
- Modelo de costos: `costPerHour`, `costPerKilometer`, pedidos obligatorios al
  omitir `penaltyCost`:
  https://developers.google.com/maps/documentation/route-optimization/concepts/costs
- Timeouts recomendados por complejidad y tamaño real del lote:
  https://developers.google.com/maps/documentation/route-optimization/timeouts
- Ventanas suaves, que penalizan retrasos sin bloquear la ruta:
  https://developers.google.com/maps/documentation/route-optimization/concepts/time-windows
- Referencia del `ShipmentModel`; advierte que precedencias con muchos pedidos
  pueden provocar rechazo:
  https://developers.google.com/maps/documentation/route-optimization/reference/rest/v1/ShipmentModel
