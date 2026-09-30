# Liquidación completa — bloques 3 a 6

Fecha: 2026-09-30. Base: develop fdeda3d; esquema 38, APK 0.8.9/code31. Todos los bloques implementados y puertas automatizadas aplicables aprobadas; entrega en develop para QA del propietario bajo la excepción de dispositivo acordada. No se ha desplegado. El propietario asumió expresamente las pruebas físicas de Android al terminar todos los bloques; esa excepción no sustituye las pruebas automatizadas.

## Comportamiento entregado

- Cobro después de entregar: efectivo, transferencia o crédito; importe recibido, cambio explícito, saldo y nota. Revalidación en servidor de identidad, cantidades, moneda, incidencias, revisión y vigencia. Un recibo por pedido/ejecución; originales inmutables.
- Tarjeta móvil con rutas, pedidos, importes, incidencias/fotos e historial. Totales separados por moneda y medio. Solicitud individual o de toda ruta terminada; lo aceptado no vuelve a solicitarse y las reservas pendientes impiden duplicaciones.
- Panel agrupado por chofer con recepción, rechazo, confirmación exacta y notas. Roles separados, formularios independientes, navegación restringida y autorización efectiva de endpoints.
- Filtro por fecha de ruta o recepción local. Consulta por recepción suma únicamente decisiones aceptadas en esas fechas. Las solicitudes no son dinero recibido.
- Comandos móviles cifrados antes de transmitir, reintento con el mismo ID, recuperación tras reinicio; preservación ante 401/408/429/5xx. Confirmaciones terminales, fuente actualizada y pagos anteriores quedan visibles sin reinterpretar el dinero recibido.
- Migraciones aditivas automáticas al arrancar. Lectura Odoo permanece sin escrituras; no se modifica Five.

## Evidencia

| Puerta | Resultado |
|---|---|
| Unidad y PG dirigidos | 28/28; PostgreSQL local real, fotos realmente almacenadas/decodificadas y comandos operativos reales |
| Regresión general final | 855 aprobadas, 0 fallos, 3 omisiones externas documentadas; 82 archivos, 778.92s |
| Cobertura del dominio de liquidación | 99.55% líneas (224/225), 98.78% ramas (162/164), 100% funciones (67/67) |
| Políticas monetarias y roles | 21 pruebas, cobertura 100% en la ejecución dedicada; mutación 164/165, 99.39%, sin timeouts ni errores |
| Mutación con PostgreSQL | 14/14 detectadas: propietario, replay, revisión, entrega, cambio posterior, cierre, reserva, pagos faltantes, aceptados, recepción, rechazo e inmutabilidad |
| Android JVM | 125 pruebas, 0 errores/fallos; política monetaria 100% líneas (17/17), 95.71% ramas (67/70) |
| Mutación Android | 13 mutaciones relevantes detectadas; importe, cambio, crédito, precisión, cero, reintentos, ruta, página y dispositivo |
| HTTP/pantallas | 1/1 E2E final, 23.9s, sobre Next compilado y PostgreSQL real: cobro → solicitud individual → cancelación de modal → recepción → resto de ruta; roles, SSE, fechas y vista 390px |
| Regresión de migraciones | Reconstrucciones v1/v2/v3/v20 actualizadas para eliminar primero tablas dependientes nuevas; 29/29 casos de fleet/orders/panel-events/driver-service-schema aprobados |
| Regresión móvil/eventos | 23/23 en driver-mobile, driver-execution y settlements; una transición financiera cambia sólo la huella del chofer propietario |
| Dependencias | npm audit --omit=dev: 0 vulnerabilidades |
| Calidad estática/build | TypeScript y ESLint sin errores; una advertencia preexistente en stryker.product-amendments.config.mjs. Build Next, migrador empaquetado, Gradle/JVM/lint/APK aprobados |
| Complejidad | ESLint en seis módulos financieros: máximo16 en calculatePayment; callbacks transaccionales <=10. Validación monetaria con ramas cubiertas; no es medida del proyecto entero |

Objetivo por riesgo monetario: >=95% líneas/ramas y >=90% mutación, con revisión individual de rutas críticas. La línea sin cobertura es una guarda redundante ante ausencia de fuente que la revisión actual ya rechaza. El superviviente de Stryker retira typeof method: Array.includes ya rechaza valores no string sin coerción. En Android, retirar el rechazo de neto negativo es equivalente porque cambio+saldo ya lo rechaza; se sustituyó por mutación del límite cero, detectada. No se ocultaron ni rebajaron umbrales.

Muestra final de 19 respuestas reales de liquidación: p95 101.1ms, máximo101.1ms en servidor local; es medición funcional, no prueba de carga ni SLO de producción. Objetivo operativo: sin duplicados y autorización en todas las rutas; latencia debe observarse en el despliegue real. El servidor devuelve Server-Timing y X-Request-ID sin registrar importes/credenciales.

La primera regresión general descubrió cinco aserciones de reconstrucción de esquemas desactualizadas y una ejecución que había cargado la versión anterior de una restricción mientras se editaba. Se corrigieron los fixtures y se repitieron los grupos completos. La regresión general final terminó a partir de las 16:28:46 locales con 855 aprobadas, 0 fallos y 3 omisiones en 778.92s; no se cuenta como verde la ejecución inicial fallida. El escaneo de archivos nuevos y líneas modificadas no encontró claves privadas ni tokens reconocibles; el diff no incorpora APK, archivos de entorno ni evidencia local privada.

## Reproducción

Desde la raíz del repositorio, con Node y PostgreSQL embebido del proyecto:

```powershell
npm run typecheck
npm run lint
npm run build
npm test -- --reporter=verbose
npx vitest run --config vitest.settlements.config.ts --coverage
npx vitest run --config vitest.payments.config.ts --coverage
npx stryker run stryker.payments.config.mjs
node scripts/verify-settlement-mutations.mjs
npx playwright test tests/e2e/settlements.spec.ts
npm run bundle:migration
npm audit --omit=dev
```

Desde driver-app, con ANDROID_HOME apuntando al SDK instalado:

```powershell
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest createDebugUnitTestCoverageReport --console=plain
.\scripts\verify-payment-mutations.ps1
```

Las mutaciones trabajan en copias temporales aisladas, no sobre develop. Inputs de dominio deterministas no son respuestas simuladas de Odoo. La evidencia Odoo real de bloques1/2 sigue en QA-FUENTE-FINANCIERA-BLOQUE-1.md y QA-IMPORTES-CHOFER-BLOQUE-2.md; estos bloques no cambian ese contrato ni afirman haber validado ventas externas.

Evidencia local: .local/settlement-coverage.log, payment-mutation.log, settlement-mutations.log, payment-android-mutations.log, payment-android-boundary.log, finance-android-final.log, settlement-http-final.log, settlement-regression-final.log, settlement-legacy-regression.log, settlement-fleet-regression.log, settlement-mobile-regression.log. Cobertura en coverage/settlements y driver-app/app/build/reports/coverage/test/debug. Capturas de panel, confirmación, cuentas y pantalla móvil en .local/qa-settlements.

Las tres integraciones externas omitidas por defecto en la regresión general son: miniaturas contra Odoo (`product-thumbnails.test.ts`), OAuth/FCM (`route-push.test.ts`) y sincronización financiera Odoo (`financial-odoo-live.test.ts`). Miniaturas y fuente financiera tienen evidencia real en sus bloques previos; estos cambios no modifican los contratos de esos proveedores. La omisión de FCM ya estaba documentada. No se cuentan como pruebas ejecutadas ahora. El consolidado local `.local/payment-android-final.json` conserva los 13 mutantes Android detectados y el análisis del equivalente descartado.

## APK y validación del propietario

Artefacto: .local/releases/ana-rutas-driver-0.8.9-liquidacion.apk, versión0.8.9/code31, minSdk26, debug firmado como las APK de desarrollo anteriores. SHA256: 24C7C2234CDC5CFF4268A7C84FDB0D4B21096F90D5CA783C93C1D1417AB71495. apksigner verificó firma y certificado idéntico a0.8.8; actualizar conservando los datos, sin desinstalar.

Después del despliegue manual del backend develop y la actualización de APK:

1. En Usuarios y accesos crear un liquidador desde su formulario; confirmar que esa cuenta sólo abre Liquidación y que la cuenta de rutas no puede aceptarla.
2. Importar un pedido pendiente y otro validado. Al validar el pendiente en Odoo comprobar actualización automática de cantidades/precios; abrir líneas largas y revisar con tamaño de letra grande.
3. Registrar devolución, faltante y reposición pagada/diferida. Entregar y confirmar efectivo parcial/cambio, transferencia y crédito en pedidos diferentes. Comparar notas/saldo e importes reales.
4. Interrumpir la conexión al confirmar; recuperar con el mismo comando y comprobar un solo recibo. Reabrir app y revisar rutas/historial. Probar cambio de cuenta y que no reaparezcan datos anteriores.
5. Terminar la ruta. Liquidar un pedido, cancelar el modal del panel (sin efecto), aceptar; solicitar el resto de la ruta. Rechazar y reenviar, finalmente aceptar; comparar efectivo físico separado de transferencia/crédito.
6. Consultar fecha de recepción y fecha de ruta, abrir incidencias/fotos, revisar originales tras cambios de Odoo, y comprobar que lo aceptado no aparece como pendiente.

Pendiente por excepción aprobada: recorrido físico, GPS/Google Navigation, gestos/rotación/tamaño de fuente y cifrado/reinicio real de Android. Las pruebas instrumentadas anteriores no pudieron ejecutarse por ADB/BlueStacks; compilación y JVM no certifican esa experiencia. Se mantienen identificadas las omisiones externas preexistentes del suite general. No se declara producción certificada ni se ha hecho deploy.

Límites funcionales explícitos: crédito y saldo quedan registrados; no existe cobro bancario automático, escritura de pagos en Odoo ni una segunda cobranza inventada de reposiciones futuras. Una corrección posterior conserva el recibo original y señala diferencia. Rollback de backend sólo a un artefacto compatible con esquema38, conservando recibos y solicitudes; nunca bajar esquema borrando dinero.
