# Ruteo operativo: recálculo y planificación con IA

## Decisiones del usuario — 10 septiembre 2026

- OpenAI analiza y propone el plan mediante herramientas nativas.
- Alta primero, después Media y después Por horario. No convertir esta regla en
  preferencia blanda ni cambiarla silenciosamente para obtener una solución.
- El administrador configura la hora de salida en 24 horas por plan, junto al punto
  de salida. No se presupone 07:30 ni 08:00.
- Reordenar, cambiar camioneta, retirar pedidos y cambiar puntos requiere recalcular
  automáticamente el recorrido conservando la decisión manual.
- Una edición manual que incumple una ventana conserva su recorrido y muestra la
  llegada estimada y el conflicto. No se declara factible ni vuelve al orden previo.
- No peso ni volumen. Por corrección explícita del usuario, todas las camionetas
  regresan a la bodega de salida; incluir regreso en recorrido, kilómetros y duración.

## Autopsia

El mapa compara applied_plan_version con route_plans.version y oculta los trazos
anteriores. No existe trabajo de recálculo. La configuración del origen tampoco forma
parte de esa comparación. Los cambios de clientes se resuelven al leer el tablero y
pueden alterar puntos/ventanas sin cambiar la versión del plan.

El constructor Google utiliza costPerHour=1 y el día civil completo. No configura
hora de salida, balance ni tiempo de atención. Las precedencias son globales y entre
inicios de entrega (no entre finalizaciones). Cada pedido es un shipment independiente.
Google sí calcula rutas con restricciones; el comportamiento observado depende de
este modelo. Una camioneta puede salir tarde para su única ventana de mediodía.

## Reglas y contratos

| Regla  | Actor y comportamiento                          | Datos / dirección técnica                                                                                 | Permisos y auditoría                                                                   | Validación                                                                               |
| ------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| BL-032 | Administrador guarda salida del plan            | departure_minute nullable en route_plans; formulario 24 h; falta de hora explícita                        | Sesión, Origin, expectedVersion; plan.departure.updated                                | 00:00, 23:59, inválidos, concurrencia, persistencia                                      |
| BL-033 | Edición conserva orden/asignación               | Trabajo durable por versión; recálculo de tramos reales y horarios; resultados anteriores sólo históricos | Instalación dedicada, actor activo, compare-and-swap, auditoría                        | Cambio 5↔6, cambio de vehículo, eliminación, punto cambiado durante cálculo              |
| BL-034 | Conflictos visibles sin borrar recorrido manual | ETA, espera y conflictos por pedido; nunca declarar una ventana cumplida cuando no lo está                | Datos mínimos públicos; tokens privados                                                | Ventana vencida, múltiples ventanas, prioridad invertida, plan histórico                 |
| BL-035 | OpenAI planifica usando herramientas            | Snapshot, datos viales, propuestas evaluadas, aplicación versionada                                       | API key/modelo runtime; tools limitadas al plan; datos de clientes tratados como datos | Propuesta inválida, duplicados, omisiones, inyección, fallo, truncamiento y recuperación |
| BL-036 | Reparto explicable                              | Comparar duración, espera, km, paradas físicas y vehículos disponibles; prioridad estricta                | Auditoría del resultado y métricas; sin cambios Odoo                                   | Caso 7 pedidos/2 vehículos, cliente repetido, ventana de mediodía                        |

## Flujo técnico

1. Persistir cambios del administrador y programar una única revisión pendiente para
   la versión actual. Las revisiones anteriores no pueden sobrescribir la nueva.
2. Recalcular el orden manual con Routes API; medir tramos por calles y horarios de
   visita, incluyendo esperas. Las horas pasadas requieren identificar la estimación
   sin tráfico histórico; nunca cambiar de fecha el plan silenciosamente.
3. En Armar ruta, OpenAI consulta el snapshot y herramientas de evaluación vial;
   plantea y compara candidatos dentro de las restricciones. El servidor verifica
   IDs, cobertura, permisos, versión y factibilidad antes de aplicar.
4. Mostrar estado calculando, actualizado o fallo recuperable, métricas por camioneta
   y conflictos de horario. Actualizar el mapa sin deshacer las ediciones.

## Escenarios de aceptación y recuperación

| ID  | Precondición / disparador                | Resultado                                                      | Recuperación / prueba                      |
| --- | ---------------------------------------- | -------------------------------------------------------------- | ------------------------------------------ |
| R01 | Falta hora de salida                     | Solicitar configuración, sin hora inventada ni llamada externa | Guardar y calcular                         |
| R02 | Guardar HH:mm válido                     | Hora persiste sólo en ese plan y cambia su versión             | PostgreSQL y E2E                           |
| R03 | Otro admin edita misma versión           | Conflicto; no sobrescribir                                     | Refrescar datos                            |
| R04 | Cambiar orden 5↔6                        | Mismo orden, nuevos tramos/ETA                                 | Regresión real reportada                   |
| R05 | Cambiar pedido de camioneta              | Recalcular ambas rutas; no redistribuir otros pedidos          | Integración y E2E                          |
| R06 | Quitar pedido/camioneta                  | No resucitar pedido; Sin asignar se conserva                   | Integridad y concurrencia                  |
| R07 | Cambiar punto/salida/ventanas            | Invalidar resultados afectados y recalcular                    | No mostrar ruta anterior como vigente      |
| R08 | Ventana imposible tras edición           | Mostrar recorrido y conflicto identificable                    | Corregir manualmente o planificar otra vez |
| R09 | Reinicio/timeout durante trabajo         | Recuperación de revisión pendiente, sin doble aplicación       | Lease y prueba de reinicio                 |
| R10 | OpenAI/Google falla o cuota              | Estado recuperable; conservar plan                             | Error sanitario y reintento                |
| R11 | IA propone IDs ajenos/duplicados         | Rechazar propuesta y devolver errores a herramienta            | Seguridad/contrato                         |
| R12 | Respuesta IA incompleta                  | Inspeccionar causa, conservar estado y recuperar               | Sin JSON parcial ni límite bajo impuesto   |
| R13 | Prioridades y ventanas incompatibles     | Informar conflicto; no relajar prioridades sin decisión        | Validación de candidatura                  |
| R14 | 7 pedidos/2 camionetas con ventana 12–13 | Evaluar espera desde salida configurada y uso de flota         | Comparación de propuestas con Google real  |

## Referencias verificadas

- Google cost model: https://developers.google.com/maps/documentation/route-optimization/concepts/costs
- Google fleet costs: https://developers.google.com/maps/documentation/route-optimization/assignment
- Precedencia y ventanas: https://developers.google.com/maps/documentation/route-optimization/reference/rest/v1/ShipmentModel
- Inyección de secuencias: https://developers.google.com/maps/documentation/route-optimization/reference/rest/v1/InjectedSolutionConstraint
- Routes: https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes
- OpenAI tools: https://developers.openai.com/api/docs/guides/function-calling
- Next.js: guías locales node_modules/next/dist/docs para Route Handlers e instrumentation.

## Auditoría previa y puertas

El bloque sustituye explícitamente S39 (obsolescencia sin recálculo) y la libertad de
salida del modelo anterior. No altera prioridades, identidad Odoo ni eliminación
recuperable. Cada tarea figura en PROGRESS. La implementación y sus límites verificables
se documentan en `QA-BLOQUE-5B-RECALCULO-IA.md`.

Validación requerida: unidades de horario, contratos viales/IA, PostgreSQL real para
versiones y trabajos, Gherkin, E2E de movimiento/recuperación, cobertura y mutación de
predicados críticos, lint, tipos, build y smoke externo autenticado. Registrar latencias,
esperas, número de llamadas, revisiones descartadas, fallos y resultados por vehículo.
No declarar verde una prueba externa que no se pudo ejecutar con credenciales reales.

El esfuerzo de razonamiento se configura en runtime mediante
`RUTAS_OPENAI_REASONING_EFFORT`. La recomendación inicial del planificador es `high`;
se conserva como configuración privada y auditable, no como una constante de negocio.
