# QA — faltantes y eliminación administrativa, APK 0.8.3

## Alcance y diagnóstico

Correcciones BL-149/150 sobre `develop`, sin cambios en `main`, despliegue ni escrituras en Odoo. El servidor conserva seis decimales para aritmética exacta; el formulario mostraba ese texto sin normalizar. Ahora la presentación elimina ceros sobrantes al abrir/confirmar, sin redondear ni interferir con la captura. El formulario compartido repetía la cantidad de faltantes y ofrecía cámara/comentarios ajenos al caso: faltantes por validación y desde bodega tienen un solo bloque producto/cantidad/unidad, no muestran fotos y sólo ofrecen el comentario rápido de producto ausente. Las notas libres y registros históricos se conservan.

El historial antes incluía las cancelaciones aunque Excel ya las excluía. Ahora la consulta aplica el filtro antes de paginar/contar. Se añade eliminación administrativa con confirmación y bote rojo; Resolver mantiene su acción y ahora muestra icono verde.

| Estado del pedido al adquirir los bloqueos | Efecto de eliminar desde administración |
| --- | --- |
| Abierto | Cancela la incidencia, restituye sólo su cantidad y actualiza revisiones de pedido/parada/ejecución. |
| Entregado o reprogramado/cerrado en esta ruta | Sólo retira panel/reporte/Excel. Conserva cantidad, estado, resolución, entrega y revisiones operativas. |

Ambos casos conservan fotos privadas y auditoría before/after, no hacen borrado físico. Migración aditiva v30, actor administrativo activo, validación de origen, versión y reintento idempotente. Orden de bloqueos compatible con los comandos móviles: ejecución → parada → pedido → incidencia. El estado de cierre se decide dentro de la transacción, no desde la interfaz.

## Ejecución reproducible

Desde la raíz del repositorio, Node 24, PostgreSQL aislado real provisto por las pruebas:

```powershell
npm run typecheck
npm run lint
npm test -- --maxWorkers=2
npx vitest run tests/product-incident-admin-cancel.test.ts tests/product-incidents.test.ts tests/product-incident-photos.test.ts --maxWorkers=2 --coverage --coverage.include=src/core/product-incident-admin-cancel.ts --coverage.include=src/core/product-incidents.ts
npm run build
npx playwright test tests/e2e/product-incidents.spec.ts --workers=1
npx stryker run stryker.product-admin.config.mjs
npx stryker run stryker.product-visibility.config.mjs
npm audit --omit=dev --audit-level=high
git diff --check
```

Desde `driver-app`, con JDK/SDK configurados:

```powershell
.\gradlew.bat testDebugUnitTest createDebugUnitTestCoverageReport lintDebug assembleDebug assembleDebugAndroidTest --console=plain -PANA_RUTAS_SERVER_URL=https://ana-rutas-develop-app.bfmayj.easypanel.host
.\scripts\verify-arrival-mutations.ps1 -ProductPresentationOnly -ServerUrl https://ana-rutas-develop-app.bfmayj.easypanel.host
```

## Resultados y métricas

- Suite TS completa: 66 archivos, 646 pruebas aprobadas, 1 omitida (FCM live requiere credenciales externas), 0 fallos; 656 s.
- Integración y cobertura dirigida final: 11/11 aprobadas con PostgreSQL real. Combinado: 99.15 % líneas (118/119), 93.58 % ramas (146/156), 100 % funciones (15/15). Servicio nuevo de eliminación: 100 % líneas (21/21), ramas (15/15), sentencias (25/25) y funciones (2/2). Objetivo de riesgo: 100 % en la decisión nueva que protege pedidos cerrados y al menos 95 % de líneas en el conjunto afectado; las rutas críticas se comprueban además con concurrencia y mutación.
- E2E local con API, PostgreSQL, sesión, fotos y Excel reales: 1/1 aprobado. Comprueba desaparición automática tras cancelación del chofer, bote rojo, conservar/cancelar diálogo, eliminación con pedido cerrado, conservación de entrega/fotos y export vacío. Comprueba 401 sin sesión, 403 origen ajeno, 409 versión obsoleta y 200 idempotente. Iconos comprobados con estilo calculado: verde `rgb(39, 219, 133)` y rojo `rgb(180, 35, 46)`.
- Mutación crítica administrativa: 39/39 detectadas, sin supervivientes, timeouts ni errores. Filtros de historial/en vivo/Excel: 7/7 detectadas. La primera selección de pruebas sólo detectó 4/7; se amplió a los casos reales de reposición pendiente/resuelta y cierre, sin quitar mutantes ni reducir el umbral.
- Android JVM: 99 pruebas, 0 fallos. Mutación de presentación: 3/3 detectadas. Política Android: 26/26 líneas, 78/90 ramas (86.67 %), 13/13 métodos. Casos cubiertos: fracciones exactas, valores guardados, comentarios por tipo, saldo y exclusión de reporte sin restitución en pedido cerrado.
- Complejidad ciclomática del callback transaccional nuevo: 9 (regla `complexity` de ESLint); función pública: 1. La decisión crítica de pedido cerrado, CAS e idempotencia tiene pruebas dedicadas y mutación; no se usa el promedio de cobertura como sustituto.
- Typecheck y builds Next/Android aprobados. ESLint: 0 errores y una advertencia preexistente de export anónimo en `stryker.product-amendments.config.mjs`. Lint Android: 0 errores, 33 advertencias existentes. Dependencias de producción: 0 vulnerabilidades reportadas por `npm audit`.
- Creación/replay/conflicto por HTTP local: 277 ms combinados en E2E. Es una muestra local, no p95 ni SLO de producción; no se modifican los SLO existentes.

Evidencia local no versionada: `reports/mutation/product-admin.json`, `reports/mutation/product-visibility.json`, `coverage/`, reporte Android `app/build/reports/coverage/test/debug/report.xml`, y capturas `.local/qa/product-incidents/{history,mobile-panel,canceled-hidden,admin-removed}.png`. Escenarios de aceptación: `tests/acceptance-product-incidents.feature`. La instrumentación Compose compiló, pero no se ejecutó en dispositivo.

## Entrega de desarrollo y QA físico pendiente

El propietario realiza deploy manual del backend; la migración v30 corre por el procedimiento existente, sin SQL manual. Desplegar backend antes de instalar APK. El backend previo no reconoce schema30: no revertir sólo al binario viejo tras migrar; cualquier rollback necesita compatibilidad de esquema y el procedimiento de respaldo existente. Las fotos y datos originales no se eliminan.

APK debug de pruebas: `.local/releases/Five-Rutas-Chofer-0.8.3-develop.apk`, versionCode 25, versionName 0.8.3. Firma v2 verificada. SHA256: `344734CC197E3D33703B08EC19640C8534E8C4674F6F6928172872895FFF9382`.

ADB sólo reportó `emulator-5554 offline`; la validación visual nativa, cámara, teclado, rotación y recuperación física siguen pendientes. Se entrega a develop para la prueba solicitada, no se declara certificado para producción.

1. En un pedido de prueba abierto, reportar devolución de 1 de 2 unidades con 1–3 fotos. Abrir de nuevo: cantidad `1`, botón «Incidencia enviada», saldo 1 y alerta ámbar. Editar/cancelar y comprobar restablecimiento exacto.
2. Probar ambos faltantes: producto, cantidad `1`, unidad `kg`; una sola cantidad, sin cámara ni evidencia, sólo comentario de producto ausente y notas libres. Guardar, editar, eliminar y verificar panel/export. No confundir cantidad con unidad.
3. En Incidencias, conservar en el diálogo del bote y comprobar que nada cambia. Confirmar con pedido abierto: desaparece del panel/Excel y restituye cantidad. Resolver una reposición desde Incidencias en vivo con palomita verde.
4. Cerrar otro pedido con incidencia; eliminarla desde administración: desaparece del reporte/Excel pero la entrega, el saldo y las métricas originales no cambian. Repetir sobre reprogramado y comprobar concurrencia/reintento con dos sesiones.
5. Verificar cancelar por chofer → desaparición automática del panel, varias incidencias por pedido, teclado/rotación, fotos y recuperación offline/online. No usar pedidos productivos para estas pruebas destructivas de aceptación.
