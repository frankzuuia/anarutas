# Observabilidad natural del ruteo en EasyPanel

Solicitud del 12 septiembre 2026: al pulsar **Armar ruta**, los logs del servicio
`ana-rutas-develop/app` deben explicar en español qué sistema está trabajando,
en qué etapa se encuentra, cuánto lleva y cuál fue el resultado.

## Autopsia

- El servidor sólo registraba errores HTTP genéricos y fallos del worker.
- Un ruteo exitoso podía pasar por OpenAI, dos servicios de Google y PostgreSQL
  sin escribir una sola línea de progreso.
- Los logs genéricos no permitían unir todas las etapas de una misma petición.

## Reglas

BL-055: cada corrida usa el `requestId` generado por la frontera HTTP y el
`planId` interno. Cada entrada contiene `message` natural en español, `event`,
`level`, `system`, `stage`, tiempo total transcurrido y métricas autorizadas.

BL-056: se informa preparación del lote, reserva contra concurrencia, cada ciclo
de OpenAI, solicitud y resultado de Google Route Optimization, medición agregada
de tramos con Google Routes, evaluación de candidatos, decisión de confirmación,
transacción PostgreSQL, terminación y fallo.

BL-057: no se registran payloads, credenciales, tokens, claves, nombres de
clientes, teléfonos, domicilios, coordenadas ni folios. Los detalles pasan por
una lista cerrada. Un fallo del destino de logs nunca interrumpe el ruteo.

## Ejemplo sanitario

```json
{
  "message": "Google Routes lleva 14 de 70 tramos revisados para este candidato.",
  "event": "routing.roads.progress",
  "level": "info",
  "system": "Google Routes API",
  "stage": "medición vial",
  "requestId": "...",
  "planId": "...",
  "elapsedMs": 4210,
  "details": { "segmentsCompleted": 14, "segmentsTotal": 70 }
}
```

No cambia selección Odoo, pesos, horarios, prioridad, agrupación, asignación,
algoritmo, base de datos, Ana V3, Luna ni producción.
