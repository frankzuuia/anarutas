# QA — retiro de reportes tras cancelar ruta (BL-150A)

## Causa comprobada

El usuario reportó HTTP 503 al eliminar del panel una incidencia y confirmó que había cancelado la ruta. La configuración desplegada de EasyPanel apuntaba al commit `5976e6c`, por lo que no era falta de push. Los logs de app mostraban `SERVICE_UNAVAILABLE`; no registraban el detalle PostgreSQL. No se modificaron ni eliminaron incidencias remotas para diagnosticar.

Se reprodujo con los comandos reales `cancelPublishedRoute` y `cancelProductIncidentByAdmin` contra PostgreSQL local aislado, tanto con ruta cancelada como con plan eliminado: ambas pruebas fallaron con `INVALID_PRODUCT_LINE` en el UPDATE que cambiaba status a canceled. Cancelar incrementa la revisión de publicación; el trigger de cantidad buscaba la revisión anterior para validar una operación sobre un pedido histórico aún marcado abierto. HTTP convertía el error no reconocido en 503.

La corrección clasifica el retiro bajo bloqueo de plan/publicación antes de ejecución/parada/pedido/incidencia. Si no existe una publicación iniciada vigente para la revisión histórica, sólo actualiza la exclusión del reporte. No ejecuta cambios de estado/cantidad, no afloja validaciones ni reconstruye la publicación. Fotos, auditoría, resolución y datos operativos permanecen intactos. Rutas activas conservan la lógica anterior: pedido abierto cancela/restituye; cerrado sólo retira del reporte.

El borde blanco del modal era el estilo nativo de `<dialog>`: faltaba la clase visual existente `fleet-dialog`. Se reutiliza esa clase y se agrega espaciado responsive, descripción accesible, foco inicial en Conservar y restauración del foco al cerrar. No se usa UI UX Pro Max ni se cambia el tema de la aplicación.

## Comandos reproducibles

Desde la raíz del repositorio en develop, Node 24 y PostgreSQL real aislado de las pruebas:

```powershell
npx vitest run tests/product-incident-admin-cancel.test.ts --maxWorkers=1 --coverage --coverage.include=src/core/product-incident-admin-cancel.ts
npm run typecheck
npm run lint
npm run build
npx playwright test tests/e2e/product-incidents.spec.ts --workers=1
npm test -- --maxWorkers=2
npx stryker run stryker.product-admin.config.mjs
npx stryker run stryker.product-admin-locks.config.mjs
npm audit --omit=dev --audit-level=high
git diff --check
```

## Evidencia y alcance de las comprobaciones

- Reproducción antes del arreglo: 2 pruebas fallidas, ambas `INVALID_PRODUCT_LINE` (cancelación real y plan eliminado).
- Primera regresión dirigida corregida: 6/6 aprobadas; 100 % líneas (24/24), sentencias (28/28), ramas (16/16) y funciones (2/2) del servicio. Objetivo 100 % por riesgo de alterar datos históricos; se añade además la carrera cancelación/retiro a la regresión final.
- Regresión dirigida ampliada: 8/8 aprobadas en 116.38 s, conservando 100 % en las cuatro métricas de cobertura anteriores. El caso adicional detiene una transacción real antes del UPDATE y comprueba con NOWAIT que plan/publicación/ejecución/parada siguen protegidos hasta commit. No sustituye APIs ni base de datos por mocks.
- Mutación crítica (líneas 19–32): primera corrida de 54 mutantes, 51 detectados por fallo, 1 timeout y 2 supervivientes, score 96.30 % (umbral 95 %). Los supervivientes eliminaban los SELECT de bloqueo de ejecución/parada: se añadió la barrera determinista anterior. La repetición focalizada (líneas 19–21) detectó 9/9 por fallo, 0 timeout y 0 supervivientes, score 100 % (umbral 100 %), incluyendo los tres casos pendientes de la corrida amplia. No se presenta como una segunda corrida completa de 54 mutantes. Reportes: `reports/mutation/product-admin.json` y `reports/mutation/product-admin-locks.json`.
- Regresión completa final: 66 archivos aprobados, 649 pruebas aprobadas, 1 omitida (FCM live exige credenciales externas; no se modifica ese flujo), 0 fallos; 887.85 s. Incluye los 7 casos administrativos y la carrera real entre cancelar ruta y retirar reporte.
- E2E final sobre build: 2/2 aprobadas. Comprueba HTTP 200 y retiro del panel/Excel de pendientes/resueltas después de cancelar la ruta, conservación exacta de órdenes, status/cantidades y acceso privado a fotos. El flujo previo de creación, clasificación, resolución, cancelación por chofer y eliminación con pedido cerrado también pasa. Casos de seguridad/replay: 401, 403, 409 e idempotencia.
- Modal: capturas desktop 1500×800 y móvil 390×844 inspeccionadas; borde, radio, fondo, separación de botones, límites horizontales, foco inicial, Escape y Conservar verificados en Playwright. Evidencia `.local/qa/product-incidents/delete-dialog-{desktop,mobile}.png`.
- Build y typecheck aprobados; ESLint sin errores, con la advertencia preexistente de export default anónimo en `stryker.product-amendments.config.mjs`. `npm audit --omit=dev` reporta 0 vulnerabilidades.
- Complejidad ciclomática del callback transaccional: 11 por regla ESLint `complexity`; función pública 1. Los bloqueos y la decisión de retiro sólo de reporte tienen regresiones de datos reales y concurrencia.
- Muestra de latencia HTTP local (alta/replay/conflicto combinados): 281 ms en primera ejecución E2E, 1699 ms durante build/pruebas/mutaciones simultáneas. No es p95 de producción ni nuevo SLO. No se afirma rendimiento remoto a partir de estas muestras.

## Entrega y prueba después del deploy

No requiere nueva migración ni APK. La versión de esquema permanece en 30 y se conserva la APK 0.8.3. El usuario hace deploy manual; no se modifican `main`, Odoo, Firebase ni configuración remota.

En un pedido de desarrollo: registrar dos incidencias, resolver una, cancelar la ruta, abrir Incidencias y conservar primero en el diálogo del bote. Confirmar después ambas eliminaciones: deben desaparecer de panel/Excel y conservar datos operativos originales. Repetir con pedido cerrado para verificar que no restituye cantidad, y con pedido abierto/ruta activa para verificar que sí cancela su incidencia. La comprobación remota tras deploy queda pendiente del propietario; no se declara realizada.
