# PH — reducir atrasos sin omitir pedidos ni fijar la flota

Autorizado el 2026-10-02: «corrijelos», después de revisar en Brave los tres
atrasos y las vueltas de Expert. Continúa ZH; afecta sólo el modelo de armado.

## Causa demostrada y contrato

El modelo vigente coloca el cierre real en `softEndTime`, pero mantiene
`endTime` en el horizonte técnico. Sólo paga demora proporcional: una llegada
apenas tardía puede ganar frente a kilómetros, zonas o duración. La respuesta
real anterior contiene esos costos, sin errores de tráfico ni de persistencia.

- PH01: representar por separado la visita dentro de cada ventana real, sin
  costo de excepción, y una alternativa tardía con costo fijo más demora.
  Todos los pedidos siguen siendo obligatorios; no se cambia la hora del cliente.
- PH02: el costo fijo deriva de la tasa vigente por prioridad y de las horas
  entre salida y último cierre del lote. La preferencia de prioridad incluye
  ambos componentes, finitos. No utiliza nombres, IDs ni cantidades fijas.
- PH03: ventanas alternativas, cierres previos a la salida, descarga y contactos
  agrupados conservan sus datos. La demora ya inevitable al salir aporta su
  costo; nunca se fabrica una ventana puntual válida después del cierre.
- PH04: una sola solicitud Fleet, mismo horizonte, flota dinámica, zonas
  flexibles, salida/bodega y ausencia de límites duros de carga. La respuesta
  completa de Google se conserva, sin correcciones manuales de ETA o secuencia.
- PH05: si no se pueden cumplir todos los horarios, la alternativa tardía
  permite un resultado completo y el aviso existente muestra la demora real.
  No se promete óptimo matemático ni cero atrasos para cualquier instancia.
- PH06: nueva versión de política para no reutilizar solicitudes anteriores.
  Permisos, versión, leases, congelación, recuperación vial, publicación,
  liquidación, APK y sincronización Odoo conservan sus contratos.

Actor: administrador autorizado. Datos: sólo proyección actual de pedidos,
ventanas, servicio, flota y bodega; persiste el resultado por el comando existente.
Auditoría: `plan.optimized`, versión de política y métricas existentes.
Sin migraciones, nuevas credenciales ni nuevas superficies de acceso.

## Flujo y referencia

Pedido/configuración real → grupos indivisibles → opciones de visita → única
llamada Fleet → parser/guardas/cobertura → mismo snapshot transaccional y avisos.
`VisitRequest.cost` permite costos por alternativa; las ventanas de llegada
no obligan a finalizar la descarga antes del cierre. Referencia oficial:
https://developers.google.com/maps/documentation/route-optimization/reference/rest/v1/ShipmentModel#VisitRequest

## Matriz de escenarios

| Caso | Disparo / precondición | Resultado verificable | Prueba / recuperación |
| --- | --- | --- | --- |
| PH01 | Visita con ventana futura | Opción puntual sin penalización y alternativa tardía costosa | Contrato puro y Google real |
| PH02 | Llegada en el segundo posterior al cierre | Incorpora costo fijo además de demora proporcional | Regresión y mutación |
| PH03 | Varias ventanas, solapadas o duplicadas | Alternativas conservadas; puede esperar una apertura válida | Contratos puros |
| PH04 | Salida posterior a uno/todos los cierres | No inventa recepción a tiempo; cobertura tardía disponible | Bordes y mutación |
| PH05 | Sin horario | Una visita sin penalización ni ventana inventada | Unidad |
| PH06 | Flota de 1/4/5/6/12 o más vehículos que puntos | Misma política; ninguna camioneta fijada | Regresión ZH |
| PH07 | Cambian nombres/posiciones/IDs de prueba | No hay reglas por cliente ni reparto manual | Contratos de identidad |
| PH08 | Descarga, prioridades y grupos | Opciones tienen misma coordenada, duración y etiquetas | Unidad/Google real |
| PH09 | Google falla o devuelve cobertura incompleta | Recuperación vigente con medición y aviso; no segundo Fleet | Contratos existentes |
| PH10 | Versión concurrente, sesión ajena o ruta iniciada | Rechazo existente, sin sobrescribir ni publicar | PG/HTTP/regresión |
| PH11 | Caso real revisado | Todos los pedidos conservados, comparar atrasos, km y regreso | Recibo Google y reproducción PG/HTTP |

## Plan y validación

1. Contrato y regresión roja; aislar construcción de ventanas y costos.
2. Integrar el modelo probado, versión de política y contratos afectados.
3. Cobertura crítica >=95% líneas y >=90% ramas, sin guardas nuevas sin validar;
   mutaciones críticas detectadas; regresión PG, HTTP, typecheck/lint/build y QA
   reproducible. Comparar modelo final con el usado en la llamada real.

Autopsia y matriz coinciden con el alcance solicitado. Integridad: no elimina
pedidos ni veta el armado cuando los horarios son imposibles, y conserva una
solicitud Fleet. Reversión: código/política; ningún cambio de datos históricos.

## Evidencia

Cierre en QA-PREFERENCIA-HORARIOS-2026-10-02.md. La prueba real (44 pedidos /
flota de 3 del caso) devolvió cero atrasos, cero inversiones de prioridad y
228.703 km. Modelo final idéntico a la solicitud verificada, 72 contratos,
100% cobertura crítica, 26/26 mutaciones y 1,021 regresiones aprobadas. Dos
recorridos reales PG/HTTP/Chrome y typecheck/lint/build verdes; no se escribió
en el borrador remoto. La entrega es develop, sin despliegue.
