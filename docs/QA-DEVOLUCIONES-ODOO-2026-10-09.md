# QA — devoluciones nativas Odoo, 2026-10-09

Repositorio Ana Rutas, develop, base fe5e4c6. Alcance aprobado: implementación
y pruebas en develop; sin acceso a producción ni deploy. Contrato y decisiones:
[BLOQUE-DEVOLUCIONES-ODOO-2026-10-09.md](BLOQUE-DEVOLUCIONES-ODOO-2026-10-09.md).

## Evidencia ejecutada

- Odoo 20.0+e real: acción stock.picking.action_return; no existen los modelos
  stock.return.picking ni stock.return.picking.line. Compañía 1 verificada.
- Primera devolución real: respuesta perdida después del commit remoto,
  recuperación del mismo traslado, rechazo real de referencia duplicada y
  resultado remoto incierto sin nueva creación. La devolución de QA 7 se canceló
  exclusivamente para la prueba siguiente; original 6 permanece validado.
- Recorrido completo repetido tras dividir la preparación en pasos privados:
  importación real, PostgreSQL 17 aislado, acceso firmado,
  fotografía JPEG real, llegada, devolución, cierre atómico de atención/cobro,
  dos trabajadores concurrentes y lectura administrativa. La devolución de QA 9
  se canceló exclusivamente para repetir el recorrido. Devolución final 10:
  AR/RETURN/f7e6ae51-6cb6-4054-b69d-3d3e26a16619, assigned, sólo movimientos originales
  61/producto 34 y 62/producto 2, ambos unidad 1/cantidad 0.25. Los otros 13 productos
  del surtido no se incorporaron. Sin validación automática.
- Trabajadores: prepared/busy, repetición posterior idle, cobro repetido duplicate.
  Después de observar RETURNED_STOCK, recibo y snapshot monetario siguen idénticos.
  El envío y su verificación tardaron 3,659 ms en la muestra final; el intervalo normal
  de consulta es 15 s, configurable. No constituye un SLO bajo carga.
- Pruebas dirigidas de PostgreSQL: permisos, marcas nuevas, corrección,
  cancelación, ausencia de backfill, cobro fallido sin trabajo, repetición,
  payload/identidad inmutables y enlaces compatibles con el cobro y pedido.
- Cobertura dirigida de política/configuración: 100% líneas 63/63,
  sentencias 69/69, funciones 17/17 y ramas 81/81. Objetivo 100% justificado por
  cantidades, aislamiento e identidad. Es cobertura dirigida, no del worker
  completo ni de la instalación 17.
- Build y comprobación de tipos verdes. Lint sin errores, una advertencia heredada
  de stryker.product-amendments.config.mjs. Auditoría npm productiva: 0 alertas.
- Complejidad ciclomática ESLint: máximo 20 por función en el conector; cola 18,
  trabajador de cola 15, política 14. Regla scoped complexity <=20 en eslint.config.mjs.
- Mutation testing: 12/12 detectadas, con baseline verde de 7 pruebas; cubre
  fuente, compañía, movimientos duplicados, saldo, recibo, conversión de unidad,
  cancelación, historial, correspondencia cobro/pedido e inmutabilidad.
- Chrome: 6 recorridos únicos verdes. La prueba antigua de evidencia necesitó
  abrir «Ver detalles» y se repitió verde. Tarjetas con nuevo estado Odoo:
  141.9 px desktop y 175.7 px móvil; fotos cerradas, privacidad y Excel intactos.
- Suite general: 1,148 pruebas verdes y 7 omitidas en la primera ejecución.
  Tres pruebas de los archivos de migración/captura se ejecutaron mientras se
  incorporaban ajustes y fallaron; sus archivos completos se repitieron con
  24/24 verdes; cierre dirigido final también 24/24, cero fallos. No se oculta esa primera
  ejecución ni se presenta como un suite general íntegramente verde.
- Cierre del panel tras restringir el estado Odoo a incidencias de devolución:
  tres pruebas dirigidas verdes. TypeScript y lint repetidos después de la
  revisión final: cero errores y la misma advertencia heredada.

Los escenarios Gherkin se relacionan con pruebas TypeScript y reales; no se usa
un ejecutor Cucumber. Los inputs de dominio de las pruebas unitarias no representan
respuestas simuladas de Odoo. Las pruebas remotas llaman al servidor verdadero.

## Procedimiento reproducible

Desde la raíz, con Node 24 y las dependencias instaladas:

```powershell
npm run typecheck
npm run lint
npm run build
node node_modules/vitest/vitest.mjs run tests/odoo-return-store.test.ts tests/odoo-return-policy.test.ts tests/product-incidents.test.ts tests/panel-events.test.ts
node node_modules/vitest/vitest.mjs run --config vitest.odoo-returns.config.ts --coverage
node scripts/verify-odoo-return-mutations.mjs
node node_modules/@playwright/test/cli.js test tests/e2e/product-incidents.spec.ts
npm audit --omit=dev
```

Para la prueba remota, suministrar mediante el entorno las credenciales del Odoo
de pruebas y RUTAS_TEST_RETURN_WORKFLOW_PICKING con un surtido validado sin
devoluciones previas. La prueba tiene guardas explícitas de host/base develop:

```powershell
node node_modules/vitest/vitest.mjs run tests/odoo-return-workflow-live.test.ts
```

Esa prueba escribe una devolución real pendiente, conserva el pedido original y
guarda evidencia sin secretos en .local/odoo-return-workflow-evidence.json.
No repetir sobre el mismo pedido con la devolución ya pendiente: el control
financiero existente detecta RETURNED_STOCK. La prueba de pérdida de respuesta
se ejecuta aparte con RUTAS_TEST_RETURN_PICKING y tests/odoo-returns-live.test.ts.

## Activación para probar en la instalación de develop

El propietario hace el deploy de develop y configura únicamente allí:

```text
RUTAS_ODOO_RETURNS_ENABLED=true
RUTAS_ODOO_RETURNS_POLL_SECONDS=15
```

La migración 48 es aditiva. No envía devoluciones históricas. Las credenciales
Odoo existentes se leen en runtime y no se imprimen. Registrar una devolución
con foto, cerrar atención/cobro y abrir Incidencias en vivo: se verá estado y
referencia. En Odoo abrir ese traslado y comprobar productos/cantidades; la
validación corresponde al personal autorizado de Odoo.

## Límites y riesgos revisados

Odoo 17: contrato oficial y conversión de unidades implementados y probados como
dominio; falta una instancia 17 de pruebas para certificar la integración real.
El guard de las pruebas remotas actuales sólo admite el Odoo develop autorizado.
No afirmar que producción esté certificada ni ampliar ese guard silenciosamente.

Un resultado incierto sin referencia permanece en reconciliación; no se recrea
a ciegas. Renombrar/cancelar/modificar el traslado remoto requiere revisión y no
provoca sustitución silenciosa. Cambiar de fuente Odoo detiene el trabajador.
La unicidad protege las devoluciones propias; no serializa las decisiones de un
operador que simultáneamente cree otra devolución manual en Odoo. Se verifica
el saldo disponible antes de crear y se comparan las líneas y cantidades del
traslado resultante con la solicitud; su validación final continúa siendo manual.
Pruebas de carga y APK física después del deploy no se
declaran ejecutadas.
