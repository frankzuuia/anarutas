# Resiliencia y cobertura completa del ruteo por volumen

Actualización vigente: BL-058..061 en `BLOQUE-LOGISTICA-PRIORIDADES.md` reemplazan
la precedencia flexible y V10 de este bloque. Se corrige la secuencia antes de
medir; los horarios siguen sin excluir entregas. Las demás reglas permanecen.

Solicitud del 12 septiembre 2026: el lote cargado debe procesarse completo, sin
un límite de cantidad creado por Ana Rutas. Ningún plazo local artificial puede
cancelar silenciosamente a OpenAI o a Routes API antes del deadline físico del
proveedor, y nunca se persiste un resultado parcial.

## Autopsia

- No existía un límite numérico de negocio y este bloque tampoco introduce uno.
  El planificador recibe el lote completo y no envía `max_output_tokens` a OpenAI.
- Cada candidato de IA ya exigía todos los IDs exactamente una vez, pero la
  frontera genérica de persistencia aún aceptaba grupos completamente omitidos.
- OpenAI se abortaba localmente a los 120 segundos y cada medición de tramo vial
  a los 30 segundos. Estos cortes eran independientes del volumen y podían
  cancelar una corrida válida.
- Route Optimization usa un presupuesto dinámico recomendado por Google. En REST
  faltaba `X-Server-Timeout`, necesario cuando el presupuesto supera 60 segundos.

## Reglas

BL-051: cobertura total -> toda entrega elegible del snapshot aparece exactamente
una vez en el candidato y en la transacción; cualquier faltante, duplicado, ID
ajeno o `skipped` causa rollback sin cambiar el plan.

BL-052: espera de proveedores -> OpenAI y la medición por tramo no tienen abortos
temporales inventados por Ana Rutas. Los errores reales del proveedor, cuotas,
credenciales y modelos inviables siguen fallando cerrados y nunca producen una
ruta parcial.

BL-053: optimización Google -> el `timeout` del solver conserva las bandas
oficiales por complejidad y se envía también como deadline REST. Es presupuesto
de búsqueda del proveedor, no un límite de cantidad ni autorización para omitir
pedidos.

BL-054: autoridad operativa -> al pulsar Armar ruta se asigna todo el lote. Las
ventanas y prioridades se miden como preferencias para escoger el mejor orden y
mostrar retrasos/conflictos; nunca convierten un lote completo en candidato
inválido. La agrupación de un mismo cliente y la cobertura total siguen siendo
obligatorias.

## Escenarios

| ID  | Entrada/evento                          | Resultado verificable                                     |
| --- | --------------------------------------- | --------------------------------------------------------- |
| V01 | lote cargado y candidato completo       | acepta todos los IDs, sin truncado ni duplicados          |
| V02 | candidato con un ID ausente             | rechazo antes de medir                                    |
| V03 | proveedor devuelve grupo entero omitido | rollback; cero run, paradas o auditoría parcial           |
| V04 | resultado completo del lote             | paradas y métrica son iguales a la entrada                |
| V05 | OpenAI tarda más de 120 segundos        | Ana Rutas no cancela la petición por un timer propio      |
| V06 | tramo vial tarda más de 30 segundos     | Ana Rutas no cancela el tramo por un timer propio         |
| V07 | lote de mayor volumen                   | deadline REST acompaña el presupuesto dinámico del solver |
| V08 | cuota, credencial o proveedor caído     | error explícito y plan anterior intacto                   |
| V09 | ventanas/prioridades incompatibles      | arma todo y conserva avisos de retraso/conflicto          |
| V10 | primer candidato completo ya medido     | puede confirmarse sin exigir otra alternativa             |

No cambia peso, asignación por cliente, selección Odoo, flota, Odoo 17/19.4,
Ana V3, Luna ni producción.

Veredicto previo: GREEN LIGHT. Correspondencia BL-051..054 / V01..10 con
RV-T01..03: MATCH PERFECT. Integridad con BL-026..030 y BL-048..050: TOTAL.
