# IR — resolución y regreso al pedido

Bloque aprobado por el propietario con «dal3» después de presentar panel, APK,
pruebas y entrega a develop. Base c26736a. Producción, main, Five Ventas y
EasyPanel quedan fuera. Sin ui-ux-pro-max, mocks, despliegue ni cambios de Odoo,
cobros, clasificación o formato Excel.

## Autopsia y contrato

1. El selector general .fleet-dialog sobrescribía el padding del cuadro de
   resolución. Usar la clase ya existente product-incident-dialog y textarea
   contenido dentro de su marco; verificar escritorio y 390 px.
2. La vista de incidencias activas filtra producto pendiente. Las resueltas
   requieren una proyección de lectura separada sobre las mismas tablas, sin
   ampliar la fuente de alarmas ni modificar el esquema. Mostrar Resueltas en
   verde, por chofer/tipo, con filtros y paginación independientes, comentario
   de resolución y evidencia privada. Ocultar reportes retirados. Visto sigue
   compartido, con su primer administrador y auditoría única.
3. ProductIncidentSheet consumía la revisión confirmada para actualizar el
   formulario, pero no ejecutaba su cierre. Cerrar hacia StopAttentionSheet
   sólo al recibir comprobante válido de la misma parada y pedido, con lectura
   verificada, sin envío pendiente/busy y revisión posterior a abrir el form.
   En edición/cancelación exigir también el ID correspondiente. La revisión
   inicial sobrevive rotación. Fallos o respuestas inciertas conservan borrador
   y la cola ya existente.
4. El botón de cantidad completa existía debajo de Pago de la reposición.
   Colocarlo inmediatamente debajo de la cantidad, antes del pago, en los tres
   tipos ligados a partida. Conservar remainingProductQuantity, unidades,
   precisión decimal, restricciones y persistencia actuales.

## Ejecución controlada

- IR-T00: auditoría de estilos, lecturas, resolución, recibo, cola y navegación.
- IR-T01: panel y consulta de resueltas; pruebas PostgreSQL reales y navegador.
- IR-T02: contrato de recibo Android y posición del control de cantidad;
  pruebas JVM, cobertura, mutaciones, compilación Compose/lint/APK.
- IR-T03: regresión de alarmas, privacidad, dinero y devoluciones; revisión
  final y entrega únicamente develop. APK 0.8.24 / code46.

Las pruebas de API usan PostgreSQL temporal real, autenticación y JPEG reales;
no conectan Odoo ni sustituyen APIs. Mutaciones se ejecutan en copia aislada
bajo .local, con restauración entre casos y ruta de borrado verificada.
Objetivo de cobertura: 100% de líneas nuevas de recibo y lectura; ramas nuevas
de navegación al 100%. La rama histórica opcional de metadatos no justifica
alterar lógica ajena. Medir latencia local de consulta; no atribuirla a red,
teléfono ni producción. Sin dependencias nuevas. QA reproducible y métricas:
QA-INCIDENCIAS-RESUELTAS-2026-10-09.md.
