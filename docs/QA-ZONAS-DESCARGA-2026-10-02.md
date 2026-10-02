# QA — zonas y descarga por cliente

Alcance autorizado: BLOQUE-ZONAS-DESCARGA.md, ZD01..09. Develop, sin deploy,
sin APK nueva ni cambios al funcionamiento de entregas/liquidación. Migración43.

## Evidencia local

- Editor real Next/Chrome/PostgreSQL: campo entre Prioridad y Modalidad; guardar23,
  recargar y comprobar1380s en el modelo. Escritorio1440px y móvil390px sin
  overflow ni errores de página. Origen ajeno403, anónimo401, liquidador403.
  Capturas revisadas en reports/screenshots/customer-unloading-{desktop,mobile}.png.
- Contratos puros: zonas desbalanceadas8/2, tres barrios, estabilidad al permutar
  entradas/flota, puntos coincidentes, fronteras geográficas, una/muchas/sin
  camionetas, recuperación de centro vacío, pertenencia única y cobertura.
- Descarga: omisión/null/cero, enteros/límites técnicos, cliente repetido,
  clientes distintos coincidentes, ventanas alternativas, revisita, espera y
  regreso. Caso real sin desplazamiento:20min de servicio,40min de espera,
  7min de última visita →67min totales, sin consultar ni simular Google.
- PostgreSQL: migración42→43 repetida/concurrente, conservación, CHECKs;
  persistencia, permiso/versionado, auditoría, omisión HTTP compatible,
  invalidación, cola de recálculo y conflicto de huella durante cálculo.
- Recuperación real sin proveedor configurado y depósito coincidente:
  preserva zonas, incluye12min de servicio y guarda todos los pedidos.
- Sincronización de datos fuente mantiene14min configurados localmente.
- Cobertura módulos nuevos:100% líneas88/88, ramas46/46, funciones31/31,
  sentencias98/98. Objetivo100% por riesgo de asignación/tiempo, incluyendo
  recuperación de zona vacía. No es porcentaje del repositorio completo.
- Complejidad ESLint medida: máximo8 en geographicZones; entrada7,
  duración4, visitas consecutivas4 y reparación de zonas3.
- Benchmark local de cálculo de zonas:120destinos,4camionetas,100ejecuciones;
  p95=1.83ms, máximo14.02ms,0consultas de red. No mide latencia de Google.
  Criterio local de regresión:p95<100ms para ese conjunto.
- Typecheck, lint del alcance y build Next final aprobados (compilación17.2s,
  TypeScript27.4s). npm audit producción:0vulnerabilidades.
- Segunda ejecución del build en Chrome:2/2 recorridos aprobados, incluyendo
  regresión de activación parcial por camioneta y actualización SSE440ms local.
- Mutaciones dirigidas:14/14 detectadas por aserciones, sobre copia aislada;
  línea base13/13 pruebas. Evidencia reports/mutation/zones-unloading.json.

## Reproducción

Node24, raíz ana-rutas, dependencias instaladas. No se leen secretos productivos.

```text
node node_modules/vitest/vitest.mjs run tests/route-zones-service.test.ts tests/customer-unloading.test.ts
node node_modules/vitest/vitest.mjs run tests/route-zones-service.test.ts tests/customer-unloading.test.ts --coverage --coverage.include=src/core/route-zones.ts --coverage.include=src/core/route-service-time.ts --coverage.include=src/core/customer-unloading-schema.ts --coverage.thresholds.lines=100 --coverage.thresholds.branches=95 --coverage.thresholds.functions=100 --coverage.thresholds.statements=100
node scripts/verify-zones-unloading-mutations.mjs
node node_modules/vitest/vitest.mjs run --reporter=default --reporter=json --outputFile=reports/zones-regression.json
node node_modules/typescript/bin/tsc --noEmit
node node_modules/next/dist/bin/next build
node node_modules/@playwright/test/cli.js test tests/e2e/customer-unloading.spec.ts
```

Las pruebas de mutación trabajan en copia aislada bajo .local, restauran cada
archivo y exigen fallo de aserción. Nunca modifican producción ni el árbol activo.
La primera ronda detectó13/14: la inversión de distancia sobrevivía al ejemplo
de dos barrios por intercambio de etiquetas. Se añadió un ejemplo de tres barrios
que detecta esa regresión; la segunda ronda detectó las 14 mutaciones.

## Límites de evidencia y revisión tras despliegue

Los escenarios nuevos usan funciones de dominio y PostgreSQL/HTTP/Chrome reales,
sin sustitutos de Google/Odoo ni optimizaciones facturables. La regresión general
incluye contratos heredados con transporte inyectado; éstos no constituyen una
verificación contra Google en vivo ni se añadieron transportes simulados nuevos.
Los contratos revisados usan VisitRequest.duration y allowedVehicleIndices de la
[referencia oficial](https://developers.google.com/maps/documentation/route-optimization/reference/rest/v1/ShipmentModel).
La calidad vial real, tráfico y retrasos requieren observar el siguiente armado
real después del deploy manual. Las zonas agrupan destinos; no prometen calles
exclusivas, igualdad de trabajo ni solución matemática globalmente óptima.

Procedimiento del propietario tras deploy: configurar minutos de clientes,
armar un borrador con varias camionetas, comprobar zonas en mapa, tiempo total y
horarios; cambiar minutos y verificar recálculo. Publicaciones iniciadas deben
conservar el recorrido publicado. No se modifica ninguna ruta real para QA local.

## Regresión consolidada

105 archivos, 1,007 pruebas en 1,342.43 s: 1,003 aprobadas, 3 omitidas y un fallo
en la expectativa heredada de asignación libre de route-ai-integration.test.ts.
Se actualizó ese contrato a pertenencia por zona y conservación de la secuencia
devuelta por el proveedor, independientemente del índice de la camioneta.
Reejecución del archivo corregido: 2/2 aprobadas (12.54 s).
Resultado combinado sobre el código final: 1,004 aprobadas, 3 omitidas, 0 fallos
pendientes. No se presenta como una segunda ejecución completa de la suite.
Evidencia: reports/zones-regression.json y reports/zones-regression-correction.json.

Las 3 omisiones existentes requieren configuración explícita externa: imagen de
producto Odoo, entrega FCM y contrato financiero Odoo live. No se modifican esos
servicios. No se certifica ejecución remota mediante pruebas de contrato locales.
