# QA — recepción anticipada y destinos compartidos

Contrato: [BLOQUE-RECEPCION-ANTICIPADA.md](BLOQUE-RECEPCION-ANTICIPADA.md).
Escenarios RA01..10: `tests/acceptance-early-reception.feature`.

## Autopsia y corrección comprobada

La lectura del mapa remoto `prueba 13`, v14, mostró dos puntos con dos
camionetas: Mariscos Chatos/Sanborns y GÜI/Sylvestre. El agrupador incluía las
ventanas en la identidad física y obligaba a esperar la apertura. La política
v5 reúne coordenadas exactas independientemente del horario; permite recibir
desde la salida y conserva el cierre más restrictivo de todos los miembros.
Pedidos, clientes, descarga por cliente y prioridades mantienen su identidad.

La prueba real detectó otro defecto del flujo: Google reportó tres esperas
negativas y marcó insuficiencias por tráfico. El parser anterior rechazaba el
reparto completo. Ahora sólo en rutas expresamente marcadas traslada el déficit
a los relojes posteriores, descuenta la espera positiva disponible y conserva
vehículos, secuencia, trazos y duración de conducción. Se contabiliza el ajuste
en diagnóstico/auditoría y se calculan atrasos con la ETA corregida.
Semántica: [referencia oficial ShipmentRoute](https://developers.google.com/maps/documentation/route-optimization/reference/rest/v1/ShipmentRoute).

## Prueba externa y límites

Una llamada Google con los 44 pedidos reales de la captura verificada del
2026-10-02, tres camionetas y salida08:00. Es la misma captura del recibo PH;
**no se presenta como una extracción nueva de v14 ni se guardó sobre ese plan**.
El intento de lectura JSON actual desde el navegador fue bloqueado por el
cliente; la autopsia de v14 se confirmó directamente en los marcadores visibles.

| Métrica                                 | Resultado nuevo |
| --------------------------------------- | --------------: |
| Pedidos conservados                     |           44/44 |
| Visitas físicas                         |              39 |
| Puntos con más de una camioneta         |               0 |
| Puntos abandonados y revisitados        |               0 |
| Espera artificial por apertura          |             0 s |
| Distancia                               |      220.678 km |
| Conflictos de prioridad                 |               0 |
| Atrasos previstos                       |               3 |
| Déficit de tráfico propagado al regreso |           374 s |

| Camioneta del caso | Pedidos | Distancia | Regreso local |
| ------------------ | ------: | --------: | ------------- |
| Expert             |      13 | 85.812 km | 13:55         |
| ford2025           |      15 | 83.279 km | 14:31         |
| Ford2026           |      16 | 51.587 km | 14:16         |

Contra el recibo PH sobre la misma captura:228.703→220.678km,8.025km menos.
No es comparación con el total de v14 ni garantía de óptimo global.
Hotel Moto llega3m48s tarde, Tapatío6m02s y Banquetes I latina12s. Estas tres
advertencias se ven en el panel; no se sustituyen por ceros ni se garantiza que
el caso cumpla todos los cierres. Compartir avenidas no equivale a compartir
destinos; la exclusividad de calles no es una restricción del modelo.

Se conservan localmente solicitud, respuesta original, resultado adaptado y
resumen en `codex-route-audit-20261004` del Temp del usuario. Una reproducción
sin red comparó el modelo final por igualdad profunda con la solicitud enviada,
y pasó parser, guardas, expansión, cobertura y comprobación de puntos únicos.

## Puertas de calidad

- Regresión roja: siete contratos nuevos fallaban antes de la corrección.
- Suite final afectada: **219/219**, incluyendo unidad, contratos de modelo,
  recálculo, adaptación Google y PostgreSQL real. Cobertura medida de diez
  módulos: **96.37% líneas** (905/939), **96.17% sentencias** (1006/1046),
  **94.26% ramas** (559/593), **98.55% funciones** (273/277).
- Recepción, agrupación/modelo directo, descarga, alternativas temporales y
  corrección de tráfico: **100% líneas, ramas, sentencias y funciones**.
  La función de horario manual también queda ejercitada antes/durante/después
  del cierre. El resto sin cobertura del lector vial corresponde mayormente
  al transporte no modificado; no se confunde esa cobertura parcial con100%.
  Umbral por riesgo del conjunto95% líneas/sentencias/funciones y90% ramas.
- **41/41 mutantes detectados por aserciones**, baseline117/117, en copia
  aislada. Incluye separación por ventanas, cierre equivocado, espera artificial,
  pérdida de servicio, déficit de tráfico, retorno, flota y respuesta inválida.
- Regresión global consolidada: **1,034 aprobadas,0 fallos pendientes y3
  omisiones externas previas**. La corrida completa inicial tuvo1,021 aprobadas
  y7 expectativas antiguas fallidas; se actualizaron al contrato de recepción
  anticipada y se reejecutaron íntegramente sus archivos en la suite final219.
  El reporte consolidado reemplaza suites completas por su ejecución más reciente;
  no suma ejecuciones repetidas ni borra casos con el mismo nombre parametrizado.
- E2E nuevo: **1/1 aprobado**,28.2s de ejecución, con lectura real de Odoo,
  PostgreSQL y HTTP/Chrome. Conserva44pedidos,0destinos compartidos, advertencias,
  filtros y retirada del snapshot obsoleto al mover un pedido. Seguridad:
  anónimo401, origen ajeno403 y liquidador403. No intercepta APIs ni inventa
  respuestas externas; usa el recibo real guardado de esta llamada Google.
- Typecheck, lint y build aprobados. Lint0errores,1aviso preexistente en
  `stryker.product-amendments.config.mjs`. Build final9.5s de compilación y5.7s TS.
- Dependencias productivas: `npm audit --omit=dev`,0vulnerabilidades.
  Sin cambios de permisos, SQL, migraciones, contratos financieros ni Android.
- Rendimiento:100construcciones por versión, intercaladas tras calentamiento,
  sin red. p95 anterior55.64ms; nuevo46.32ms, p50nuevo27.67ms. Referencia local
  p95<100ms cumplida; no es un SLO medido del servicio Google.
- Complejidad de recepción2, alternativas2 y función de tráfico1 (su cierre
  interno4), medida con ESLint. No se agregan límites por cliente o flota.
- Evidencia visual: `reports/screenshots/zone-time-early-{desktop,mobile}.png`,
  1440px y390px sin desbordamiento. El mapa base no tiene clave en el entorno
  aislado; los trazos se verifican en el recibo real y persistencia, no se
  presentan esas capturas como prueba del mapa base.

La configuración privada de pruebas permaneció fuera del repositorio y se eliminó
al acabar; se comprobó su ausencia. Datos extensos, reportes y capturas quedan
locales e ignorados por Git.
Las3omisiones preexistentes son contrato financiero Odoo, imágenes Odoo y FCM,
ajenos al bloque. Los contratos heredados con transporte inyectado no se
presentan como llamadas reales a Google.

## Reproducción

Node24 y dependencias del lockfile; desde ana-rutas:

```text
node node_modules/vitest/vitest.mjs run --config vitest.zone-time.config.ts --coverage
node scripts/verify-zone-time-mutations.mjs
node node_modules/vitest/vitest.mjs run
npm run typecheck
npm run lint
npm run build
npm audit --omit=dev
node node_modules/@playwright/test/cli.js test tests/e2e/route-zone-time-live.spec.ts --grep "early reception"
```

El E2E requiere las variables Odoo privadas de desarrollo y
`RUTAS_QA_ZONE_TIME_CAPTURE_DIRECTORY`, con `input-projection.json`,
`early-google-request.json` y `early-result.json`. Su ausencia omite la prueba
explícitamente. Evidencia local adicional: `.local/early-regression.json`,
`.local/early-contracts-final.json`, `reports/early-regression-consolidated.json`,
`reports/mutation/zone-time.json`, `reports/early-metrics.json`.

Entrega a develop autorizada. El propietario despliega manualmente y vuelve a
armar el borrador para obtener la política v5. No se alteró el plan remoto,
no se publicó ninguna ruta y no se modificó main.
