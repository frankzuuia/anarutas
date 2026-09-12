# QA — ruteo completo sin límite de negocio

Alcance: Ana Rutas `develop`; sin despliegue ni escrituras a Odoo.

## Evidencia dirigida

- `route-ai-planner.test.ts`: el lote cargado conserva todos sus IDs únicos y
  rechaza un faltante; el caso actual usa 61, no un máximo. Un candidato completo
  medido puede confirmarse sin exigir una segunda propuesta.
- `routing.test.ts`: PostgreSQL real persiste 61 paradas en una transacción y
  registra `performedShipmentCount=61`; un cliente completamente omitido es
  rechazado antes de cualquier escritura.
- `route-ai-integration.test.ts`: no existe `max_output_tokens` ni señal local de
  aborto en las llamadas de OpenAI.
- `route-optimization-google.test.ts`: el deadline HTTP coincide con el presupuesto
  del solver; cuerpo ausente, JSON inválido y frontera de tamaño fallan cerrados.

## Resultado local final

| Puerta | Resultado |
| --- | --- |
| Suite con cobertura | 32 archivos, 330 pruebas, 330 aprobadas |
| Cobertura global | 91.25% statements, 84.92% branches, 97.09% functions, 92.77% lines |
| Mutación Google/ruteo | 100%; 482 killed + 1 timeout detectado, 0 sobrevivientes |
| Mutación grupos/planificador | 100%; 178 killed, 0 sobrevivientes |
| Mutación persistencia completa | 100%; 3 killed, 0 sobrevivientes |
| Lint / TypeScript / build | PASS; 0 errores y 0 advertencias de lint |
| Seguridad de dependencias | `npm audit --audit-level=high`: 0 vulnerabilidades |
| E2E local | 1 PASS; 2 live omitidos por ausencia deliberada de credenciales facturables |

La prueba local del lote usa el dominio real y PostgreSQL desechable; los puntos
coinciden con la bodega para no sustituir Google con respuestas fabricadas. El
smoke facturable con los 61 pedidos reales corresponde al entorno develop después
del deploy manual y debe registrar cantidad, duración, tools, candidatos, cero
omitidos y cada grupo de cliente en una sola camioneta. Es la única puerta pendiente.
Un proveedor caído no se declara éxito: falla completo y conserva el plan.

## Reversión

Revertir el commit de este bloque en `develop`. No hay migración, variables nuevas
ni cambios de datos que revertir.
