# ZH — reparto por zonas con horarios y trabajo real

Autorizado 2026-10-02: probar y corregir el armado automático. Flota y clientes
son datos del plan; ningún nombre, ID, número de camionetas ni resultado de la
prueba se incorpora a la política productiva.

## Autopsia

ZD asignaba una zona rígida mediante `allowedVehicleIndices`. Google podía
reordenar dentro de ella, pero no aliviar una zona saturada. Los cierres de
ventana son preferencias finitas: el cálculo completo puede contener atrasos.
En prueba 13 (44 pedidos/3 camionetas) quedaron 5/10/29 pedidos y 18 atrasos;
la última llegada fue 19:07 pese a una ventana 09:00–11:30.

## Contrato aprobado

- ZH01: todos los vehículos incluidos en el plan pueden atender cada visita.
  Centros geográficos calculados con coordenadas físicas únicas aportan costos
  finitos en unidades de kilómetros, nunca una prohibición de reasignación.
- ZH02: el objetivo incluye duración total de cada recorrido: calles, esperas
  y descarga; mantiene el objetivo global de terminar y la prioridad finita.
- ZH03: clientes y ventanas alternativas conservan sus agrupaciones, servicio,
  pedidos obligatorios y cobertura completa; no se fracciona un grupo de entrega.
- ZH04: 1, 4, 5, 6 u otra flota usan el mismo algoritmo. Vehículos adicionales
  a los puntos también son elegibles; no se obliga a usarlos ni a igualar pedidos.
- ZH05: mapa informa pedidos, camioneta, ventana, ETA y minutos de atraso previstos
  con los datos vigentes del snapshot. No se presentan como incidencias reales.
- ZH06: una llamada Fleet por ejecución; recuperación existente conserva medición
  Routes y cobertura, con aviso explícito de que es recuperación geográfica.
- ZH07: huella versionada invalida la política anterior. Rutas iniciadas, orden
  manual, publicación, liquidación, Android y cadencia Odoo se conservan.

## Validación y riesgo

Unidad: costos finitos, determinismo, coordenadas extremas, flota variable,
agrupación, duración, elegibilidad, cobertura y proyección de atrasos.
Contrato/integración: API Google real con captura de prueba13; PG y contratos
existentes para permisos, versiones, reintentos, concurrencia y congelación.
Aceptación: `tests/acceptance-zone-time.feature`. QA reproducible, cobertura
por riesgo y mutaciones deliberadas se registran en QA-ZONAS-HORARIOS.
No promesa de óptimo matemático ni exclusividad absoluta por barrio: atender
horarios puede requerir cruzar un límite de zona. Nunca se descartan pedidos
para ocultar un conflicto. No se guarda el experimento sobre el plan remoto.

## Tareas

- [x] ZH-T01: modelo geográfico flexible y validación (ZH01..04,06..07).
- [x] ZH-T02: aviso de conflictos vigentes (ZH05).
- [x] ZH-T03: Google real, pruebas, cobertura/mutación, QA y entrega develop.

Evidencia: QA-ZONAS-HORARIOS-2026-10-02.md. 44 pedidos reales completos,
atrasos 18→4; flota dinámica, 66 contratos puros/100% cobertura crítica,
1,015 pruebas de regresión aprobadas y 29/29 mutaciones detectadas.
Tres recorridos HTTP/Chrome verdes; sin guardar la prueba en el plan remoto.
