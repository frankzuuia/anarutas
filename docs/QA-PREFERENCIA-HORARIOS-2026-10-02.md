# QA — preferencia por horarios sin fijar clientes ni flota

Bloque PH autorizado por «corrijelos» tras revisar el mapa de desarrollo.
Contrato y matriz: [BLOQUE-PREFERENCIA-HORARIOS.md](BLOQUE-PREFERENCIA-HORARIOS.md).
El cambio productivo afecta únicamente la construcción del modelo Fleet y su
versión de política. No hay migración, APK ni despliegue.

## Causa y corrección

El modelo anterior sólo penalizaba los minutos de demora. Google podía aceptar
un atraso corto para reducir otros costos. El recibo real confirma costos de
demora sin fallos de tráfico, parser o persistencia.

Cada ventana ahora ofrece una alternativa de llegada a tiempo sin cargo y
otra tardía con costo fijo más demora proporcional. El costo fijo deriva de
los horarios, prioridades y tamaño del lote actual. Las alternativas pertenecen
al mismo pedido obligatorio: conservan ubicación, descarga, grupo y carga.
Si el horario resulta imposible, la alternativa tardía permite mantener una
solución completa y mostrar el atraso real. La prioridad sigue siendo finita.

La política `google-zones-v4-deadline-options` evita reutilizar una solicitud
anterior. Se conservan una llamada Fleet, toda la flota del plan elegible, zonas
flexibles, snapshots, permisos, concurrencia y recuperación existentes.
Semántica contrastada con la
[referencia oficial de VisitRequest](https://developers.google.com/maps/documentation/route-optimization/reference/rest/v1/ShipmentModel#VisitRequest).
Las ventanas restringen llegada; la descarga puede terminar después del cierre.

## Resultado real del caso revisado

Mismos 44 pedidos, flota de tres camionetas, salida 08:00, ventanas, ubicación y
descarga capturadas. Una llamada real a Google: **46.523 s**, **44/44 pedidos**,
**cero atrasos**, **cero inversiones de prioridad** y **228.703 km**.
El modelo final se comparó por igualdad profunda con la solicitud enviada y su
parser/expansión reprodujeron exactamente el resultado guardado de Google.
No se modificó el borrador remoto para ejecutar estas pruebas.

| Camioneta del caso | Pedidos | Distancia | Regreso |
| --- | ---: | ---: | --- |
| Expert | 13 | 79.551 km | 14:05 |
| ford 2025 | 15 | 83.128 km | 14:56 |
| Ford 2026 | 16 | 66.024 km | 14:43 |

| Cliente observado | Llegada calculada | Cierre configurado |
| --- | --- | --- |
| Tapatío | 11:24 | 11:30 |
| Banquetes I latina | 10:42 | 11:00 |
| Casa de las brasas | 13:49 | 14:00 |

En el panel revisado antes de corregir había tres atrasos y Expert mostraba
91.5 km: esta prueba reduce su recorrido aproximadamente 12 km. El total
visible del panel era 230.2 km y su último regreso 15:02. Son valores redondeados
de aquella ejecución, distintos al recibo anterior guardado para reproducir QA.
Frente a ese recibo v3 (222.640 km, cuatro atrasos), v4 añade 6.063 km y elimina
los cuatro atrasos. No se mezclan ambas referencias ni se promete optimalidad
global, exclusividad de calles o cero atrasos en cualquier otro lote.

## Puertas de calidad

- Regresión roja: cinco pruebas fallaban con el modelo anterior; las seis
  pruebas del nuevo contrato pasan después de la corrección.
- Contratos enfocados: **72/72**. Cobertura de la lógica crítica: **100%** líneas
  (238/238), sentencias (265/265), ramas (130/130) y funciones (96/96).
  Umbral por riesgo: 95% líneas/sentencias/funciones y 90% ramas. Incluye horarios
  vencidos, llegada exacta al cierre, intervalos cerrados, ventanas múltiples,
  ausencia de horario, descarga, grupos, prioridades y flotas 1/4/5/6/12.
- Mutación dirigida en copia aislada: **26/26** errores detectados por aserciones,
  sin supervivientes; baseline 72/72. Incluye pérdida del costo fijo, cierres
  inventados, demora ya acumulada, pérdida de alternativa tardía, prioridad,
  política, flota, zonas y avisos obsoletos.
- Dos recorridos HTTP/Chrome con PostgreSQL real aprobados en **46.3 s**:
  recibo anterior con atrasos y recibo nuevo sin atrasos. Lectura real de Odoo,
  identidad completa, persistencia exacta, snapshot vigente, filtros y retirada
  de datos obsoletos al mover un pedido. Se espera la carga del recorrido antes
  de comprobar la ausencia de avisos. No hay APIs interceptadas ni rutas ficticias.
- Seguridad HTTP: anónimo 401, origen ajeno 403 y liquidador 403. Dependencias
  productivas: `npm audit --omit=dev`, cero vulnerabilidades. Revisión del diff
  sin secretos detectados; eliminado el archivo privado de runtime al terminar
  las lecturas de Odoo y comprobada su ausencia.
- Escritorio 1440 px y móvil 390 px: controles y datos sin desbordamiento lateral.
  Evidencia: `reports/screenshots/zone-time-{new,deadline}-{desktop,mobile}.png`.
  El mapa base no se carga en el entorno aislado sin clave Maps; la evidencia
  vial proviene de la respuesta real Fleet, no de esas capturas.
- Typecheck, lint y build aprobados. Lint: cero errores, un aviso preexistente
  en `stryker.product-amendments.config.mjs`. Compilación 13.4 s, TypeScript 10.3 s.
- Complejidad ESLint: constructor modificado 2; nueva función de ventanas 2;
  máximo del archivo existente 13 en la guarda de respuesta, sin modificar.
- Regresión global: **1,021 pruebas aprobadas**, cero fallos y tres integraciones
  opt-in preexistentes omitidas, en **1,135.50 s**. Cobertura total: líneas
  **96.24%** (5,456/5,669), sentencias **95.08%** (6,096/6,411), ramas **92.40%**
  (4,378/4,738) y funciones **97.50%** (1,448/1,485). Incluye PostgreSQL real,
  permisos, versiones, idempotencia, concurrencia, congelación y recuperación.
- Rendimiento local con el lote real: 100 construcciones por versión,
  intercaladas después de cinco calentamientos, sin red. Modelo anterior:
  p50 50.46 ms / p95 71.47 ms; nuevo: p50 **50.68 ms** / p95 **72.52 ms**,
  máximo 88.39 ms. Cumple la referencia local p95 < 100 ms; variación p95 de
  1.05 ms. Otra medición con compilación y pruebas simultáneas fue 120.72 ms
  anterior / 115.04 ms nuevo; se conserva aparte para no confundir carga de la
  PC con regresión del cambio. Reportes `reports/deadline-performance-*.json`.
  La llamada Google de 46.523 s es una observación, no un percentil ni SLO.
- Defectos pendientes detectados dentro del bloque: **0**.

## Reproducción

Node 24 y dependencias del lockfile, desde la raíz de ana-rutas:

```text
node node_modules/vitest/vitest.mjs run --config vitest.zone-time.config.ts --coverage
node scripts/verify-zone-time-mutations.mjs
node node_modules/vitest/vitest.mjs run --coverage --coverage.reportsDirectory=coverage/deadline-regression
npm run typecheck
npm run lint
npm run build
node node_modules/@playwright/test/cli.js test tests/e2e/route-zone-time-live.spec.ts
npm audit --omit=dev
```

El recorrido requiere configuración privada Odoo de desarrollo y la variable
`RUTAS_QA_ZONE_TIME_CAPTURE_DIRECTORY`. El directorio contiene
`input-projection.json`, `{new,deadline}-google-request.json` y
`{new,deadline}-result.json` de llamadas reales verificadas. Los recibos crudos
`{new,deadline}-google-response.json` permiten revisar la respuesta original.
Sin esa configuración la prueba se omite explícitamente; no inventa respuestas.
Datos y reportes extensos permanecen locales, fuera de Git. Escenarios de
aceptación: `tests/acceptance-deadline-preference.feature`.

Las tres omisiones corresponden a contrato financiero Odoo, imágenes de producto
Odoo y FCM, servicios no modificados en este bloque. La cobertura global conserva
la exclusión preexistente de `odoo.ts`; su lectura se ejercita en el E2E real.
Las pruebas heredadas con transporte Google inyectado no se cuentan como llamadas
reales. Solicitud, respuesta y validación reales se conservan en el directorio
de captura; el reporte completo de regresión es `.local/deadline-regression.json`.

## Entrega

Puertas aplicables aprobadas; entrega autorizada por commit/push a develop.
El propietario realiza el despliegue manual. Después debe pulsar **Armar ruta**
en el borrador para obtener un cálculo con la nueva política. Las rutas ya
iniciadas conservan sus snapshots. La mejora opera con los clientes y camionetas
incluidos en cada plan; los nombres de este documento son evidencia de prueba.
