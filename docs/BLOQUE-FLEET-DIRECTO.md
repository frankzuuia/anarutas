# FD — Una respuesta vial, sin sustitución posterior

## Autopsia y alcance aprobado

El registro real `a8412991-46cb-47c6-ab7b-615f62a31c40` contiene una respuesta
Google de 257632 m. Tras reparar/reordenar y medir candidatos, el panel eligió
442329 m: el comparador descartaba cualquier inversión de prioridad antes de
considerar distancia o magnitud del retraso. Además, `applyOptimizationResult`
rechazaba el guardado por prioridad. Los resultados de pruebas anteriores
validaban ese contrato equivocado; no demostraban calidad logística.

El usuario autoriza corregir el armado con una sola solicitud Fleet, cantidades
dinámicas y sin más pruebas facturables durante esta implementación. Sólo
Ana Rutas/develop; sin cambios en Odoo, producción, pesos ni arrastre manual.

## Reglas y dirección técnica

- BL-FD01: administrador activo → un modelo global con todos los destinos y
  vehículos actuales, sin OpenAI, semilla local medida ni segundo OptimizeTours.
  Lee el borrador/configuración; conserva lease y auditoría de solicitudes/unidades.
- BL-FD02: prioridad Alta→Media→Por horario se expresa como penalización fuerte
  de transiciones que regresan a un nivel superior, dentro del optimizador.
  No hay sort, reasignación ni veto de prioridad después de Google. Es una
  preferencia finita, no una promesa de precedencia absoluta en todos los casos.
- BL-FD03: ventanas alternativas reales, apertura y cierre flexible por alternativa;
  no inventar disponibilidad continua entre dos horarios separados. La fecha
  del plan y la salida configurada gobiernan incluso en pruebas de días anteriores.
- BL-FD04: pedidos del mismo destino viajan juntos. Clientes distintos con idéntica
  coordenada confirmada y los mismos horarios se modelan como una visita física;
  conservan IDs, tarjetas y filas independientes. Horarios distintos no se fusionan.
- BL-FD05: respuesta completa → conservar asignación, secuencia, ETA, distancia,
  duración y polilíneas de Google. Expandir visitas a pedidos contiguos sin sumar
  de nuevo el mismo tramo; incluir regreso. Comprobar cobertura exacta antes de
  la transacción. Avisos de planificación no son incidencias reales de chofer.
- BL-FD06: fallo/omisión/contrato inválido del proveedor → no reintentar Fleet;
  recuperación geográfica local existente con medición Routes sólo en esa rama.
  Si también falla la medición, conservar atómicamente el borrador anterior;
  no inventar tiempos ni declarar éxito. El éxito normal usa cero Compute Routes.
- BL-FD07: balance por carga blanda y duración global en el mismo modelo. Nunca
  fijar 60 pedidos, 4 camionetas, reparto igual obligatorio ni capacidad artificial.
- BL-FD08: guardar requiere actor vigente, versión, fingerprint y grupos completos.
  Quitar sólo el veto de prioridad; mantener permisos, aislamiento e integridad.

## Contrato oficial revisado

- [ShipmentModel](https://developers.google.com/maps/documentation/route-optimization/reference/rest/v1/ShipmentModel):
  `TransitionAttributes.cost` suma costo por arista dirigida entre etiquetas;
  como máximo hay tres pares entre los tres niveles actuales, no pares N×N.
  `deliveries[]` son alternativas, no entregas adicionales. Ausencia de
  `penaltyCost` hace obligatorio el destino. `softMaxLoad` no es capacidad dura.
- [Ventanas](https://developers.google.com/maps/documentation/route-optimization/concepts/time-windows):
  cierre blando sólo con una ventana; usar una alternativa de entrega por ventana.
- [OptimizeTours](https://developers.google.com/maps/documentation/route-optimization/reference/rest/v1/projects/optimizeTours):
  la respuesta ya incluye secuencia, métricas, transiciones y polilíneas. No es
  necesario volver a comprar su cálculo mediante `Compute Routes`.
- [Costos](https://developers.google.com/maps/documentation/route-optimization/concepts/costs):
  coeficientes son puntos de objetivo, no MXN. Se conservan distancia, conducción,
  duración global y carga blanda; la nueva penalización de retorno de prioridad
  escala con las ventanas, costos y destinos del lote, no con nombres o IDs.

No se incorporan objetivos experimentales ni duración cuadrática: esta última
exige un máximo duro, contrario al alcance. Se conserva el horizonte técnico
vigente (<1 año); optimizarlo necesita un contrato operativo de duración, no
inventar una jornada que pueda omitir pedidos. No se inventa tiempo de surtido.

## Escenarios / tareas

Todos tienen actor administrador, datos exclusivos de la instancia y auditoría
`plan.optimized` cuando hay guardado. Sin notificaciones a clientes/choferes.

| ID   | Precondición / disparador                        | Resultado y validación                                  | Fallo / recuperación                |
| ---- | ------------------------------------------------ | ------------------------------------------------------- | ----------------------------------- |
| FD01 | Armar con distintos N pedidos y V camionetas     | Modelo dinámico, una llamada, sin límites de negocio    | Integridad antes de gastar          |
| FD02 | Respuesta vial con inversiones de prioridad      | Conservar recorrido y publicar aviso, no sort/veto      | Nunca segunda llamada               |
| FD03 | Mismo cliente, varios pedidos                    | Misma unidad y visitas contiguas; métricas sin duplicar | Rechazar cobertura corrupta         |
| FD04 | Clientes distintos, misma ubicación y horario    | Una visita física; identidades intactas                 | Horarios/puntos distintos separados |
| FD05 | Varias ventanas o fecha pasada/salida tardía     | Alternativas exactas, retraso flexible                  | No omitir pedidos por cierre        |
| FD06 | Error, cuota, respuesta incompleta de Google     | Una recuperación local; cero reintentos Fleet           | Si Routes falla, rollback/conservar |
| FD07 | Cambio concurrente de plan/configuración/cliente | Conflicto, no sobrescribir                              | Lease liberado; sin retry pagado    |
| FD08 | Usuario desactivado o ajeno                      | Sin mutación ni nuevas llamadas                         | Error de autorización               |
| FD09 | Arrastre manual                                  | Camioneta/orden del usuario, cero Fleet                 | Worker durable existente            |
| FD10 | Respuesta con regreso y pedidos agrupados        | Misma geometría/métricas guardadas, expansión exacta    | Contrato y PostgreSQL real          |

## Validación y riesgos

Tareas: FD-T01 modelo/grupos/alternativas; FD-T02 adaptación pura de respuesta;
FD-T03 orquestador directo y recuperación; FD-T04 persistencia sin veto;
FD-T05 regresiones, Gherkin, PostgreSQL, cobertura, mutación, seguridad y QA.
Pruebas locales reutilizan el arnés de contrato existente y datos de autopsia;
no son certificación vial live. No se hará una optimización facturable para QA.
Riesgo pendiente explícito: calidad de la siguiente solución real de Google y
datos maestros (coordenadas/ventanas/ausencia de duración de servicio).

Auditoría previa: GREEN LIGHT para implementación; MATCH PERFECT entre FD01..10,
BL-FD01..08 y FD-T01..05. Esta política sustituye FC08..14/MG en el armado normal,
no los contratos de movimientos manuales.
