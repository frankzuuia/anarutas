# Liquidación completa y cierre de trabajo — 2026-10-01

## Alcance confirmado

BL179..182, FW-T01..04 y LR01..24 de
PROPUESTA-LIQUIDACION-RUTA-2026-10-01.md. El propietario confirmó que la
liquidación se hace en bodega y que Finalizar trabajo sólo se habilita después
de la recepción completa del liquidador. CP12 conserva Terminar ruta con su
comprobación operativa de regreso; no se introduce una segunda política GPS.

El ajuste Android de cantidad final está en LC17 y en el commit 94007cf:
cuatro ADES menos tres devueltos muestra una unidad física restante. No se
obtienen unidades mediante divisiones de dinero ni se reescribe el recibo.

## Autopsia y solución

La acción de toda la ruta existía, pero estaba mezclada con el historial y con
el cierre operativo; faltaba un cierre durable de trabajo posterior a recepción.
El panel ofrecía la decisión agrupada dentro del historial y no un paquete
navegable. Android leía quantity original en su ticket aunque physicalRemaining
ya estaba calculado en el snapshot.

La lectura financiera incorpora routeSettlement con selección, totales y basis,
y work con elegibilidad, resumen, basis y cierre confirmado. La solicitud
agrupada revisada usa el mismo mecanismo de reservas y recepción existente;
excluye cobros aceptados y bloquea solicitudes pendientes que se solapen.
Los comandos antiguos sin basis mantienen el hash anterior y su recuperación.

El esquema40 agrega route_driver_work_completions. Finalizar trabajo conserva
autenticación del dispositivo, propietario de ejecución, bloqueo de ejecución,
serialización por dispositivo/comando, revisión del resumen e idempotencia.
El trigger SQL comprueba identidad, cierre operativo, recibos completos,
aceptación de todos los recibos y cada valor del resumen. Impide UPDATE/DELETE.
No modifica dinero, pedidos, incidencias ni tablas financieras anteriores.

El resumen cuenta pedidos entregados y los identificadores únicos de incidencias
de producto activas congeladas en los recibos; no cuenta fotos o incidencias
canceladas. Suma expected neto de todos los recibos, incluyendo crédito y cobros
recibidos antes individualmente. Separa las monedas. La validación SQL usa la
misma identidad id/nombre que paymentTotals y conserva los metadatos del último
recibo: una precisión monetaria que cambie entre cobros no bloquea el cierre ni
autoriza un total o metadata adulterados.

El panel muestra tarjeta neutral y compacta del paquete, pedidos clicables y
los tickets individuales existentes. Cancelar no decide una solicitud. Aceptar
abre la confirmación versionada existente. Una recepción completa por pedidos,
incluso después de un rechazo agrupado, permite consultar todos los tickets y
finalizar sin reenviar cobros. El modal contiene el scroll y mantiene botones
accesibles con cincuenta pedidos.

Android coloca Liquidar toda la ruta al final de la pantalla tras Terminar ruta.
Congela la revisión del modal y usa el outbox cifrado existente. Finalizar
trabajo depende de work.eligible y muestra Buen trabajo únicamente después
de leer el cierre confirmado. El resumen se puede volver a consultar. Los
eventos incorporan el cierre al fingerprint del chofer propietario.

## Evidencia automatizada

| Puerta | Resultado medido |
| --- | --- |
| Regresión general | 922 pruebas aprobadas, 0 fallos; 3 omisiones externas preexistentes identificadas abajo |
| Financiera/contratos/PG | 72 pruebas aprobadas, 0 fallos; PostgreSQL real aislado |
| Política de ruta/trabajo | 100% líneas 32/32, ramas18/18, funciones24/24 |
| Comando de cierre | 100% líneas28/28, ramas17/17, funciones4/4 |
| Subconjunto financiero afectado | 99.69% líneas323/324, 98.34% ramas297/302 |
| Mutación política nueva | 93/93 detectadas, 0 sobrevivientes, 0 sin cobertura, 0 errores |
| Mutación guards nuevos/SQL | 10/10 detectadas por aserciones sobre PostgreSQL real; baseline1/1 verde |
| Mutación guards financieros anteriores | 20/20 detectadas por aserciones sobre PostgreSQL real; baseline15/15 verde |
| Cantidad final Android | Selector100% líneas; 2/2 mutaciones detectadas, evidencia LC17 vigente |
| E2E HTTP/Chrome/PG | 3 escenarios aprobados: paquete restante47.8s, cincuenta pedidos31.6s, recepción individual tras rechazo23.0s |
| Eventos y esquema nuevo | 12/12 pruebas aprobadas; tabla27 incluida y sesiones excluidas |
| JVM Android | 140 pruebas, 0 fallos, 0 errores |
| Android app/instrumentación | Compilación aprobada; lint0 errores/35 avisos anteriores |
| Build/typecheck/migrador | Aprobados; migración39→40 repetible y cierre inmutable preservado |
| Dependencias productivas | npm audit --omit=dev: 0 vulnerabilidades |
| Secretos cliente | Sin coincidencias de credenciales privadas de la configuración local en artefactos de navegador |
| Complejidad | Estimación AST de funciones nombradas nuevas: máximo5; callbacks anidados excluidos por el procedimiento existente |

Las tres omisiones de la regresión corresponden exclusivamente a pruebas externas
anteriores: financial-odoo-live requiere RUTAS_TEST_FINANCIAL_TARGETS,
product-thumbnails requiere RUTAS_TEST_IMAGE_PRODUCT_ID y route-push requiere
ANA_RUTAS_LIVE_FCM_QA=1. No se añadieron omisiones ni se simularon proveedores.
Los E2E se aprobaron en sus últimas ejecuciones: paquete restante y recepción
individual tienen logs finales separados; el escenario de cincuenta pedidos
está verde en work-e2e.log. La instrumentación física conserva la excepción
del propietario indicada abajo.

Métricas locales: lectura financiera25 muestras, p95 92.2ms y máximo92.6ms;
dos finalizaciones HTTP concurrentes con el mismo comando31.822ms/35.3949ms;
incorporación de un cobro nuevo al tablero306ms, sin desplazar las tarjetas
anteriores. Se midieron con Next compilado y PostgreSQL aislado en esta PC;
no son una prueba de carga ni un SLO de producción. El índice driver_work_owner
se verificó adicionalmente en PG tras agregarlo para el fingerprint por propietario.

La QA detectó y corrigió la lista de versiones admitidas del esquema, el conteo
de triggers para la tabla nueva y la agrupación SQL de monedas con precisiones
distintas entre recibos. La regresión final completa quedó verde. Una aserción
E2E de texto concatenado sin espacio se corrigió para verificar etiqueta e
importe por separado; no requirió modificar el comportamiento del producto.

Los mutants usan copias descartables bajo .local, patrones únicos y limpieza
con ruta validada. Nunca alteran el checkout ni un servicio externo. Sólo se
contabilizan fallos de aserciones; una interrupción de compilación no prueba
que se detectó un cambio incorrecto. El 100% en la lógica nueva se justifica
por riesgo monetario y de cierre; no se compensa una rama crítica sin probar
con la cobertura promedio de otro archivo. El SQL se valida mediante
integración y mutaciones, no mediante una cifra de cobertura V8.

Las pruebas dirigidas cubren revisión obsoleta, rechazo/liberación/reenvío,
aceptación parcial, exclusión de recibos aceptados, permisos, aislamiento,
idempotencia, reintentos simultáneos, resumen exacto, inmutabilidad, metadatos
monetarios cambiantes y actualización del fingerprint sin afectar otro chofer.

## Reproducción

Desde la raíz del repositorio, con Node instalado y dependencias del lockfile:

```powershell
npm test
npx vitest run --config vitest.settlements.config.ts --coverage
npx stryker run stryker.route-work.config.mjs
node scripts/verify-work-mutations.mjs
node scripts/verify-settlement-mutations.mjs
npm run typecheck
npm run lint
npm run build
npm run bundle:migration
npx playwright test tests/e2e/settlements.spec.ts tests/e2e/settlement-volume.spec.ts tests/e2e/route-individual-reception.spec.ts
node --import tsx scripts/quality-metrics.ts
npm audit --omit=dev --json
```

Desde driver-app, con el SDK real configurado y las propiedades existentes:

```powershell
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest createDebugUnitTestCoverageReport --console=plain
```

Logs en .local/qa-settlements/work-*.log: work-full-final.log,
work-e2e-http-final.log, work-e2e-individual-final.log,
work-existing-guard-mutations.log y work-integration-mutations.log.
Métricas HTTP en work-command-timing.json y timing.json; cobertura en coverage/settlements;
mutaciones en reports/mutation/route-work.json, work-integration.json y
settlements-integration.json. Los fixtures usan PostgreSQL real y comandos
operativos reales con datos de dominio deterministas; no simulan Odoo o Google
ni escriben en esos servicios.

## APK y QA física del propietario

Artefacto .local/releases/ana-rutas-driver-0.8.16-liquidacion-ruta.apk,
versión0.8.16/code38, 69,147,470 bytes, minSdk26. SHA256:
82643CBCE3427D99644CD95380ECE90334F73D35AA710A02E4AAF186B90F1514.
apksigner verificó la firma; certificado SHA256
f92d2160eccdadb8b72ac5573ef07dc09eb8fdd57c10621d33afaeb7dd4c2e35,
igual al de las APK anteriores de desarrollo. Se puede actualizar conservando
datos del dispositivo.

La instrumentación Compose está compilada, no ejecutada en dispositivo.
Se conserva la excepción física aprobada por el propietario el2026-09-30.
Procedimiento después de desplegar develop:

1. Actualizar la APK; comprobar ADES4 devueltos3 → cantidad final1 y descuento
   original intacto en ticket del chofer y panel.
2. Volver a bodega y confirmar Terminar ruta. Verificar acción agrupada al
   final de Liquidación de rutas, revisión por medios y Cancelar sin solicitud.
3. Enviar el paquete y comprobar aparición automática de la tarjeta en panel.
   Abrir cada cliente y su ticket; confirmar cantidades, descuento amarillo y total.
4. Cancelar recepción y verificar que Finalizar trabajo sigue deshabilitado.
   Aceptar en la cuenta liquidadora y comprobar actualización automática Android.
5. Finalizar trabajo: ver Buen trabajo con cantidades y dinero reales.
   Consultar nuevamente el resumen después de salir/reabrir.
6. Interrumpir conexión durante envío y recuperación; conservar el mismo comando,
   un solo registro y la confirmación recibida. Probar texto ampliado, scroll
   de cincuenta pedidos, Atrás y retorno al listado de mis rutas.

Commit/push sólo develop bajo autorización permanente. El deploy y la QA física
los realiza el propietario; esta evidencia no equivale a una certificación de
dispositivo ni a despliegue de producción.
