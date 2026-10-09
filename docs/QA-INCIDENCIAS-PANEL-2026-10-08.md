# Incidencias: panel, Visto y alarmas — QA 2026-10-08

Alcance autorizado: IO-T03/04, exclusivamente Ana Rutas develop. El propietario
aprobó «Sí, continúa con APK y panel». No se accedió a EasyPanel, Odoo ni
producción; no se desplegó ni se migró una base remota.

## Comportamiento entregado

- Incidencias conserva las cuatro clases reportables y el Excel existente de
  nueve columnas. El editor permite departamento, concepto y comentarios;
  el comentario original y la auditoría se conservan.
- Incidencias en vivo agrupa por chofer y después por tipo. Incluye devolución,
  faltantes, reposiciones y casos operativos. Las tardanzas están abajo,
  separadas. Puntos corregidos y reglas GPS permanecen disponibles.
- Las tarjetas nuevas muestran borde rojo. Visto es compartido: la primera
  escritura válida fija nombre/hora del administrador para todos. No resuelve
  la incidencia ni cambia importes, cantidades o entrega.
- Configuración compartida de alarma: 5/10/15 segundos, con versión y auditoría.
  Activar sonido requiere un gesto del navegador. Las pestañas de la misma
  instalación y cuenta coordinan una sola ráfaga mediante Web Locks.
  Cada equipo conserva su capacidad de reproducir avisos hasta que se marcan.
- Las novedades se detectan por inserción confirmada, no por fecha de captura.
  El histórico anterior a migración47 queda silencioso sin inventar Visto.
  Ediciones, filtros y paginación no generan novedades.
- Centro de control conserva sus pantallas independientes y desplazamiento
  interno. Sus tarjetas muestran incidencia/comentarios y contraen los detalles
  secundarios. La vista completa muestra los detalles abiertos.

## Persistencia, concurrencia y límites

La migración47 añade configuración, notificaciones y vista de lectura.
No reescribe el origen de incidencias ni tablas financieras. Tres triggers de
inserción registran producto/caso/tardanza en la misma transacción. La secuencia
se asigna bajo un advisory lock transaccional: un commit posterior visible no
puede saltarse un identificador menor todavía sin confirmar. Rollback e
idempotencia del comando conservan las garantías anteriores.

Visto usa UPDATE con seen_at IS NULL y auditoría sólo cuando cambia la fila.
Dos administradores concurrentes reciben el mismo primer resultado. La
configuración usa bloqueo de fila y versión esperada. Las consultas conservan
un corte REPEATABLE READ, cursores ligados al filtro y páginas acotadas.

El cliente guarda sólo secuencias/alcance opaco, nunca datos de clientes. Drena
páginas de100 antes de avanzar el cursor y coordina la ráfaga entre pestañas.
Al reconocer todos sus avisos se detiene; nuevas llegadas durante una ráfaga no
la prolongan indefinidamente. SSE actualiza tarjetas y lectura; un sondeo de15s,
focus y recuperación de conexión reparan interrupciones. Las lecturas del audio
tienen un plazo de15s. Salir del panel detiene el sonido y descarta inicios tardíos.

El navegador, volumen del equipo o suspensión pueden impedir audio. El panel
lo indica sin quitar avisos rojos. Las pruebas verifican Web Audio real y
temporización del navegador; no certifican altavoces físicos. La APK0.8.23
mantiene el límite de QA físico documentado en QA-INCIDENCIAS-APK-2026-10-08.md.

## Evidencia y reproducción

Todo se ejecuta con PostgreSQL17 efímero en loopback, HTTP real, JPEG reales y
Chrome instalado. No mocks ni consultas Google/Odoo/OpenAI.

1. npm run typecheck; npm run lint; npm run build.
2. npx vitest run --config vitest.incident-board.config.ts --coverage.
3. node scripts/verify-incident-board-mutations.mjs.
4. npx playwright test tests/e2e/product-incidents.spec.ts tests/e2e/control-center.spec.ts.
5. Regresión de producto/evidencia/cancelación, ejecución, finanzas y migraciones
   con los comandos detallados debajo.
6. npm audit --omit=dev --json y npm audit --json.

La migración v46→47 se reconstruye con incidentes previos y se ejecuta dos veces
concurrentes. También se repiten los upgrades históricos existentes; sus
fixtures retiran primero la vista nueva al reconstruir esquemas anteriores.
No se eliminan ni debilitan invariantes de aplicación para hacerlos pasar.

Cobertura dirigida de los tres módulos nuevos de servidor:100% líneas, ramas
y funciones. No equivale a cobertura global ni a cobertura de todas las
instrucciones SQL: éstas se comprueban con contratos PostgreSQL y mutaciones.
Objetivo95% líneas/90% ramas/100% funciones, elegido por riesgo de pérdida de
avisos y reconocimiento compartido; invariantes críticas verificadas individualmente.

Mutation testing dirigido:14/14 cambios incorrectos detectados. Incluye primer
Visto, auditoría idempotente, actor falsificado, duración/CAS, cursor duplicado,
avisos ya leídos, páginas saltadas, filtro cambiado, ocultamiento de devoluciones,
comentario efectivo, tardanzas y orden de commits. La primera ejecución dejó
sobrevivir el cambio de filtro; se añadió una regresión con cursor válido de
otro filtro y la repetición completa detectó los14.

Complejidad ciclomática modificada (ESLint, no umbral global): servidor máximo12;
coordinador de audio máximo12; UI máximo26 en BoardSection y25 en IncidentCard.
La UI incluye ramas de presentación por tipo/estado. Se revisaron conexiones
de lectura, fotos, reconocimiento y resolución por separado; no se añadieron
ramas a las funciones financieras. No se declara complejidad cero.

Auditoría productiva:0 vulnerabilidades. Auditoría completa:5 avisos heredados
de herramientas de desarrollo, misma excepción develop aprobada previamente.
Sin cambios de dependencias. Lint:0 errores y1 aviso heredado del archivo
stryker.product-amendments.config.mjs.

Logs locales: .local/io-board-*.log/json; capturas en
.local/qa/incident-organization y .local/qa/control-center.
### Resultado final y métricas

- 109 pruebas distintas de servidor verificadas: 50 de incidencias/finanzas,
  57 de migraciones y regresiones conectadas, y 2 del nuevo núcleo con múltiples
  escenarios reales de concurrencia, paginación, permisos y recuperación.
- 10 E2E distintos verificados. La pasada conjunta cerró con 9 correctos y una
  expectativa antigua del Centro de control. Se adaptó la comprobación a las
  agrupaciones nuevas y a «Ver detalles», manteniendo scroll, acciones visibles
  y pruebas de navegación. La repetición de ese recorrido pasó en 17.3 s,
  sin cambios posteriores en código de aplicación.
- Los primeros ensayos de upgrades detectaron dependencias de la vista nueva
  al reconstruir esquemas históricos. Se corrigieron sólo esas fixtures y se
  repitieron sus suites: 11/11 y 1/1 correctas. No quedan fallos conocidos de
  esta validación; los logs de los ensayos fallidos se conservan como evidencia.
- 15 lecturas secuenciales con 114 filas en PostgreSQL local: p50 13.83 ms,
  p95 19.74 ms. 15 reconocimientos nuevos: p50 4.38 ms, p95 5.50 ms.
  No es una prueba de capacidad ni un SLO de producción.
- Propagación observada entre administradores: 353 ms en el escenario E2E.
  Es una observación individual; no acredita el objetivo p95 de 2 segundos
  bajo carga productiva. Recuperación offline verificada con 105 avisos,
  páginas de alertas 100+5 y tarjetas 50+50+5.
- Duración observada en navegador: alarma de 10 s = 10,000 ms;
  alarma de 15 s = 14,993 ms. Activación de 5 s y coordinación de dos pestañas
  verificadas. El tiempo se mide sobre el estado real del coordinador Web Audio,
  no incluye latencia HTTP y no mide el sonido de altavoces físicos.
- Cero errores de página en los recorridos comprobados; vista móvil de 390 px
  sin desbordamiento horizontal. Capturas desktop/móvil revisadas visualmente.

Comandos de regresión de servidor ejecutados, además de la suite de cobertura:

```powershell
npx vitest run tests/driver-incidence-schema.test.ts tests/driver-service-commands.test.ts tests/driver-service-schema.test.ts tests/fleet.test.ts tests/product-incidents.test.ts tests/product-incident-organization.test.ts tests/product-incident-admin-cancel.test.ts tests/product-incident-photos.test.ts tests/financial-store.test.ts tests/live-warehouse-integration.test.ts
npx vitest run tests/customer-unloading.test.ts tests/customer-windows-daily.test.ts tests/driver-mobile-phone-migration.test.ts tests/driver-route-completion.test.ts tests/google-consumption-persistence.test.ts tests/live-eta-integration.test.ts tests/orders.test.ts tests/plan-creation-migration.test.ts tests/recalculation.test.ts tests/route-publication-revisions.test.ts tests/route-publications.test.ts tests/unit-photo-retention.test.ts tests/unloading-learning.test.ts
npx playwright test tests/e2e/control-center.spec.ts --grep 'independent drivers'
```

## Matriz de aceptación

| Reglas | Evidencia |
| --- | --- |
| IO01..14 | B1/B2, product-incident-organization, HTTP/Chrome/Excel y APK |
| IO15..18 | Agrupación real, retorno separado, secciones, dos administradores |
| IO19..25 | Carrera de Visto/CAS, dos pestañas, Web Audio5/10/15, filtros/edición |
| IO26..28 |105 avisos, páginas100+5, navegador offline/reconexión, fecha antigua |
| IO29..32 | Histórico sin notificación, instalación/upgrade, lock de commit y rollback |
| IO33 | Driver execution inalterada, regresiones financieras y exportación privada |

Validación local cerrada para entrega autorizada a develop. El deploy sigue a
cargo del propietario: primero actualizar backend/panel y después instalar la
APK 0.8.23 de develop para probar los formularios nuevos. Su archivo está en
el escritorio y su SHA-256 está documentado en el QA de APK. Main, producción
y las bases remotas no se modificaron durante estos bloques.
