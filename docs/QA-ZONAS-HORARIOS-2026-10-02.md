# QA — zonas flexibles, horarios y flota dinámica

Alcance autorizado: BLOQUE-ZONAS-HORARIOS.md, ZH01..07. Rama develop;
sin despliegue, APK ni cambios a entregas, liquidación o sincronización Odoo.
Las camionetas son las incluidas en cada plan; los clientes de prueba sólo
aportan evidencia. No se incorporan nombres, IDs, hosts ni cantidad fija de
camionetas a la política productiva.

## Autopsia y cambio verificado

El reparto anterior imponía una camioneta por zona con allowedVehicleIndices.
Una zona saturada no podía recibir ayuda aunque su secuencia llegara tarde.
Ahora cada visita tiene costos geográficos finitos por camioneta, calculados
con sus puntos físicos, y conserva toda la flota elegible. El objetivo incluye
duración de recorrido con calles, espera y descarga además de los objetivos
existentes de distancia, cierre global, carga y horarios. No obliga a igualar
pedidos ni usar una camioneta vacía.

Modelo y semántica contrastados con la
[referencia oficial de Google](https://developers.google.com/maps/documentation/route-optimization/reference/rest/v1/ShipmentModel):
costsPerVehicle admite costos no negativos por cada vehículo; costPerHour
incluye recorrido, espera y visitas. No se usan distancias geográficas como
si fueran tiempos de calle. La huella de política cambia a
google-zones-v3-time-aware, conservando congelación de rutas iniciadas y
recálculo manual. La recuperación geográfica existente informa su origen.

## Comparación real de prueba 13

Fecha de ruta 2026-10-02, salida 08:00, 44 pedidos, 3 camionetas. Línea base
del Excel exportado y registro de la aplicación; datos de descarga, puntos,
ventanas y prioridades leídos del panel. Los valores del Excel se comprobaron
con openpyxl tras detectar una importación defectuosa de celdas vacías en otra
biblioteca. No se modifica el archivo original ni el borrador remoto.

Una única llamada real a Google con el modelo nuevo tardó 48.090 s. El parser,
guardas y expansión comprobaron 44/44 pedidos, ningún omitido ni conflicto de
prioridad. La nueva respuesta no se guardó en el plan remoto.

| Camioneta del caso | Pedidos antes | Pedidos después | Regreso antes | Regreso después |
| ------------------ | ------------: | --------------: | ------------- | --------------- |
| Expert             |             5 |              13 | 13:12         | 14:23           |
| ford 2025          |            10 |              15 | 14:48         | 14:56           |
| Ford 2026          |            29 |              16 | 19:41         | 14:59           |

| Indicador                          |   Antes | Después |
| ---------------------------------- | ------: | ------: |
| Pedidos fuera de ventana previstos |      18 |       4 |
| Distancia total, km                | 218.601 | 222.640 |
| Último regreso                     |   19:41 |   14:59 |

El incremento de 4.039 km es un intercambio observado por horarios y cierre;
no una regla del algoritmo. Tapatío pasó de 19:07 a 11:38 frente a cierre 11:30;
el aviso redondea su atraso a 9 min. Quedan Sylvestre 2 min, York Pub 3 min y
Casa de las brasas 6 min. Atraso acumulado exacto: 1,071 s, 17 min 51 s.
No se promete óptimo matemático, exclusividad de calles ni ausencia de atrasos.

## Puertas de calidad ejecutadas

- 66 contratos puros aprobados: flotas de 1/4/5/6/12, más camionetas que puntos,
  identidad al permutar flota, coordenadas extremas, agrupación física, servicio,
  costos finitos, elegibilidad y proyección sólo del snapshot vigente.
- Cobertura crítica: líneas 229/229, sentencias 255/255, ramas 130/130 y
  funciones 93/93, todas 100%. Umbral mínimo 95% líneas/sentencias/funciones y
  90% ramas por riesgo de asignación y tiempos; ninguna guarda nueva queda
  respaldada sólo por el promedio global.
- Regresión completa: 105 archivos aprobados, 1 omitido; 1,015 pruebas aprobadas,
  3 omitidas, 0 fallos en 1,028.84 s. Cobertura total medida: líneas 96.23%,
  sentencias 95.07%, ramas 92.40%, funciones 97.50%.
- Mutaciones dirigidas en copia aislada: 15/15 de flota/horarios y 14/14 de
  zonas/descarga detectadas por fallos de aserción; ninguna superviviente.
  Reportes reports/mutation/zone-time.json y zones-unloading.json.
- PostgreSQL real: permisos, aislamiento, huellas, concurrencia, versiones,
  reintentos, cobertura, rutas iniciadas y persistencia en la regresión.
- Tres recorridos HTTP/Chrome aprobados sobre el build final: descarga del
  cliente, activación parcial del panel y persistencia/proyección del caso real.
  Este último lee los pedidos reales de Odoo, aplica la respuesta real guardada
  de Google a PostgreSQL aislado y verifica el aviso, folios, filtro y retirada
  del aviso obsoleto tras editar una asignación. No intercepta APIs ni genera
  una respuesta de optimización ficticia; no hace una segunda llamada Fleet.
- Seguridad HTTP: anónimo 401, origen ajeno 403, liquidador 403. Credenciales
  sólo en runtime privado de prueba; no se escriben en código, informes ni Git.
  npm audit de dependencias productivas: 0 vulnerabilidades.
- Escritorio 1440 px y móvil 390 px: aviso interactivo, sin desbordamiento
  lateral ni errores de página. Se corrigió la herencia del toast del planner
  con CSS limitado al aviso nuevo y se añadió aserción de interacción real.
  Capturas revisadas: reports/screenshots/zone-time-{desktop,mobile}.png.
- Typecheck, lint y build final aprobados; lint 0 errores y 1 aviso preexistente
  de exportación anónima en stryker.product-amendments.config.mjs. Build:
  compilación 3.8 s, TypeScript 6.9 s. Defectos abiertos del bloque: 0.
- Complejidad máxima ESLint: modelo directo 13, zonas 8, proyección 3.
  Construcción del modelo de los 44 pedidos, 100 ejecuciones: p95 60.90 ms,
  máximo 81.70 ms y 0 llamadas de red. Criterio local p95 < 100 ms para este
  conjunto; no representa un SLO de latencia de Google. La llamada de 48.090 s
  es una sola observación, no un percentil ni garantía temporal del proveedor.
  Activación Odoo local→botón por worker/SSE: 276 ms; cadencia no modificada.

## Reproducción

Node 24, dependencias instaladas, raíz ana-rutas. Sin secretos productivos.

```text
node node_modules/vitest/vitest.mjs run --config vitest.zone-time.config.ts --coverage
node scripts/verify-zone-time-mutations.mjs
node scripts/verify-zones-unloading-mutations.mjs
node node_modules/vitest/vitest.mjs run --coverage --coverage.reportsDirectory=coverage/zone-time
npm run typecheck
npm run lint
npm run build
node node_modules/@playwright/test/cli.js test tests/e2e/customer-unloading.spec.ts tests/e2e/panel-route-validation.spec.ts
node node_modules/@playwright/test/cli.js test tests/e2e/route-zone-time-live.spec.ts
npm audit --omit=dev
```

El último recorrido requiere RUTAS_QA_ZONE_TIME_CAPTURE_DIRECTORY con
input-projection.json, new-google-request.json y new-result.json de una llamada
real verificada, y configuración privada Odoo de desarrollo en runtime. Sin
ella se omite explícitamente; nunca fabrica datos de proveedor. La captura de
este bloque se conserva localmente fuera de Git. Los archivos temporales de
credenciales se eliminan al terminar. La aceptación se vincula a
tests/acceptance-zone-time.feature.

## Límites y comprobación tras despliegue

Los tres casos omitidos de la regresión son integraciones opt-in preexistentes
de imagen de producto Odoo, FCM y contrato financiero Odoo; no se cambian esos
servicios. Contratos heredados con transporte Google inyectado no se cuentan
como llamadas reales. El mapa base no se cargó en Chrome aislado porque esa
instancia carece de clave de Maps; sí se verificaron sus controles y datos
reales persistidos. La evidencia vial corresponde a la llamada Fleet real.

Tras el deploy manual del propietario: abrir un borrador, incluir la flota
disponible, comprobar ventanas y descarga configuradas y pulsar Armar ruta.
Revisar los avisos de horario y cada camioneta antes de publicar. El resultado
depende de esos datos, fecha, salida, calles y respuesta de Google; los números
de prueba 13 no se fijan para otros clientes o flotas. Sin cambios a main.
