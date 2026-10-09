# Devoluciones de Ana Rutas a Odoo — contrato aprobado, 2026-10-09

Estado: implementación, prueba real Odoo 20 y QA de develop terminados.
Autorización: «cuando termines de revisar todo ejecuta el plan», seguida de
«adaptalo para que en develop pueda hacer pruebas y que en odoo 17 funcione».
Repositorio: C:/Users/figod/Desktop/ana-rutas. Rama comprobada: develop, HEAD fe5e4c6.
Árbol Git limpio al iniciar. Producción, main, Five Ventas y EasyPanel fuera del alcance.

## Resultado requerido

Una devolución nueva del chofer genera un traslado de regreso asociado al surtido
original validado, con sólo los productos y cantidades reportados. Los demás
productos no se incorporan al traslado. El personal de Odoo lo valida manualmente.
El alcance no incluye facturas, notas de crédito, pagos ni reposiciones en Odoo.

Las ubicaciones, compañía, tipo de operación y unidades se obtienen del surtido y
de las capacidades reales de la instalación. No se codifican clientes, productos,
almacenes, usuarios, credenciales ni identificadores de negocio.

## Auditoría del código actual

- src/core/product-incidents.ts: reportProductIncident guarda devolución,
  evidencia y recibo del comando en una transacción PostgreSQL. No llama a Odoo.
- changeProductIncident permite corrección/cancelación con bloqueo, identidad y
  versiones mientras el pedido admite atención. Debe seguir siendo coherente con
  cualquier traslado que se haya generado externamente.
- src/core/orders-contract.ts y route_shipments.snapshot conservan pickingId,
  orderId, partnerId, moveId, productId, saleLineId y uomId del origen importado.
- route_product_incidents guarda la referencia financiera cuando está disponible.
  No se puede inferir el ID del producto mediante su nombre.
- src/core/odoo.ts usa JSON-RPC con funciones de lectura privadas, ámbitos de
  compañía y huella de origen. La escritura debe ser una capacidad cerrada del
  dominio de devoluciones, no un RPC genérico expuesto a la APK.
- src/core/financial-policy.ts, inspectRelatedMoves: cualquier movimiento no
  cancelado vinculado a una devolución produce RETURNED_STOCK, incluso pendiente.
  projectDriverFinancials no entrega totales cuando el origen deja de estar ready.
  Es obligatorio probar esta conexión antes de activar el envío a Odoo.
- Ya existen cola/recibos de comandos de la APK, revisión optimista, auditoría,
  fotografías privadas y procesos de trabajo del servidor. Conservar contratos.

## Referencias oficiales verificadas

- Odoo 17, procedimiento:
  https://raw.githubusercontent.com/odoo/documentation/17.0/content/applications/sales/sales/products_prices/returns.rst
- Odoo 20, procedimiento:
  https://raw.githubusercontent.com/odoo/documentation/20.0/content/applications/sales/sales/products_prices/returns.rst
- Odoo 17, wizard:
  https://raw.githubusercontent.com/odoo/odoo/17.0/addons/stock/wizard/stock_picking_return.py
- Odoo 19, referencia intermedia de la evolución de API:
  https://raw.githubusercontent.com/odoo/odoo/19.0/addons/stock/wizard/stock_picking_return.py
- Odoo 20, API externa y transacciones:
  https://www.odoo.com/documentation/20.0/developer/reference/external_api.html
- Odoo 20, acción nativa de devolución:
  https://raw.githubusercontent.com/odoo/odoo/20.0/addons/stock/models/stock_picking.py

Ambas documentaciones de negocio distinguen crear el traslado y validarlo.
En 17 el método público es create_returns y las líneas usan la unidad del producto.
La referencia 19 usa action_create_returns y la unidad del movimiento.
El Odoo real de develop es 20.0+e: ya no tiene esos modelos de wizard.
Su vista usa stock.picking.action_return, que crea un borrador con demanda cero.
El conector completa exclusivamente ese borrador intacto, elimina los movimientos
no seleccionados, confirma y reserva. Nunca valida. Registro de modelos,
fields_get y botones de la vista determinan el método; no se elige por un número
de versión ni se tantean métodos de escritura.

## Momento de envío implementado

Crear el traslado al confirmar la atención/cobro del pedido. Así se
agrupan sus devoluciones y se conservan las correcciones anteriores al cierre.
La incidencia se ve de inmediato en el panel como pendiente de cobro. Confirmar
el cobro guarda recibo, atención y trabajo de envío en la misma transacción local.
El trabajador realiza la escritura externa después del commit. Las devoluciones
canceladas se excluyen; varias del mismo movimiento se suman por ID, nunca por
nombre. Las correcciones permanecen disponibles hasta el cierre existente.

## Bloques ejecutados

1. Contrato y capacidad de devolución:
   - inspección de la instalación real de develop, únicamente en lectura;
   - contrato cerrado de origen, cantidades, unidad, compañía y respuesta;
   - selección de campos y método por capacidades reales;
   - definición verificable de idempotencia remota antes de habilitar escritura.
2. Envío automático:
   - persistir trabajo durable dentro de la transacción del evento aprobado;
   - identificar instalación y fuente Odoo, además de surtido y movimiento;
   - worker con exclusión concurrente, recuperación y auditoría;
   - crear traslado nativo con cantidades explícitas y sin productos ajenos;
   - guardar ID/folio y estado de Odoo; nunca ejecutar button_validate;
   - no reenviar incidencias históricas anteriores a la activación;
   - no repetir una creación cuyo resultado remoto sea incierto.
3. Integración y QA:
   - conservar efectos financieros ya registrados y recibos de cobro;
   - tratar únicamente devoluciones propias verificadas, manteniendo protección
     para movimientos externos, origen cambiado y validación manual;
   - estado de envío y folio consultables por administración;
   - correcciones/cancelaciones según el momento de envío aprobado;
   - regresiones de APK, permisos, incidencias, cobro y aislamiento;
   - evidencia de cobertura, mutación, seguridad y contrato Odoo real;
   - commit/push sólo develop tras puertas verdes o excepción expresa, sin deploy.

## Invariantes y condiciones de parada

- Original: surtido de cliente validado, producto/movimiento/unidad de ese surtido.
- Cantidad positiva y precisión certificada; suma de devoluciones no excede la
  cantidad disponible después de devoluciones existentes.
- Destino y compañía verificados contra el origen. No se eligen por nombre.
- Validación de Odoo exclusivamente manual. No devolución de todos por defecto.
- La persistencia local y la escritura Odoo son transacciones diferentes:
  una cola local por sí sola no demuestra idempotencia remota.
- Antes de usar una operación de creación debe resolverse la pérdida de respuesta
  después del commit remoto. Si el wizard nativo no admite correlación atómica,
  documentar el mecanismo adicional necesario y confirmar su alcance.
- Un movimiento ya validado o editado externamente no se modifica silenciosamente.
- La cola no mezcla fuentes Odoo después de una rotación de cuenta.
- No continuar con escrituras si falta contrato, autorización o aislamiento.

## Aceptación y pruebas

Escenarios: devolución parcial/total, varios productos, cantidades fraccionarias,
dos líneas del mismo producto, distinta unidad del producto/movimiento, almacenes
y compañías distintos, origen pendiente/cancelado, producto ajeno, foto requerida,
chofer ajeno/sesión revocada, comando duplicado, dos envíos concurrentes, corrección,
cancelación, retorno manual previo, reinicio, timeout antes/después del commit,
respuesta perdida y rotación de Odoo.

Gherkin y QA reproducible con registros reales de Odoo develop y PostgreSQL.
Medir cobertura de rutas críticas y mutación sobre cantidades, ámbito y reintentos;
objetivo de 100% de escenarios críticos, sin ocultarlos en un promedio global.
Registrar latencia, intentos, fallos y recuperación del worker sin secretos.
La prueba real Odoo 17 requiere una instalación de pruebas de esa versión:
la documentación/contrato estático no se declara integración real con producción.

## Idempotencia e instalación

La referencia AR/RETURN/<UUID del trabajo> pasa como default_name al método
nativo. El código oficial 17/20 conserva ese valor y tiene unicidad de referencia
por compañía. En el Odoo 20 real se comprobó que una segunda creación con la
misma referencia falla y no deja dos traslados. No requiere instalar un módulo.

La cola persiste creation_started antes de llamar al método, y después guarda
el ID remoto. Si se pierde una respuesta, busca la referencia, comprueba origen,
compañía, cliente, ubicaciones, movimientos y cantidades, y retoma el mismo
traslado. Un borrador remoto con cantidades ya editadas no se sobrescribe.
Si la creación quedó incierta y no se encuentra la referencia, el trabajo queda
uncertain y sigue comprobando; no vuelve a crear a ciegas. Este caso y los cambios
manuales de folio/identidad requieren revisión; no se promete éxito automático
ante ausencia de evidencia. Los fallos de lectura previos a crear sí reintentan.

RUTAS_ODOO_RETURNS_ENABLED=true activa la capacidad en la instalación elegida.
Su valor predeterminado es false. RUTAS_ODOO_RETURNS_POLL_SECONDS es opcional,
predeterminado 15. Las credenciales existentes siguen en variables del servidor.
No se cambiaron variables ni se hizo deploy en EasyPanel.

Migración 48 aditiva: conserva usuarios, APK, choferes, camionetas, clientes,
horarios, recibos y configuración. Únicamente nuevos eventos return registrados
con la capacidad habilitada reciben una marca de captura; no hay backfill.
La cola se vincula a la instalación y fuente Odoo, al cobro y al pedido original.
Restricciones y triggers impiden cambiar el payload, el ID remoto o revertir
creation_started. PostgreSQL serializa trabajadores entre réplicas por fuente.

## Evidencia real y límites

No hubo acceso a Odoo de producción, main, Five Ventas ni EasyPanel.
En Odoo develop se creó la devolución de prueba 7, se recuperó tras una pérdida
de respuesta y se comprobó la unicidad. Sólo ese traslado de QA se canceló para
ejecutar el recorrido completo después; el pedido original no se canceló.
La segunda prueba importó S00004/WH/OUT/00004, usó PostgreSQL aislado, acceso
firmado del chofer y foto real. Su devolución de QA 9 se canceló únicamente para
repetir el recorrido tras la revisión de complejidad. La prueba final dejó la
devolución 10 en assigned sin validar: movimientos 61/producto 34 y 62/producto 2,
ambos unidad 1/cantidad 0.25; los otros 13 productos quedaron fuera.
Dos trabajadores concurrentes dieron prepared/busy; repetir cobro/envío no duplicó
la devolución. Releer Odoo después conservó el recibo y su importe intactos.
Referencia: AR/RETURN/f7e6ae51-6cb6-4054-b69d-3d3e26a16619.

El artefacto implementa el contrato documentado de Odoo 17 y convierte las
unidades del wizard. La verificación real 17 sigue pendiente de una instalación
17 de pruebas; no se declara certificada producción a partir de documentación.
Escenarios: tests/acceptance-odoo-returns.feature. Resultados y procedimiento:
QA-DEVOLUCIONES-ODOO-2026-10-09.md.
