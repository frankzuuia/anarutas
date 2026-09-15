# Bloque — control de costo de Fleet Routing

Fecha: 2026-09-14. Rama: `develop`. Alcance exclusivo: Ana Rutas.

## Autopsia

El orquestador ejecutaba una semilla global, una secuenciación Fleet Routing por
cada reparto geográfico, un refinamiento global y, cuando era nuevo, otra
secuenciación. Un armado podía alcanzar seis solicitudes `OptimizeTours`. Cada
solicitud enviaba nuevamente el lote completo de destinos y multiplicaba el SKU
`RouteOptimization - FleetRouting` sin que el administrador lo hubiera pedido.

Veredicto anterior: **RED ALERT** por amplificación de costo. Este contrato queda
en **GREEN LIGHT / MATCH PERFECT** cuando el botón `Armar ruta` conserva todo el
lote y nunca envía más de dos solicitudes Fleet Routing.

## Reglas de negocio

| ID   | Regla                                                                                                                                                                                                                                  |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FC01 | La primera solicitud Fleet Routing envía todos los destinos elegibles y produce una semilla global. No existe límite local de pedidos.                                                                                                 |
| FC02 | Google, balance circular y clúster multicentro compiten primero mediante secuencias deterministas por prioridad/ventana y medición vial. La cantidad de semillas no multiplica solicitudes Fleet Routing.                              |
| FC03 | Sólo el mejor reparto ya medido puede usar una segunda solicitud Fleet Routing, con camionetas fijas y precedencias Alta → Media → Por horario. Si cada camioneta tiene como máximo un destino, se omite por no aportar una secuencia. |
| FC04 | Dos solicitudes Fleet Routing son un máximo absoluto por pulsación. Una tercera intención se omite, se registra sin PII y se conserva el mejor candidato completo ya medido.                                                           |
| FC05 | Fallo, cuota, rechazo, omisión o respuesta inválida de la segunda solicitud no bloquea `Armar ruta`: gana la línea base local completa. Nunca existe un tercer reintento Fleet.                                                        |
| FC06 | Mover o reordenar pedidos manualmente conserva la autoridad del administrador. PostgreSQL guarda el acomodo y el recálculo posterior sólo actualiza tramos/ETA; no llama Fleet Routing ni redistribuye pedidos.                        |
| FC07 | EasyPanel informa solicitudes Fleet usadas, máximo configurado y unidades-destino enviadas. Son observabilidad de esta ejecución; Google Cloud Billing sigue siendo autoridad del consumo facturable.                                  |

## Escenarios y recuperación

| Caso                                 | Disparador                               | Resultado                                                  | Recuperación                                    |
| ------------------------------------ | ---------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------- |
| Dos o más destinos en una ruta       | `Armar ruta`                             | Una semilla global y una secuenciación del único finalista | Máximo dos solicitudes                          |
| Un destino o menos por camioneta     | `Armar ruta`                             | Se omite la segunda solicitud                              | La primera semilla medida se guarda             |
| Segunda solicitud no disponible      | Error de proveedor                       | La línea base local se guarda                              | Sin tercer intento ni bloqueo                   |
| Futuro código intenta otra solicitud | Contador ya en dos                       | La solicitud se omite antes de la red                      | Log seguro y ruta vigente                       |
| Movimiento manual                    | Arrastrar, subir, bajar o cambiar unidad | Acomodo intacto y ETA/tramos recalculados                  | Cero Fleet Routing                              |
| Lote mayor de 100                    | `Armar ruta`                             | Todo el lote entra a ambas solicitudes permitidas          | Timeout dinámico del proveedor, sin corte local |

## Flujo técnico

```text
snapshot + lease
  -> Fleet Routing 1: semilla global con lote completo
  -> Google + balance circular + clúster multicentro
  -> prioridad/ventanas + búsqueda espacial local
  -> Google Routes mide alternativas únicas
  -> ganador preliminar
  -> Fleet Routing 2 opcional: secuencia del único finalista
  -> Google Routes mide la secuencia única
  -> comparador logístico + guardado transaccional
```

Los movimientos manuales recorren otro flujo:

```text
PATCH pedido -> PostgreSQL conserva vehículo/posición
             -> worker recalcula tramos y ETA con Routes
             -> cero OptimizeTours / cero Fleet Routing
```

## Puertas de salida

1. Integración con PostgreSQL real que exige exactamente dos llamadas para una
   ruta con secuencia y valida el contenido completo de ambas.
2. Regresión de fallo de la segunda solicitud que todavía guarda la ruta.
3. Regresión de movimiento manual que conserva orden y camioneta sin
   redistribución.
4. Logs con contador seguro, Gherkin, cobertura, mutación, typecheck, lint,
   build, auditoría de dependencias y E2E local.
5. Cero smoke facturable durante QA local; prueba real sólo tras deploy manual
   del usuario en `ana-rutas-develop`.
