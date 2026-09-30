# Liquidación de rutas — diagnóstico y propuesta para aprobación

Fecha: 30 de septiembre de 2026, America/Mexico_City.
Estado: bloque 1 aprobado por el usuario («dale»), implementado y verificado; evidencia final en QA-FUENTE-FINANCIERA-BLOQUE-1.md. Bloques 2..6 pendientes.
Base inspeccionada: `develop`, commit `485ab3f`, repositorio `frankzuuia/anarutas`.
Fuente del alcance: último texto adjunto del usuario y sus seis capturas. Los adjuntos repetidos anteriores se descartan.

Este documento conserva el diagnóstico y la propuesta originales. El bloque 1 fue aprobado y su evidencia se documenta en QA-FUENTE-FINANCIERA-BLOQUE-1.md; los bloques restantes siguen propuestos. No se modificaron pedidos Odoo, cuentas, rutas ni servicios remotos. La carpeta abierta inicialmente era `five`; se encontró y auditó el repositorio independiente `ana-rutas`. Five queda fuera del alcance.

## 1. Resultado que debe entregar el sistema

Odoo validado → cantidades e importes finales por partida → incidencias valorizadas → confirmación de cobro → solicitud del chofer → aceptación del liquidador → historial y métricas.

El cierre operativo en bodega ya existe y se conserva. Terminar el recorrido, registrar lo cobrado al cliente y entregar efectivo a administración son hechos distintos. Cada hecho requiere su propia evidencia y estado.

## 2. Evidencia de la revisión

### 2.1 Odoo real, consultas de lectura

Se autenticó contra la instancia configurada en el servicio de Ana Rutas y se consultaron `fields_get`, `search_read` y `read`. La versión reportada fue `saas~19.4+e`.

| Pedido | Transferencia de almacén | Estado observado | Total del pedido | Evidencia |
| --- | --- | --- | --- | --- |
| S00092 | WH/OUT/00095 | `assigned`, sin `date_done` | 2,498.38 MXN, todavía provisional para este flujo | 11 partidas; cantidades entregadas en cero |
| S00093 | WH/OUT/00096 | `done`, validado | 3,538.00 MXN | 17 partidas; cantidades pedidas y entregadas coinciden en la consulta |

Ejemplos reales de S00093:

| Producto | Cantidad | Precio unitario | Total de partida en Odoo |
| --- | --- | --- | --- |
| Apio pieza Kg | 1.07 kg | 38.97 | 41.70 |
| Calabacita | 3.17 kg | 16.91 | 53.60 |
| Calabacita Grande | 4.09 kg | 13.53 | 55.34 |
| Cebolla Morada Pelada | 5.30 kg | 31.64 | 167.69 |

Se comprobaron en los metadatos reales `sale.order.line.price_unit`, `discount`, `price_subtotal`, `price_tax`, `price_total`, `product_uom_qty`, `qty_delivered`, `product_uom_id`, `tax_ids`, `currency_id` y `write_date`. Esta instalación usa `product_uom_id` y `tax_ids`; no se presupone la nomenclatura de otra versión.

La moneda observada fue MXN, con redondeo 0.01 y dos decimales. Ambos pedidos carecen de facturas vinculadas (`invoice_ids=[]`): la fuente comprobada es la orden de venta y su entrega validada, no una factura contable existente. Ningún dato de esta muestra se convertirá en una constante del producto.

**Redondeo demostrado:** las partidas redondeadas de S00093 suman 3,537.99, pero el total de Odoo es 3,538.00. La suma sin redondear de cantidad × precio en esta muestra, sin descuentos ni impuestos, es 3,537.9966. Se preservarán los importes originales y se representará explícitamente la conciliación de redondeo comprobada. Una discrepancia cualquiera no puede etiquetarse automáticamente como redondeo.

Una lectura concurrente de metadatos recibió HTTP 429. Las posteriores consultas secuenciales funcionaron. El mecanismo automático necesita control de concurrencia, caché de metadatos por origen, respeto de Retry-After cuando exista y recuperación con espera creciente; no un bucle que consulte Odoo por cada teléfono.

Limitaciones de esta evidencia: no se provocó la validación de S00092, no se escribieron casos de prueba en Odoo y la muestra no certifica descuentos, impuestos, entregas parciales ni notas de crédito reales. No se consultó directamente el PostgreSQL privado desplegado. El esquema y sus restricciones se inspeccionaron en código; las pruebas locales usan PostgreSQL temporal real.

### 2.2 Conexiones verificadas en código

| Conexión | Estado actual y consecuencia |
| --- | --- |
| `src/core/odoo.ts`, `hydratePickings` | Lee cantidades y notas; no solicita precios, descuentos, impuestos o totales. |
| `src/core/orders-contract.ts`, `ShipmentLine` | Conserva `moveId`, `productId`, nombre, cantidad y unidad; falta identidad de línea de venta y contrato monetario. |
| `src/core/order-candidates.ts`, `persistCandidateSelection` | Relee al confirmar la selección y puede refrescar el snapshot del borrador. No es sincronización continua. |
| `src/core/odoo.ts`, `readRoutingCandidates` | La consulta depende de un rango de fechas; no sirve sin cambios para vigilar pedidos ya importados que se validen otro día. |
| `src/core/route-publication-content.ts` | Publica nombre/cantidad/unidad y descarta IDs de las partidas y estado de validación. |
| `src/core/route-start-guards-schema.ts` | La base prohíbe cambiar publicaciones y envíos de rutas iniciadas. Sobrescribirlos para refrescar precios colisionaría con esta protección. |
| `src/core/driver-mobile-route.ts` | El chofer recibe el snapshot publicado, con capas actuales de dirección, teléfono, bodega y miniaturas. No hay capa monetaria. |
| `src/core/driver-mobile-events.ts` | La huella de actualización considera publicación, ejecución y política; requiere una versión financiera para detectar cambios de importes. |
| `src/core/product-incidents.ts` y migraciones 27/29/30 | Incidencias por `line_index`, con cantidades contrastadas contra el snapshot publicado. Los faltantes manuales tienen `line_index=NULL`, producto y unidad escritos manualmente. |
| `src/core/product-incident-admin-cancel.ts` | Quitar del reporte una incidencia de pedido terminal puede conservar su estado original. Ocultarla no significa revertir su efecto monetario. |
| `src/core/driver-order-command.ts` | Confirmar entrega cambia estado operativo y registra evidencia; no registra forma de pago ni cantidad cobrada. |
| `src/core/driver-route-completion.ts` y `driver-service-context.ts` | Una ejecución terminada impide comandos operativos nuevos. La liquidación posterior necesita autorización financiera propia, sin reabrir la ruta. |
| `src/core/auth.ts`, `database.ts`, `src/server/http.ts` | Las cuentas administrativas sólo distinguen actividad; no existe rol de liquidador. Validar sesión no separa capacidades. |
| `src/core/control-screens.ts` | El centro de control puede incrustar módulos. Hay que proteger también esta entrada y las APIs, no sólo el menú. |
| `src/core/plan-archive.ts` | Archiva planes semanalmente sin borrar. El historial financiero debe seguir disponible y no depender de la visibilidad del plan. |
| `driver-app/.../DriverApi.kt` y `RouteServiceSheets.kt` | Android nativo/Kotlin; el modelo sólo tiene nombre, cantidad, unidad y miniatura. La UI no tiene precios ni cobro. |

### 2.3 Diagnóstico

No falta únicamente un botón. Faltan el contrato monetario, el seguimiento automático de validación, la identidad durable de las partidas y el registro separado de cobro/recepción. Actualizar el JSON publicado directamente rompería las restricciones de ruta iniciada y las referencias de incidencias. Agregar sólo una tarjeta deshabilitada dejaría las APIs accesibles a cuentas no autorizadas.

## 3. Reglas de negocio propuestas

Identificadores propuestos BL-157 a BL-168, posteriores a BL-156 existente. Se integrarán en BUSINESS_LOGIC, MASTER-SPECIFICATION y PROGRESS al aprobar el bloque, conservando su historial.

| Regla | Actor / comportamiento | Datos, permiso y auditoría | Validación |
| --- | --- | --- | --- |
| BL-157 — Importes finales | Chofer: ve cantidad pesada, precio y total provenientes de la entrega validada y su orden. Pendiente no se presenta como final. | Origen/empresa/picking/línea/UOM/moneda/versión; consulta de ruta propia; registrar observaciones y cambios. | Contrato Odoo real, estados, decimales y partidas completas. |
| BL-158 — Actualización automática | Sistema: vigila identidades importadas y propaga validaciones sin recarga o republicación manual. | Revisiones por fuente; una adquisición de trabajo por instancia; errores y antigüedad visibles. | Cambios de día, 429, reinicio, fallos de red, carrera con confirmación. |
| BL-159 — Identidad y conservación | Sistema: cada ajuste afecta la misma partida aunque cambie su orden visual. | Referencias estables a movimiento y línea de venta, versión de origen y recibos; no asociar por nombre. | Líneas repetidas, removidas, partidas de igual producto y datos heredados ambiguos. |
| BL-160 — Devoluciones y faltantes | Chofer: descontar sólo cantidades ligadas a una partida efectivamente cobrada. | Incidencia, evidencia y valorización versionada; autorización de ejecución propia. | No descontar dos veces; cantidad acumulada no excede la fuente. |
| BL-161 — Reposiciones | Chofer pregunta si se paga todo ahora o si el importe de reposición queda para su entrega posterior. | Elección explícita por reposición; mantener obligación de reposición y saldo diferido. | Pago completo no genera doble cobro; diferido no se convierte en devolución definitiva. |
| BL-162 — Cobro | Chofer: efectivo, transferencia o crédito; importe recibido y notas. | Importe esperado, recibido, diferencia, moneda y versión; comando recuperable. | Cobro parcial estructurado, red perdida y doble confirmación. |
| BL-163 — Liquidación del chofer | Chofer: consultar clientes/pedidos/incidencias y solicitar por pedido o por ruta terminada. | Sólo ejecuciones propias; detalle conservado y solicitud identificable. | No volver a incluir importes ya aceptados ni solicitudes superpuestas. |
| BL-164 — Recepción | Liquidador: aceptar/rechazar una solicitud revisando el monto y el detalle. | Identidad de receptor, fecha, recibo, motivo de rechazo y versión exacta. | Aceptación transaccional; dos receptores concurrentes no cobran dos veces. |
| BL-165 — Permisos | Admin rutas administra operación y crea cuentas separadas; liquidador sólo entra a liquidación. | Roles en servidor y base; sesiones, descargas y eventos autorizados; auditoría de altas/cambios. | Matriz negativa de todas las APIs y módulos incrustados. |
| BL-166 — Totales | Ambos: efectivo, transferencias y crédito separados. | Efectivo pendiente, entregado/aceptado, transferencias registradas y deuda; no mezclar monedas. | Sumatorias trazables a recibos únicos y misma revisión. |
| BL-167 — Historia | Liquidador: rutas terminadas agrupadas por chofer, pedidos navegables y filtros por fechas. | Fecha de servicio, cobro, solicitud y aceptación separadas; zona horaria configurada. | Rutas archivadas/retiradas, chofer inactivo y consultas de hace 15 días. |
| BL-168 — Correcciones | Usuarios autorizados: ajustes posteriores con evidencia, sin reescribir lo aceptado. | Registro compensatorio y estado visible; permisos específicos antes de implementarlo. | Una corrección nunca altera silenciosamente recibos históricos. |

### Precisiones necesarias para las matemáticas

- Dinero y cantidades se calculan con decimales exactos en servidor; Android recibe importes autoritativos y usa representación decimal para entrada/presentación.
- El precio pertenece a la línea comercial original, con su descuento, impuestos y UOM. No se toma el precio actual del catálogo ni se multiplica el precio de una unidad por otra unidad distinta.
- Mismo producto en dos líneas no equivale a la misma partida. Una orden repartida en dos transferencias no puede llevar el total completo de la orden a cada transferencia.
- Una incidencia manual de un producto ausente de Odoo no permite inventar un precio ni restar algo que no estaba cobrado. Si el faltante estaba incluido, deberá vincularse explícitamente a su partida verificable.
- Propuesta para el ejemplo «queda a deber $50»: registrar la cantidad efectivamente recibida, el saldo pendiente calculado y la nota. No depender de interpretar la nota para cuadrar caja ni convertir automáticamente el pedido en crédito total.
- Propuesta para reposición diferida: mostrar importe a cobrar ahora y saldo por reposición por separado; el momento de entrega/cobro futuro conserva el vínculo para impedir duplicidad. La operación futura de ese cobro debe especificarse antes de habilitarla.
- Transferencia registrada es una declaración del cobro; no implica una confirmación bancaria que actualmente no existe. Crédito es cuenta por cobrar, no dinero recibido.
- Efectivo pendiente de entregar = efectivo cobrado y confirmado − efectivo ya aceptado por liquidación ± correcciones financieras autorizadas. Una solicitud pendiente no equivale a dinero recibido por el administrador.
- Las métricas distinguirán cobrado por chofer, solicitado y aceptado por liquidador. Crédito y transferencias nunca se suman al efectivo físico a entregar.

## 4. Arquitectura que conserva los contratos actuales

### Fuente y revisiones

Agregar almacenamiento financiero independiente y aditivo, con snapshots versionados de origen. Nombres de tablas y endpoints nuevos se decidirán en la especificación del bloque: no se describen como existentes.

Cada versión conserva identificación de origen/empresa, picking, movimiento, línea de venta, producto, unidad, moneda, cantidades, importes, estado de validación y huellas/fechas de lectura. Una secuencia de consultas a Odoo no es una transacción compartida con PostgreSQL: detectar modificaciones durante la lectura mediante revisiones/huellas antes de publicar una versión coherente y reintentar si cambió la fuente.

Vigilar los IDs importados, sin limitarlos por la fecha original del selector. Consultar por lotes y metadatos cacheados; no emitir consultas por producto o por dispositivo. La escritura local se realiza después de la lectura externa, en transacción breve. Conservar el último resultado confirmado si Odoo falla, mostrando su antigüedad; no usar cero para representar dato ausente.

### Publicaciones e incidencias

Conservar los snapshots operativos y la protección de rutas iniciadas. La lectura compone una versión financiera autorizada sobre la ruta. La versión financiera no incrementa la revisión de publicación ni reinicia guía, GPS, fotos o visitas.

La composición debe ser común para app, panel e incidencias. No basta con mostrar una cantidad nueva en Android mientras el trigger de incidencias verifica otra cantidad antigua. Para el nuevo contrato se conservará la versión y la referencia estable de la partida al reportar una incidencia. Las referencias heredadas sólo se migran automáticamente cuando su equivalencia es demostrable con datos guardados; nunca por coincidencia del nombre.

Cuando ya exista confirmación monetaria, conservar la versión usada. Un cambio posterior de Odoo produce una diferencia/revisión auditable y no sustituye la cantidad que el chofer confirmó haber recibido. Entregas históricas sin cobro no recibirán efectivo o forma de pago inventados.

### Eventos e interfaces

Los eventos sólo notifican que existe una versión nueva; el cliente vuelve a consultar datos autorizados. Incluir revisión financiera en la huella móvil y revisar ambos consumidores Android: el tablero y el modelo de ejecución que mantiene la ficha abierta.

La ficha de producto mantendrá nombre y miniatura, cantidad, precio unitario y total en dos niveles legibles. El resumen separado explicará ajustes e importe a cobrar. La tarjeta del inicio abre liquidación propia; cada pedido abre productos/incidencias y tiene acción de liquidación separada para evitar pulsaciones accidentales.

En administración: navegación deshabilitada según rol y validación real del servidor. El liquidador inicia directamente en su módulo. «Usuarios y accesos» tendrá registros/formularios separados para administradores de rutas y liquidadores. Los administradores actuales conservarán su rol operativo, sin otorgarles liquidación automáticamente.

### Recepción e historia

Las solicitudes y recibos financieros se vinculan a la ejecución histórica, con identidad y detalle durable, no exclusivamente a una publicación o asignación mutable. Una ruta terminada admite operaciones financieras autorizadas aunque sus comandos operativos estén cerrados.

La aceptación utiliza importes calculados por servidor y la revisión exacta solicitada; no confía en un total enviado por Android/navegador. Idempotencia y restricciones en PostgreSQL impiden dos aceptaciones y solapamiento pedido/ruta. Rechazar conserva historia y vuelve a permitir una solicitud corregida identificable. Cancelar un modal no registra recepción.

Liquidar toda la ruta incluye únicamente partidas elegibles pendientes; lo ya aceptado se muestra descontado. Una solicitud individual todavía pendiente debe resolverse o gestionarse de forma explícita antes de incluirla en otro lote. No generar automáticamente una segunda solicitud sobre el mismo cobro.

## 5. Bloques de implementación

| Bloque | Resultado verificable | Dependencias |
| --- | --- | --- |
| 1. Fuente financiera | Contrato Odoo, identidades estables, decimales, snapshots y sincronización automática verificable en servidor. | Aprobación de este primer bloque. |
| 2. Precios e incidencias del chofer | La ficha muestra pesos/precios finales; incidencias referencian la partida y versión correctas; pregunta de pago para reposiciones. | Fuente financiera certificada; conexión de validadores, eventos y APK. |
| 3. Registro de cobro | Confirmación efectivo/transferencia/crédito, importe recibido, diferencia y notas; recibo recuperable. | Matemáticas de incidencias y congelación de versión. |
| 4. Cuentas y acceso | Alta separada de liquidadores y restricciones completas por rol en servidor, pantallas, eventos y evidencias. | Matriz de permisos auditada antes de habilitar cuentas nuevas. |
| 5. Solicitud y recepción | Liquidación por pedido/ruta, aceptación/rechazo, métricas, filtros e historial agrupado por chofer. | Cobros, roles y persistencia histórica. |
| 6. Validación completa | E2E, concurrencia, recuperación, APK, regresiones y evidencia integrada. | Todos los bloques; cada uno ya requiere sus pruebas locales. |

La secuencia no declara terminada la petición al entregar el bloque 1. Se controla el avance sin mezclar una migración financiera, permisos y nuevas pantallas en una sola cirugía. No se delegan decisiones monetarias, seguridad ni concurrencia.

## 6. Primer bloque propuesto: alcance concreto

### Pasos, en orden

1. Integrar BL-157..159 y los escenarios LQ01..LQ14 en los documentos canónicos, con trazabilidad de tareas, y separar lo pendiente de los bloques posteriores.
2. Añadir contrato de importes e identidad de partida al adaptador de lectura Odoo. Incluir moneda/UOM reales, descuentos, impuestos, fecha y coherencia de datos; no ampliar el conector a escrituras.
3. Añadir migración aditiva de snapshots financieros/revisiones y cola de actualización, conservando publicación, orden de paradas, visitas y recibos existentes. Inspeccionar y fijar el número de migración disponible justo antes de editar.
4. Conectar altas/importaciones a seguimiento automático por ID y añadir un worker con exclusión, reintentos y métricas. La cola y el worker no requieren activación manual por pedido.
5. Exponer al servidor de rutas la versión financiera mediante una lectura reutilizable y autorizada, todavía sin habilitar cobros. La adopción en la ficha móvil y los validadores de incidencias se hace conjuntamente en el bloque 2.
6. Ejecutar pruebas unitarias, contratos Odoo de lectura, migración/PG, concurrencia, cobertura, mutación y regresiones; registrar resultados y límites. No aprobar el bloque por compilar solamente.

### Archivos existentes que se prevé tocar

- Documentación: `docs/BUSINESS_LOGIC.md`, `docs/MASTER-SPECIFICATION.md`, `docs/PROGRESS.md`.
- Conector/contratos: `src/core/odoo.ts`, `src/core/odoo-capabilities.ts`, `src/core/orders-contract.ts`, `src/core/order-candidates-contract.ts`.
- Puntos de alta: `src/core/order-candidates.ts`, `src/core/orders.ts` y sus pruebas reales.
- Migración/arranque/configuración: `src/core/database.ts`, `src/core/config.ts`, `src/instrumentation.ts`, `.env.example`.
- Pruebas existentes afectadas: `tests/odoo.test.ts`, pruebas de capacidades, importación y migración; configuración de cobertura/mutación dedicada.
- Nuevos módulos propuestos: contrato monetario, validación/capacidades financieras, esquema y almacén financiero, lectura financiera y worker de sincronización, pruebas Gherkin/PG/unitarias y reporte QA. Sus nombres se fijan al iniciar el bloque, sin suponer que ya existen.

Se verificará el diff archivo por archivo. Cualquier ampliación funcional ajena al bloque se presenta antes de ejecutarla. Los pasos 2–5 no conceden roles nuevos, no escriben pagos en Odoo y no modifican las restricciones de ruta iniciada.

### Matriz del primer bloque

En todos los escenarios, el acceso respeta instalación, origen Odoo, empresa y asociación a pedido; las escrituras propuestas son únicamente en PostgreSQL de Ana Rutas.

| Caso | Precondición / evento | Resultado y datos | Auditoría / validación / recuperación |
| --- | --- | --- | --- |
| LQ01 | Importar picking pendiente | Seguimiento creado; importes marcados provisionales, nunca cobrables como finales. | Contrato lectura + PG; rechazo de forma incompleta. |
| LQ02 | Picking seguido cambia a done | Nueva versión con cantidades e importes finales coherentes. | Hash/fecha; ensayo Odoo real cuando exista transición; reintento si cambia durante lectura. |
| LQ03 | Validación ocurre otro día | Consulta por identidad encuentra el cambio. | Prueba de contrato por ID, sin depender del rango del selector. |
| LQ04 | Ya validado al importar | Misma fuente de cantidades/precios que LQ02. | Comparación de lectura directa y persistida. |
| LQ05 | Reordenar/dos líneas del mismo producto | Identidad preservada, sin mezclar precios ni cantidades. | Pruebas de referencias, claves y contratos. |
| LQ06 | Entrega parcial/backorder/múltiples movimientos | No duplicar el total de una venta por picking. | Conciliación trazable; bloquear la valoración no demostrable. |
| LQ07 | Diferencias entre UOM, moneda, impuestos o descuentos | Aplicar contrato verificado; rechazar combinación no soportada explícitamente. | Fuente real, unitarias de decimales; sin fallback a precio cero. |
| LQ08 | Partidas redondeadas difieren del total Odoo | Preservar ambos; identificar ajuste sólo con evidencia de redondeo. | Regresión S00093; diferencia sin explicación queda visible/bloqueada. |
| LQ09 | Odoo falla o responde 429 | Conservar último snapshot, marcar antigüedad y reintentar sin avalancha. | Métricas de errores/reintentos/edad; validar estados de cola y contrato HTTP. |
| LQ10 | Dos workers/reinicio/resultado repetido | Una revisión aplicada y recuperación de trabajo abandonado. | PG real, idempotencia, exclusión y rollback. |
| LQ11 | Ruta ya iniciada | Datos financieros nuevos sin reescribir publicación ni romper guards. | Regresión de publicación/ejecución y hashes operativos iguales. |
| LQ12 | Fuente cambió durante consulta | No publicar una mezcla de revisiones Odoo. | Comparación de huellas; relectura controlada. |
| LQ13 | Origen distinto, otra empresa o pedido no autorizado | Ninguna lectura ampliada ni escritura cruzada. | Seguridad y claves de origen; error explícito sin exponer secretos. |
| LQ14 | Actualización del esquema/repetición/rollback de transacción | Datos existentes intactos, migración repetible y nueva cola recuperable. | PG real desde versión previa; rollback de artefacto sólo a versión compatible. |

### Casos de aceptación que deben conservarse en bloques siguientes

Devolución total/parcial; faltante ya descontado en Odoo; producto ausente sin precio; reposición pagada/diferida; edición/cancelación de incidencia antes del cobro; incidencia oculta del reporte; cambios después de cobro; efectivo parcial; crédito total; transferencia; monto cero por devolución total; exceso recibido/cambio explícito; doble tap; caída antes/después del commit; reconexión; app antigua; otra cuenta/chofer/dispositivo; sesión revocada; aceptación y rechazo simultáneos; pedido liquidado antes de liquidación global; solicitud vieja; ruta archivada/retirada; ventana de fechas y cambio de día; monedas distintas; deuda por reposición en otra jornada. Cada caso necesita tarea y evidencia antes de habilitar su flujo.

## 7. Puertas de calidad y límites de certificación

- Base observada: Node 24.18.0, Next 16.3.4, React 19.2.8, PostgreSQL 17 en servicio, Android/Kotlin. Las dependencias reales y sus guías se vuelven a consultar antes de tocar cada área.
- Typecheck del baseline: `npm run typecheck`, correcto el 30/09/2026.
- Regresión acotada del baseline: 6 archivos y 28 pruebas correctas en 80.54 s el 30/09/2026. Comando: `npx vitest run tests/order-candidates-validation.test.ts tests/order-candidates.test.ts tests/route-publication-content.test.ts tests/product-incidents.test.ts tests/driver-route-completion-policy.test.ts tests/driver-route-completion.test.ts --reporter=dot`. Incluye PostgreSQL real temporal para los contratos de persistencia. No equivale a pruebas de la función futura; no se midió nueva cobertura ni se ejecutó mutación en esta fase documental.
- Cobertura propuesta por riesgo financiero: 100% de escenarios críticos enumerados, al menos 95% de ramas y 95% de líneas del dominio financiero nuevo, con análisis de cada rama restante. Estos porcentajes son objetivos, no resultados alcanzados.
- Mutación: todas las mutaciones significativas que cambien signo, monto, identidad, versión, autorización o idempotencia deben detectarse. Objetivo mínimo 90% del dominio nuevo; cada superviviente requiere revisión, no ocultarlo tras el promedio.
- Integración/migración/concurrencia: PostgreSQL real temporal con los helpers existentes; sin simular servicios externos. Las pruebas locales no certifican una validación real de Odoo ni un GPS/cámara físicos.
- Calidad: typecheck, lint, build, cobertura y mutación; reportar complejidad de funciones afectadas y revisar especialmente las superiores a 10; cero defectos críticos/altos abiertos atribuibles al bloque.
- Métricas operativas: edad del último snapshot, demora desde validación hasta visibilidad, p50/p95 de sincronización y confirmación, errores por causa, 429, reintentos, conflictos, discrepancias monetarias y duplicados rechazados. El SLO numérico de sincronización se fija con medición del proveedor y volumen; no se inventa garantía de actualización instantánea.
- Pruebas de permisos deben incluir las APIs reales, SSE, fotos/evidencias, descargas y módulos incrustados. Botones deshabilitados no prueban autorización.
- Pruebas Gherkin, regresiones de los fallos observados y QA reproducible para cada bloque; al final, recorridos completos app→servidor→panel y recuperación después de respuesta perdida.
- No certificar integración Odoo con casos sintéticos, ni una APK con sólo build. Si faltan casos reales o dispositivo, documentar la puerta pendiente y solicitar la decisión específica, sin declarar verde lo no ejecutado.
- No despliegue desde este bloque. El propietario realiza el deploy según AGENTS.md; no promover a main sin instrucción expresa. Commit/push a develop sólo después de las puertas aplicables según la autorización permanente de ese repositorio.

Cierre del bloque1:108/108 pruebas financieras con Odoo/PG real,787 regresión/0 fallos,3/3 E2E,99.62% líneas y99.24% ramas dirigidas,598/606 mutaciones de dominio y12/12 PG detectadas. Typecheck/lint/build/bundle aprobados y audit0 vulnerabilidades con Next16.3.8. Las omisiones externas y límites de la muestra se detallan en QA-FUENTE-FINANCIERA-BLOQUE-1.md; no se certifica liquidación completa ni producción.

## 8. Referencias

- `AGENTS.md` del repositorio Ana Rutas: bloques aprobados, no mocks, aislamiento respecto de Five, separación develop/main y despliegue del propietario.
- `docs/PROGRESS.md`, sección BL-118: trabajo financiero previamente pendiente; BL-155/156: cierre operativo y bodega ya incorporados.
- `docs/MASTER-SPECIFICATION.md`, BL-143..156: incidencias, contratos Android y conservación de ejecución/publicación.
- Guía instalada: `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`.
- [Odoo, External RPC API](https://www.odoo.com/documentation/19.0/developer/reference/external_rpc_api.html): inspección de modelos y operaciones de lectura.
- [Odoo, políticas de facturación](https://www.odoo.com/documentation/19.0/applications/sales/sales/invoicing/invoicing_policy.html): distinción entre cantidades ordenadas y entregadas.
- [Odoo, impuestos](https://www.odoo.com/documentation/19.0/applications/finance/accounting/taxes.html): el importe requiere la configuración fiscal real, no un porcentaje fijo supuesto.

## 9. Veredicto y siguiente decisión

El usuario aprobó el bloque 1 con «dale» y confirmó la continuación durante su implementación. La evidencia final está en QA-FUENTE-FINANCIERA-BLOQUE-1.md. Esta fuente de datos no equivale a la liquidación completa.

No volver a solicitar aprobación del bloque 1 ya concedida. Los bloques siguientes requieren cerrar su especificación y revisar sus reglas particulares antes de construirlos, conforme a la ejecución por bloques acordada.
