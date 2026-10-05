# RC — reparto y prioridad resueltos juntos

Autorizado por «dale» el 2026-10-04 tras revisar en Brave el borrador prueba 13,
versión 16, 44 pedidos y tres camionetas. Amplía SP exclusivamente en Armar ruta.

## Causa y regla de negocio

La política v6 agrega prioridades distintas en un punto, favorece prioridad con
un costo finito y luego ordena sin cambiar el reparto. Ese modelo resuelve una
relajación diferente de la operación final. El caso observado tiene un atraso
en Expert y márgenes de dos minutos en otros cierres. Concentrar prioridades no
es un defecto por sí solo; el defecto es optimizar el reparto sin sus verdaderas
restricciones de secuencia. No existe cuota de prioridades por chofer.

RC-BL01: administrador → Armar ruta resuelve reparto y secuencia por camioneta
con alta → media → por horario desde el modelo Google. Usa la flota real del plan
y las preferencias geográficas existentes. Permisos, lease, versiones y auditoría
existentes permanecen obligatorios; no afecta orden manual ni rutas iniciadas.

RC-BL02: clientes de igual punto y prioridad se agregan como hoy; prioridades
distintas tienen visitas propias y conservan un único vehículo dueño del punto.
Pedidos del mismo contacto siguen juntos. Cada visita conserva cierre y descarga
de sus miembros; las aperturas permiten recepción anticipada. Ningún nombre,
coordenada, folio ni número de camionetas se introduce como regla de producción.

RC-BL03: una solicitud Fleet por cálculo, cobertura completa, sin inversiones
ni puntos compartidos. Una respuesta inválida usa sólo la recuperación existente
declarada y medida con Routes; jamás se guardan tiempos inventados ni una solución
parcial. El éxito Google conserva su secuencia y su medición completas.

## Diseño y referencias verificadas

- [TransitionAttributes](https://developers.google.com/maps/documentation/route-optimization/transition-attributes):
  un `delay` superior a la duración máxima de ruta impide una transición
  descendente. Google real rechazó el exceso sobre horizonte **global** con
  código3009. Se conserva el horizonte efectivo original de cada ruta mediante
  `routeDurationLimit.maxDuration` y sólo se amplía el sobre global de validación
  hasta contener el bloqueo. No recorta trabajo ni añade descarga o esperas a
  rutas válidas. El límite existente más corto se conserva; la operación es
  idempotente y no impone precedencia temporal entre camionetas.
- [ShipmentTypeRequirement](https://developers.google.com/maps/documentation/route-optimization/reference/rest/v1/ShipmentModel#ShipmentTypeRequirement):
  `PERFORMED_BY_SAME_VEHICLE`, con un único tipo requerido por punto mixto y
  tipos dependientes sin ciclos, mantiene todas sus visitas en un vehículo.
- Se agrupan coordenadas exactas **y rango**, no se promueve la prioridad del
  cliente inferior. Zonas ponderan puntos físicos, no visitas repetidas.
- La guarda del recibo verifica prioridad y propietario físico independientemente
  de las restricciones enviadas; conserva cobertura, descarga, relojes y retorno.
- No tablas, migraciones, UI, Android, liquidación, publicación o cadencia Odoo
  nuevas. La política v7 invalida la identidad del cálculo, no el historial.

## Matriz de escenarios y conexiones

Todos los actores son administradores autorizados salvo los escenarios de
seguridad. Todos leen board/settings; sólo el éxito final guarda snapshot,
asignaciones y auditoría `plan.optimized` dentro de la transacción existente.

| ID   | Precondición/disparador                                          | Resultado y comprobación                                          | Fallo/recuperación                        |
| ---- | ---------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------- |
| RC01 | Altas, medias y horarios en distintos puntos                     | Restricciones nativas por ruta; no orden global                   | Guarda rechaza inversión                  |
| RC02 | Punto mixto, clientes diferentes                                 | Visitas por rango, mismo dueño, cierres/descarga separados        | Guarda rechaza dueño distinto             |
| RC03 | Punto con mismo rango y varios pedidos/contactos                 | Una visita; una descarga por contacto; cobertura exacta           | Contratos de grupo existentes             |
| RC04 | Flota 1/4/5/6 y más vehículos que puntos                         | Flota completa elegible, sin cuotas ni IDs especiales             | Validación existente                      |
| RC05 | Horizonte y horario de salida cambian                            | Delay supera límites de ruta y cabe en sobre global               | Rechazo de intervalo inválido             |
| RC06 | Respuesta invertida o punto dividido                             | Rechazo antes de persistir                                        | Recuperación declarada, una llamada Fleet |
| RC07 | Datos reales y Google                                            | Un Fleet, cero ordenamientos posteriores; horas/trazos del recibo | Fallos externos conservan borrador        |
| RC08 | Cliente cambia durante cálculo, versión vieja o cálculo paralelo | Guardas/lease impiden guardado ajeno u obsoleto                   | Reintento con estado vigente              |
| RC09 | Anónimo, liquidador u origen ajeno                               | 401/403, sin cálculo o lectura privada                            | Sin cambios                               |
| RC10 | Recibo real en HTTP y Chrome                                     | Mapa, pedidos, avisos y filtros reflejan recibo durable           | Nunca usar recibo ajeno/incompleto        |
| RC11 | Orden manual, publicación, ejecución y liquidación               | Contratos anteriores conservados                                  | Regresión afectada                        |
| RC12 | Cierre imposible o tráfico adverso                               | Atraso previsto visible; no se promete óptimo absoluto            | Cobertura/prioridad permanecen estrictas  |

## Bloque y validación

RC-T01: regresión roja del modelo, restricciones nativas y guarda, identificación
v7 y retiro del ordenamiento posterior del éxito Google. Objetivo 100% líneas y
ramas del nuevo contrato crítico, con mutation testing por aserciones.

RC-T02: Odoo sólo lectura, Google y PostgreSQL aislado reales; evidencia del
request/response y comparación con la revisión v16. Ningún armado remoto,
publicación o cambio de cliente necesario para probar. Métricas de reparto,
prioridad, puntos, atrasos, conducción, descarga, distancia y regreso.

RC-T03: Gherkin, HTTP/Chrome real, permisos/versiones/concurrencia, regresión,
cobertura, mutación, complejidad, latencia, typecheck/lint/build y supply chain.
Entrega comprobada a develop, sin despliegue automático.

Auditoría previa: coherencia e integridad con SP/RA/ZH, sin dependencia entre
camionetas ni pérdida de dueño del punto. MATCH PERFECT entre RC01..12 y RC-T01..03.
No certifica el óptimo matemático del problema combinatorio ni elimina atrasos
físicamente inevitables. Calidad y resultado real se registrarán en QA.
