# SP — altas, medias y por horario por camioneta

Bloque confirmado por el propietario el 2026-10-04, después de elegir prioridad
individual incluso si implica volver al punto. Sólo afecta Armar ruta y su
recuperación. No modifica operación Android, liquidación ni el orden manual.

## Autopsia

El modelo v5 agrupaba coordenadas exactas y daba al punto la prioridad máxima.
Hotel Moto alto y Colimita por horario podían aparecer antes de Santo Coyote
alto. La expansión marcaba conflictos con el rango del punto, no con el de cada
cliente, por lo que esa inversión quedaba sin advertencia. La penalización de
transiciones en Google también era finita: favorecía prioridad, sin prohibir
inversiones. Referencia primaria: [ShipmentModel y TransitionAttributes](https://developers.google.com/maps/documentation/route-optimization/reference/rest/v1/ShipmentModel).

## Contrato confirmado

1. Cada camioneta respeta altas → medias → por horario. No existe una espera
   global entre camionetas. Se usa la prioridad operativa del cliente; sus
   pedidos mantienen el contrato de entrega conjunta del mismo contacto.
2. Cada coordenada exacta pertenece a una sola camioneta. Clientes y pedidos
   mantienen identidad. Si distintas prioridades requieren visitas separadas,
   vuelve esa misma camioneta. Puntos cercanos diferentes siguen separados.
3. Fleet conserva el reparto por zonas con la flota actual, en una solicitud.
   La secuencia expandida se valida por cliente. Si incumple prioridad, se
   ordenan los niveles conservando el orden relativo de Google dentro de cada
   nivel, excepto compactación de un mismo punto que no invierta prioridades.
   Esa compactación evita una vuelta cuando la última media comparte punto
   con un cliente por horario; no adelanta ese cliente ante otras medias/altas.
4. Sólo los vehículos cuya secuencia cambia se miden con Google Routes.
   Se recalculan calles, trazos, ETA, cierres, descarga y regreso. Las otras
   camionetas conservan su recibo Google íntegro. No se cambia asignación para
   ocultar un error vial ni se repite Fleet para ordenar prioridades.
5. Una visita consecutiva al punto suma descarga una vez por cliente. Una
   visita posterior al otro cliente suma su descarga en esa visita. Llegar
   antes de la apertura se permite; el cierre y los atrasos siguen visibles.
6. Antes de guardar se verifica cobertura exacta, grupos contiguos del cliente,
   una camioneta por punto y cero inversiones. Recuperación geográfica cumple
   la misma regla. Falta de medición, reserva perdida, versión o datos cambiados
   interrumpen el guardado y conservan el último borrador válido.
7. La auditoría registra política v6, alcance por camioneta, vehículos
   reordenados y si se conservó la secuencia del proveedor. No publica nombres
   privados, credenciales ni tokens de carretera en los logs de progreso.

## Puertas y límites

Escenarios SP01..12: `tests/acceptance-strict-priority.feature`. Regresión roja
del punto mixto antes de modificar la lógica; contratos puros, flota 1/2/4/5/6,
PostgreSQL/Odoo/Google reales y recibo HTTP/Chrome. Cobertura crítica objetivo
100% en el módulo nuevo; conjunto afectado al menos 95% en líneas, sentencias
y funciones, y 90% en ramas. Mutaciones detectadas por aserciones, seguridad y
versiones, regresión, typecheck/lint/build, latencia y complejidad medidas en QA.

La prioridad estricta puede aumentar distancia o atraso; no garantiza óptimo
global ni puntualidad físicamente imposible. Los recibos de prueba identifican
su procedencia, configuración y fecha; no sustituyen una captura remota nueva.
No se cambia ningún cliente o plan remoto para verificar el bloque.

SP sustituye el punto 2 de RA únicamente respecto a visita indivisible: conserva
**camioneta única**, permitiendo revisita por prioridad. La política se aplica
al volver a armar el borrador después del despliegue manual del propietario.
Entrega a develop, sin main, migración, APK ni despliegue automático.
