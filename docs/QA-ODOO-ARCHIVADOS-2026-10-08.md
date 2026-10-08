# Aviso de pedidos con contacto de entrega archivado en Odoo

Bloque autorizado: «si solo es agregar eso no me cambies logicas».
Rama develop, base 537238174d0f1f04887c9e26b5ddc8322374a86d. Producción,
main, EasyPanel, Odoo escritura, Google, Android y despliegue fuera del alcance.
No hay migraciones ni cambios de dependencias.

## Autopsia

La consulta por fecha incluía entregas válidas, pero `hydratePickings` necesitaba
leer por ID sus contactos. `byIds` usaba `active_test: true`; Odoo omitía el
contacto archivado y `ODOO_INCOMPLETE_READ` interrumpía la consulta completa.
En la prueba original, S00001 apuntaba al contacto 12 archivado y S00002 al
contacto 11 activo. S00002 solo sí funcionaba. No era un duplicado por nombre,
un cambio de domicilio ni un fallo de campos entre versiones. El usuario
posteriormente eliminó esos pedidos.

## Contrato acotado

1. Previsualización y revalidación leen los mismos IDs con `active_test: false`
   exclusivamente para la lectura vinculada de `res.partner`. Conservan
   autenticación, compañía, permisos y comprobación de lectura completa.
   La bandera no permite consultar otros modelos archivados.
2. Se utiliza el contacto de entrega que ya resolvía el conector: contacto del
   surtido o dirección de entrega de la venta si el surtido carece de contacto.
   Sólo `active === false` genera aviso; un valor desconocido falla explícitamente.
3. Esos surtidos/pedidos se separan antes de crear el lote seleccionable. La
   respuesta añade `archivedCustomerOrders` con identidades y nombres reales.
   La tarjeta amarilla bajo el resumen enumera folio, cliente y surtido al abrir
   «Ver pedidos afectados». No añade estados ni cambia filtros existentes.
4. Los demás conservan estados, fechas, cantidades, unidades, notas, dirección
   e identidad. Conteo y seleccionar todos abarcan sólo candidatos elegibles.
   Si todos están archivados, el aviso aparece y guardar sigue deshabilitado.
5. Si el contacto se archiva después de consultar, la comprobación transaccional
   existente rechaza toda la selección con `CANDIDATE_CHANGED`; consultar de
   nuevo permite escoger los restantes. Reintentos conservan sus recibos.
6. Lectores manual y directo anteriores mantienen el contexto activo por
   defecto y su rechazo ante contactos no disponibles; no se habilita carga
   parcial por folio. Tampoco cambian activación/publicación, sincronización,
   archivo local de Ana Rutas ni negociación de campos de Odoo 17/19/20.

## Evidencia ejecutada

| Puerta | Resultado |
| --- | --- |
| Contratos dirigidos y PostgreSQL real | 91/91 en 11 archivos |
| Regresión de importación, sincronización y publicación | 33/33 en 9 archivos |
| Cobertura de clasificación nueva | 100% líneas, sentencias, funciones y ramas (11 líneas; 4 ramas) |
| Mutation testing de clasificación | 16/16 mutantes eliminados; cero supervivientes |
| Chrome, componente real | Aviso, filtros, seleccionar todos, sólo archivados y anchos 375/768/1440 correctos |
| HTTP/Chrome con Odoo real y PostgreSQL aislado | Consulta, guardado exacto, reintento idempotente, autenticación 401 y origen incorrecto 403 correctos |
| Odoo 20.0+e real, sólo lectura | S00003, WH/OUT/00003, ABARROTES FRANCO, 14 partidas; sin alerta falsa |
| Lectura manual real | S00003 con 14 partidas; correcta |
| Lectura financiera real | S00003, ready, 14 partidas, total 1890.33; sin cambios financieros |
| Contactos archivados reales por ID | Seis recuperados; lector predeterminado sigue rechazándolos y el opt-in de previsualización los lee |
| Build y TypeScript | Correctos |
| Lint | Sin errores; advertencia previa ajena en stryker.product-amendments.config.mjs |
| Auditoría productiva | Cero vulnerabilidades |
| Auditoría completa | Mismas cinco alertas heredadas de ESLint/braces; dependencias sin cambios |

La excepción de estas cinco alertas de herramientas para entrega a develop ya
fue autorizada por el propietario y documentada en
`QA-EDITOR-HORARIO-2026-10-08.md`; no se amplía a dependencias nuevas ni a deploy.

Tiempos observados del conector, una ejecución: consulta por fecha 1707 ms,
manual 1520 ms, contactos 741 ms, finanzas 1993 ms. No constituyen un p95 ni
garantía de latencia. Clasificación O(n), cero llamadas RPC adicionales, un
campo añadido a la lectura existente. Complejidad ciclomática de la función: 4
(bucle y dos decisiones). No hay nuevas llamadas a Google u OpenAI.

## Reproducción

Desde la raíz, con Node 24 y dependencias del lockfile:

```powershell
npx vitest run tests/odoo-archived-orders.test.ts tests/order-candidate-warning.test.ts tests/order-candidates.test.ts tests/order-candidates-validation.test.ts tests/odoo.test.ts tests/odoo-capabilities.test.ts tests/odoo-partner-capabilities.test.ts tests/odoo-financial-contract.test.ts tests/picker-notes.test.ts tests/route-start-validation.test.ts tests/route-start-validation-integration.test.ts
npx vitest run tests/orders.test.ts tests/orders-validation.test.ts tests/draft-source-sync.test.ts tests/draft-source-policy.test.ts tests/route-publications.test.ts tests/route-publication-validation.test.ts tests/route-publication-validation-integration.test.ts tests/route-publication-revisions.test.ts tests/route-publication-content.test.ts
npx vitest run --config vitest.odoo-archived-orders.config.ts --coverage
npx stryker run stryker.odoo-archived-orders.config.mjs
npm run build
npm run typecheck
npm run lint
npm audit --omit=dev
npx playwright test tests/e2e/order-archive-warning.spec.ts
```

Para el E2E real configurar privadamente las variables ODOO de una instancia
de pruebas autorizada, `RUTAS_QA_ALLOWED_ODOO_HOST` y `RUTAS_QA_ORDER_DATE` con
una fecha que contenga al menos un pedido elegible de cliente activo:

```powershell
npx playwright test tests/e2e/order-archive-live.spec.ts
```

Usa PostgreSQL y servidor HTTP locales temporales; no escribe en Odoo ni en la
base remota. No publicar credenciales en comandos, trazas o reportes.
La lectura privada adicional se ejecutó mediante bundle temporal del conector
con exportación de QA sólo en memoria, sin cambiar la API pública: obtener IDs
archivados mediante `readCustomerPage`; verificar que
`openReadSession().byIds(res.partner, IDs, [id, active], false)` rechaza y que
el mismo lector con quinto argumento `true` devuelve todos con `active: false`.

## Límites de evidencia

Los dos pedidos originales ya no existen. No se recrearon ni se archivaron
contactos para forzar el caso remoto. La separación de pedidos mixtos y la
carrera de archivo se verificaron con entradas de dominio, PostgreSQL real y
React real; las lecturas de pedidos y contactos archivados sí se comprobaron
contra Odoo real. No se simuló ninguna API. Odoo 17/19 se cubre por contratos
existentes; no se conectó a producción. Las capturas del componente son datos
de contrato local, no pedidos del usuario.

Capturas revisadas: `reports/screenshots/order-archive-warning-{375,768,1440}.png`.
Escenarios: `tests/acceptance-odoo-archived-orders.feature`.
Entrega: commit/push develop; despliegue manual del propietario.
