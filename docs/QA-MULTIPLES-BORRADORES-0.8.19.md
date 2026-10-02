# QA — varios borradores y otra salida del mismo día

Fecha: 2026-10-01. Origen: develop f1236c6. Aprobación del propietario:
«Sí, ejecuta estos bloques». Contratos BL186..187, matriz MB01..22 de
[MULTIPLES-BORRADORES-2026-10-01.md](MULTIPLES-BORRADORES-2026-10-01.md).

## Causa y comportamiento verificado

La restricción UNIQUE de route_plans.service_date y el ON CONFLICT de
createPlan convertían una nueva creación en una lectura del plan anterior.
La migración42 elimina exclusivamente esa unicidad. Cada intención nueva crea
un UUID y un borrador vacío, aunque fecha y nombre coincidan. No copia pedidos,
camionetas, fotografías ni cobros. Los planes anteriores conservan su identidad.

El formulario conserva commandId al reintentar los mismos datos. La transacción
comprueba al actor, serializa actor+commandId, guarda plan/solicitud/auditoría y
devuelve el mismo plan ante repetición. Normaliza las claves UUID antes del lock.
Reutilizar una clave con otros datos falla; borrar el plan no permite resucitarlo
con un reintento. Los clientes anteriores sin clave siguen creando planes nuevos.

Publicar otra salida no desplaza una ruta iniciada cuyo trabajo siga abierto.
El inicio consulta chofer y camioneta bajo el lock de flota existente: un recurso
ocupado impide otra salida, incluso en distinta fecha o después de reasignarlo.
Terminar sólo el recorrido GPS no libera el trabajo. Al recibir la liquidación y
finalizar trabajo, puede iniciar la nueva publicación con sus propias fotos.
La anterior sigue finalizada, consultable e independiente de la nueva ejecución.

La cancelación legítima conserva su comportamiento de liberación. No se cambia
la política de selección/importación de Odoo ni se escribe en proveedores.
El modo de prueba sin regreso a bodega permanece como lo autorizó el propietario.

## Evidencia y puertas

| Puerta | Resultado |
| --- | --- |
| Regresión TypeScript/PG consolidada | 955 pruebas verificadas: 954 de la corrida completa y 1 del archivo corregido; 0 fallos pendientes, 3 omisiones externas previas |
| Creación, migración, selección y segunda salida | 39 pruebas aprobadas, 0 fallos |
| Cobertura de los cinco módulos afectados | 100% líneas (58/58), 100% sentencias (63/63), 100% funciones (13/13), 95% ramas (38/40) |
| createPlan | 18/18 sentencias y 10/10 ramas ejecutadas |
| Mutación | 22/22 mutantes detectados por aserciones; 3 líneas base verdes; 0 sobrevivientes |
| Chrome/HTTP/PG | 8 recorridos aprobados: borradores/segunda salida, panel, móvil, liquidación, volumen y recepción individual |
| Android JVM | 150 pruebas aprobadas; 0 fallos, errores u omisiones |
| Android compilación | APK, instrumentación y cobertura JVM generadas; lint 0 errores/35 avisos previos |
| Web | Typecheck, lint, build y bundle de migración aprobados; 0 errores y 1 aviso previo de Stryker |
| Dependencias productivas | npm audit --omit=dev: 0 vulnerabilidades |
| Artefactos cliente | 14 archivos revisados, sin secretos locales privados expuestos |
| APK | 0.8.19/code41; firma verificada y compatible con la versión anterior |

El objetivo es validar todos los escenarios críticos de identidad, autorización,
aislamiento, concurrencia y liberación de recursos. Las dos ramas no recorridas
son los fallbacks preexistentes de rowCount nulo de deletePlan; PostgreSQL devuelve
un conteo en esos DELETE RETURNING. No se simula el motor para elevar el promedio.
Las ramas críticas nuevas están recorridas. La cobertura V8 de una consulta SQL
no mide las ramas del motor: migración, bloqueos e integridad se verifican mediante
PostgreSQL real y mutaciones que deben provocar fallos de aserción.

Los 22 mutantes comprueban: claves nuevas en reintentos, alias UUID, omitir actor
o clave, omitir autorización, no esperar el lock, ignorar cambio de fecha/nombre,
devolver otro plan, perder la solicitud al borrar, conservar unicidad por fecha,
invertir orden, omitir guardas, ignorar chofer/camioneta, liberar sólo por GPS,
bloquear trabajo ya cerrado, desplazar la ruta activa y reutilizar mal el formulario.

Migración41→42: restricción de fecha renombrada, rollback transaccional,
migradores concurrentes, instalación nueva y repetición. Las filas del plan,
pedidos, camionetas, publicación, ejecución y fotos existentes conservan su
contenido. El flujo de segunda salida verifica además que los tickets y el
resumen financiero anterior no cambien.

Seguridad: cuentas inactivas/inexistentes/liquidadoras rechazadas, origen HTTP
ajeno rechazado, conductor ajeno sin acceso, entradas inválidas sin escritura,
texto con sintaxis SQL conservado como dato, fallo real de auditoría con rollback
integral y reintento posterior válido. Dos inicios concurrentes generan una sola
ejecución para los recursos compartidos.

Mediciones locales con Next compilado y PostgreSQL aislado: creación108/75ms;
inicio de segunda salida21ms. No son una prueba de carga ni un SLO productivo.
Complejidad estimada por AST: createPlan2 y callback de transacción5;
assertRouteResourcesFree2; driverTodayPlan4; migrador1. El máximo de funciones
nombradas del núcleo sigue siendo30, previo a este cambio. La métrica separa
callbacks y no mide complejidad SQL.

Defectos de preparación de pruebas corregidos: el E2E general tenía selectores
ambiguos entre dos formularios de cuentas; ahora selecciona el formulario de
administradores. La prueba de concurrencia entre inicio y eliminación de foto
intentaba usar un chofer y camioneta ocupados por otro escenario. Se le asignaron
recursos independientes; la nueva guarda de recursos permanece activa. Ambos
recorridos pasaron de nuevo con sus aserciones originales de negocio.

La primera corrida completa registró954 aprobadas,1 fallo del fixture de fotos
y3 omisiones externas. Después de corregir únicamente ese fixture, su archivo
completo pasó de nuevo. No hubo cambios productivos después de la corrida inicial.
La segunda ejecución general no dejó reporte final y se excluye de la evidencia;
no se declara aprobada. reports/same-day-regression-consolidated.json identifica
las dos fuentes válidas y comprueba que se conservan las958 pruebas, con955
aprobadas y las3 omisiones. Los resultados de navegador también se consolidan
con la repetición aprobada del formulario corregido.

Las tres omisiones externas preexistentes requieren RUTAS_TEST_FINANCIAL_TARGETS,
RUTAS_TEST_IMAGE_PRODUCT_ID y ANA_RUTAS_LIVE_FCM_QA=1. No cambian esos conectores
ni se agregan omisiones. El fixture de cálculo persiste entradas del contrato en
PostgreSQL; no sustituye un proveedor ni demuestra una llamada Google. Las
llamadas de publicación, fotografías, cobro, recepción e inicio usan el código
real. No hay mocks de servicios ni escrituras Odoo.

## Reproducción

Desde la raíz, con el lockfile instalado:

```powershell
npm test
npm run test:coverage:same-day
npm run test:mutation:same-day
npm run typecheck
npm run lint
npm run build
npm run bundle:migration
npx playwright test tests/e2e/same-day-drafts.spec.ts tests/e2e/panel.spec.ts tests/e2e/driver-mobile.spec.ts tests/e2e/settlements.spec.ts tests/e2e/settlement-volume.spec.ts tests/e2e/route-individual-reception.spec.ts
node --import tsx scripts/quality-metrics.ts
npm audit --omit=dev --json
git diff --check
```

Desde driver-app, con JAVA_HOME y ANDROID_HOME apuntando a JDK21 y SDK instalado:

```powershell
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest createDebugUnitTestCoverageReport --console=plain
```

Evidencia local: .local/qa-same-day-*.log y sus reportes JSON;
reports/coverage/same-day/coverage-summary.json;
reports/mutation/same-day.json;
reports/screenshots/same-day-second-route.png;
driver-app/app/build/test-results/testDebugUnitTest.
Gherkin: tests/acceptance-same-day-drafts.feature, enlazado a los casos de la
matriz MB. No se presenta como una ejecución Cucumber independiente.

## APK y comprobación del propietario

.local/releases/ana-rutas-driver-0.8.19-varios-borradores.apk;
versión0.8.19/code41, minSdk26/targetSdk36, 69,147,470 bytes.
SHA256: 9FC6005DD03E45C102AAF0E13AF293BD77D6270ACDB7406C2DAD35B99C98F4BF.
Certificado SHA256:
f92d2160eccdadb8b72ac5573ef07dc09eb8fdd57c10621d33afaeb7dd4c2e35.
Puede actualizar la instalación anterior conservando sus datos.

Se conserva la excepción de QA física aprobada por el propietario el2026-09-30.
La compilación de instrumentación no certifica ejecución en un teléfono.
Después del despliegue manual de develop, el arranque existente aplica42
automáticamente antes de iniciar el servidor. No requiere SQL manual.

Compatibilidad de despliegue: la base42 requiere el servidor actualizado; el
createPlan anterior depende de la unicidad retirada. El rollback probado aborta
la transacción de migración. Una vez guardados varios borradores del mismo día,
volver al esquema41 no es una operación reversible sin reconciliar esos datos;
no se incluye ni ejecuta una migración destructiva de regreso.

1. Con una ruta finalizada del día, crear Nuevo borrador con la misma fecha.
   Ver un plan vacío nuevo y poder volver al anterior desde el selector.
2. Cargar los pedidos de la nueva salida, asignar chofer/camioneta y publicar.
   Ver la nueva publicación en Mis rutas; conservar los tickets del historial.
3. Si la primera ruta sigue abierta, intentar iniciar otra salida: debe explicar
   que falta liquidar y finalizar el trabajo anterior.
4. Recibir todos los cobros y finalizar trabajo. Abrir la nueva ruta, capturar
   sus cinco fotos e iniciarla. Inicio y Ruta en vivo deben mostrar la nueva.
5. Abrir de nuevo la liquidación anterior: mismos tickets, importes y cierre.
6. Crear un tercer borrador del día y comprobar que publicar no desplace la
   segunda salida mientras ésta siga iniciada.

Puertas aplicables verificadas con la excepción física vigente. Entrega en
develop autorizada. El propietario conserva el despliegue manual;
main y el entorno productivo no se modifican desde esta tarea.
