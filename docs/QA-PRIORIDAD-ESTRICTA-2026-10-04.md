# QA — prioridad estricta por camioneta

Contrato aprobado: [BLOQUE-PRIORIDAD-ESTRICTA.md](BLOQUE-PRIORIDAD-ESTRICTA.md).
Escenarios SP01..12: `tests/acceptance-strict-priority.feature`.

## Causa y resultado

La captura del propietario de `prueba 13`, v15, mostraba clientes por horario
antes de otros altos. El modelo v5 promovía el punto compartido al rango máximo
y la expansión calculaba conflictos con ese rango; no comprobaba la prioridad
individual de los clientes. La preferencia finita de Google tampoco prohibía
todas las inversiones. El nuevo contrato exige altas, medias y por horario
independientemente en cada camioneta, incluso si debe revisitar un punto.

La política v6 conserva la asignación Fleet y comprueba el orden expandido por
cliente. Sólo cambia la secuencia de los vehículos afectados; Routes vuelve a
medir esos recorridos con descarga y regreso. Compactar un punto compartido
únicamente se permite cuando toda la secuencia conserva prioridad creciente.
Las demás camionetas conservan tiempos y trazos originales. Una falla durante
la medición no entra en la recuperación de Fleet ni cambia la asignación.

## Procedencia del caso real

Odoo de desarrollo se leyó nuevamente por los folios de los 44 pedidos; no se
escribió en Odoo ni se alteró el plan remoto. La configuración operativa se
reconstruyó en PostgreSQL aislado desde la captura verificada del 2026-10-02.
Se configuró Hotel Moto como alta solamente en esa copia de QA, conforme a la
captura v15 del propietario. `source-projection.json` registra esa procedencia;
`input-projection.json` conserva el tablero efectivamente enviado a Google.
Esta prueba no se presenta como una extracción nueva del borrador remoto v15.

La prueba opcional `route-strict-priority-live.test.ts` ejecutó Fleet y Routes
reales, registró los recibos y comprobó guardado, reserva y versiones en PG.
El navegador reutilizó ese recibo real mediante PostgreSQL y HTTP auténticos;
no interceptó respuestas de APIs. Para la fecha histórica, la camioneta
corregida usa la modalidad vial estática existente; no certifica tráfico futuro.

| Medida final                         |    Resultado |
| ------------------------------------ | -----------: |
| Pedidos preservados                  |        44/44 |
| Camionetas                           |            3 |
| Reparto conservado                   | 11 / 16 / 17 |
| Solicitudes Fleet                    |            1 |
| Camionetas recalculadas              |            1 |
| Lecturas de tramos Routes            |           11 |
| Coordenadas exactas distintas        |           39 |
| Visitas físicas consecutivas         |           40 |
| Puntos de dos camionetas             |            0 |
| Revisitas por prioridad individual   |            1 |
| Inversiones de prioridad por cliente |            0 |
| Espera artificial por apertura       |          0 s |
| Atrasos previstos                    |            1 |
| Distancia total observada            |   231.706 km |
| Duración del cálculo real            |     48.126 s |

Expert quedó: ANUNCIOS, Hotel Moto y Santo Coyote (altas), Sanborns (media),
Mariscos Chatos, Colimita y el resto por horario. Chatos se atiende en el punto
de Sanborns una vez concluidas las medias. Colimita exige volver al punto de
Hotel Moto después de las altas y la media. Todas esas entregas pertenecen a
Expert, sin mandar otra camioneta a ese punto. Los otros dos vehículos retienen
sus secuencias completas. No hay reglas de producción con esos nombres o IDs.

Zinclote conserva un atraso de 481 s (8 min 1 s; el panel redondea a 9 min).
Se verificó su aviso visible. No se promete óptimo global ni todos los cierres
cumplidos. No se comparan distancias entre corridas con diferentes soluciones
Fleet como si fueran una medición causal de mejora.

## Puertas de calidad

- Regresión roja previa: el contrato del punto mixto expuso que v5 ocultaba
  inversiones de prioridad individual; 40 pruebas verdes y esa prueba fallida.
- Suite final afectada: 245 aprobadas, cero fallos; el caso opcional de red se
  omite sin credenciales y pasó por separado con Odoo/Google/PG reales (1/1).
  El archivo del módulo nuevo aporta 25 contratos puros sin transporte fingido,
  incluyendo flotas 1/2/4/5/6, puntos mixtos, índices, contigüidad, medición y fallos.
- Cobertura medida de 11 módulos: 96.67% líneas (988/1022), 96.48% sentencias
  (1097/1137), 94.56% ramas (592/626), 98.69% funciones (303/307). Umbrales
  justificados por integridad del cálculo: 95% líneas/sentencias/funciones y
  90% ramas. El módulo nuevo tiene 100% en las cuatro medidas: 83 líneas,
  91 sentencias, 35 ramas y 33 funciones. El módulo directo también tiene 100%.
  El transporte vial heredado conserva cobertura parcial; no se declara 100%
  de todo el servicio ni se atribuyen llamadas reales a contratos inyectados.
- Mutaciones: 56/56 detectadas por aserciones, baseline 143/143, en copia
  aislada. Incluye orden inverso, punto repartido, respuesta incompleta,
  corrección omitida, subconjunto incorrecto, índices globales, totales y
  compactación omitida o que adelanta indebidamente una entrega por horario.
- Regresión consolidada: 1061 aprobadas, cero fallos pendientes, tres omisiones
  externas preexistentes. La corrida global inicial tuvo 1059 aprobadas y una
  falla del contrato de compactación, con el helper previo cargado antes de
  completar esa corrección. La suite final completa de ese archivo, el conjunto
  afectado y las pruebas posteriores pasaron con el código definitivo. El reporte
  reemplaza archivos completos por su ejecución más reciente; no suma pruebas
  repetidas ni afirma que hubo una única corrida global totalmente verde.
  Las tres omisiones ajenas son contrato financiero Odoo, imágenes Odoo y FCM.
- Auditoría de publicación: el snapshot ordena por posición; la ejecución
  agrupa sólo pedidos consecutivos del mismo cliente, conservando las revisitas
  de distintos clientes. 37 contratos adicionales de publicación y ejecución
  aprobados, incluidos PG reales. No se modificaron esos módulos ni Android.
- E2E final: 1/1 aprobado, 16.1 s, HTTP/Chrome/PG reales sobre el recibo final.
  Comprueba 44 pedidos, posiciones, prioridad, un vehículo por punto, avisos,
  filtros y retirada del forecast tras editar. Seguridad: anónimo 401, origen
  ajeno 403, liquidador 403. Una configuración real sin proveedores devuelve
  503, conserva pedidos y runId y libera la reserva, sin respuesta interceptada.
- El cálculo real rechaza otra reserva concurrente, versión anterior del plan
  y versión incompatible de configuración. Persiste un único resultado y
  libera su reserva. Los contratos críticos también rechazan duplicados,
  omisiones, pedidos excluidos e índices inválidos antes de guardar.
- Typecheck, lint y build finales aprobados. Lint: cero errores, un aviso previo
  en `stryker.product-amendments.config.mjs`. Build: compilación 13.6 s y TS
  7.8 s. `npm audit --omit=dev`: cero vulnerabilidades.
- Rendimiento local con 44 pedidos y tres vehículos: 100 muestras tras 20 de
  calentamiento, p50/p95 del modelo 29.86/32.55 ms; secuencia estricta
  0.089/0.157 ms. Referencia p95 menor a 100 ms cumplida. Son medidas locales,
  no un SLO de Google ni garantía de latencia productiva.
- Complejidad ESLint medida: máximo 6 en funciones nombradas del módulo nuevo;
  compactación 4 en su callback, guarda final 2. Orquestador existente 32;
  guarda de respuesta directa 13. La medición usa umbral cero para emitir datos
  y no se confunde su salida diagnóstica con el lint de calidad, que está verde.
- Capturas: `reports/screenshots/zone-time-strict-{desktop,mobile}.png`,
  1440 px y 390 px. El mapa base carece de clave en el servidor aislado;
  trazos y distancias se verifican en los recibos reales y persistencia, no se
  presentan las capturas como prueba del mapa base. No hay cambios visuales.

Los reportes extensos, capturas y recibos permanecen locales e ignorados por
Git. La configuración privada temporal se eliminó al terminar y se verificó
su ausencia; la revisión de los archivos entregados no encontró sus secretos.

## Reproducción

Node 24 y dependencias del lockfile, desde el repositorio:

```text
node node_modules/vitest/vitest.mjs run --config vitest.zone-time.config.ts --coverage
node scripts/verify-zone-time-mutations.mjs
node node_modules/vitest/vitest.mjs run
node node_modules/vitest/vitest.mjs run tests/route-publication-content.test.ts tests/route-publications.test.ts tests/driver-execution-policy.test.ts tests/driver-execution.test.ts
npm run typecheck
npm run lint
npm run build
npm audit --omit=dev
node node_modules/vitest/vitest.mjs run tests/route-strict-priority-live.test.ts
node node_modules/@playwright/test/cli.js test tests/e2e/route-zone-time-live.spec.ts --grep "strict-priority"
```

Las dos últimas pruebas requieren variables privadas Odoo/Google de desarrollo
y `RUTAS_QA_STRICT_PRIORITY_CAPTURE_DIRECTORY`. Primero se proporciona
`source-projection.json` verificado con tablero, settings y timezone; la prueba
real escribe `input-projection.json`, `strict-google-request.json`, respuesta,
resultado durable, resumen y logs. Chrome usa ese recibo final. La ausencia de
configuración omite explícitamente la prueba, no inventa integraciones.

Evidencia adicional: `.local/strict-priority-{regression,focused-final,live,downstream}.json`,
`reports/strict-priority-regression-consolidated.json`,
`coverage/zone-time-focused/coverage-summary.json`, `reports/mutation/zone-time.json`,
`reports/strict-priority-performance.json` y `.local/strict-priority-complexity.json`.

Entrega a develop conforme a autorización permanente. El propietario despliega
y vuelve a Armar ruta para generar v6. El bloque no recalcula ni modifica por
sí solo el borrador remoto existente; no cambia main ni genera una APK.
