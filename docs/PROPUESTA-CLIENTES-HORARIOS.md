# Propuesta — Clientes y horarios

Estado: diseño visual aprobado y trasladado al contrato ejecutable BL-018..024 de `BLOQUE-4-CLIENTES.md` el 2026-09-09. Este documento conserva la autopsia, evidencia del Excel y decisiones de diseño; no acredita sincronización o despliegue.

## Evidencia revisada

- `DIrectorio Clientes.xlsx`, Hoja1, C2:G94: 92 registros; 66 sin nombre en sistema; 18 sin liga; cinco excepciones de sábado y seis de domingo. No contiene columnas de teléfono, prioridad ni domicilio textual.
- Dos filas llamadas Molex tienen horarios y ligas distintos. Alcalde y Alcalde Comisariato comparten nombre en sistema. Ocho Avocalia comparten FOODOLOGY MEXICO. Esto no acredita por sí solo relaciones ni IDs en Odoo.
- Sanborns dice «Recoge»; Metate y café dice «Por definir»; Cortazar tiene «La perla» en Liga Maps. No convertir esos textos en horarios/coordenadas válidos.
- Hay intervalos ambiguos, como 01:00–03:00, 11:00–01:00 y 12:30–02:00. Las terminaciones 08:31 y 08:32 en Vincent se preservan y se señalan, no se redondean.
- Código actual: `src/core/odoo.ts` autentica y consulta Odoo por JSON-RPC, fija compañía/origen en servidor y conserva partnerId del destinatario del surtido. La sesión de lectura actual consulta metadatos de inventario incluso antes de hidratar pedidos; el directorio debe usar una sesión básica independiente de inventario.
- `orders-contract.ts` y `orders-schema.ts`: una ventana y high_priority boolean. No soportan aún prioridad media ni reglas semanales múltiples.
- `orders.ts`: cada plan conserva su propia copia del surtido y su snapshot. Se debe mantener esa independencia.
- `route-map-dialog.tsx`: geocodifica domicilios; no es todavía un directorio persistente de puntos de entrega.
- No se han consultado los clientes de las instalaciones reales en esta fase. La compatibilidad de documentación/código fuente no sustituye la prueba contractual real de ambas instalaciones.

## Pantalla propuesta

Entrada lateral «Clientes y horarios», conservando menú plegable y aspecto compacto de Ana Rutas. Barra superior: búsqueda, Actualizar clientes, Exportar Excel y Guardar cambios. Pestañas Activos y Archivados.

Tabla de filas compactas con encabezados fijos y desplazamiento propio. Columnas: Cliente, Nombre en Odoo, Teléfono, Ventanas de horario, Nota de entrega, Prioridad, Domicilio de entrega, Liga de Maps y Archivar. Matrices desplegables, sucursales indentadas y tipo de dirección visible; sin esconder clientes sin matriz. Al seleccionar una fila, editor a la derecha; al cerrarlo, la tabla recupera todo el ancho. En pantalla estrecha el editor será un panel completo con regreso a la lista.

La imagen es un boceto, no una captura de datos sincronizados. Los rótulos de teléfono/domicilio son ejemplos de estado. Los vínculos matriz/sucursal se comprobarán en Odoo; los valores definitivos vendrán del directorio confirmado y de la fuente real. No importar valores generados en la imagen.

Existe una única acción Guardar cambios en el editor, nunca dos escrituras. Las ediciones pendientes permanecen al fallar el guardado o el sync. Cambiar de cliente o de lista con cambios exige confirmar el descarte o seguir editando; no descarta silenciosamente. Cada extremo usa formato de 24 horas; por ejemplo, `11:00–13:00`. No se muestran selectores AM/PM.

## Reglas de datos

| Regla               | Comportamiento y validación                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C01 Identidad       | Clave única por instalación/origen Odoo + ID res.partner. Nunca nombre, teléfono, razón social o posición del Excel. IDs diferentes se conservan aunque parezcan duplicados. La misma identidad no se inserta dos veces, ni archivada ni activa.                                                                                                                                   |
| C02 Alcance         | Recuperar todos los contactos visibles en el alcance autorizado, incluidas matrices, hijos y direcciones, sin customer_rank, requisito de ventas, teléfono, domicilio o is_company. Incluir contactos compartidos sin company_id y los de la compañía configurada. No ampliar a otras compañías. Consultar directamente res.partner con paginación; no depender sólo de child_ids. |
| C03 Jerarquía       | parent_id describe relación directa y commercial_partner_id la entidad comercial cuando existan. Conservar tipo contact/delivery/invoice/other según metadatos. Un contacto de persona no se convierte automáticamente en sucursal comercial. Padre no visible se muestra como relación pendiente sin perder al hijo. No agrupar sólo por nombres.                                 |
| C04 Propiedad       | Nombre en Odoo y demás datos fuente se guardan separados de las preferencias de Ana Rutas. Cliente inicia con el nombre Odoo y puede editarse localmente. Horarios, nota, prioridad, domicilio de entrega y punto pertenecen a Ana Rutas. Ninguna edición escribe en Odoo.                                                                                                         |
| C05 Teléfono        | Detectar phone/mobile por fields_get. Pedir sólo campos existentes; preservar ambos si tienen números diferentes. Mostrar phone disponible y mobile como alternativo; si phone está vacío usar mobile. Sin ambos: Sin teléfono, pero importar el cliente. Cualquier corrección local queda protegida como los otros campos editables.                                              |
| C06 Actualización   | Primera carga crea directorio; las posteriores añaden identidades faltantes. Los datos fuente pueden refrescarse en su sección de sólo lectura, pero ningún campo operativo existente se sobrescribe, esté lleno o vacío. Una aparición nueva en Odoo no reinicia preferencias ni archivo. Registrar altas, existentes, cambios de fuente y errores con conteos reales.            |
| C07 Archivo         | Confirmación identificando cliente/sucursal. Archivar sólo el registro elegido en Ana Rutas, conservar ID y configuración, ofrecer restauración en Archivados. No archivar hijos automáticamente ni Odoo. El sync reconoce el archivado y no lo reactiva ni duplica. Archivar una matriz no oculta sucursales activas.                                                             |
| C08 Fuente inactiva | Separar activo/inactivo Odoo de archivado local. La exploración inicial considera active_test=false para no omitir contactos por el filtro predeterminado. Mostrar estado fuente; no borrar datos ni reactivar archivo local por cambios de fuente.                                                                                                                                |
| C09 Búsqueda        | Búsqueda sobre alias, nombre Odoo, matriz/sucursal, teléfono y referencia disponible. Normalizar mayúsculas, acentos y espacios sólo para buscar; conservar texto original. Consulta de todo el directorio en servidor, paginada y cancelable, no sólo de filas cargadas.                                                                                                          |
| C10 Guardado        | Validación de servidor, versión por registro, transacción y auditoría. Dos operadores sobre la misma versión: conflicto explicado, texto local preservado. Guardar y sincronizar no comparten indicadores de carga ni pueden sobrescribirse accidentalmente.                                                                                                                       |

## Horarios, prioridades y lugares de entrega

- Ventanas estructuradas con días de semana, hora inicial/final en formato de 24 horas y zona horaria de la instalación. Permitir más de un intervalo por día; chips editables con × y Añadir ventana. El servidor normaliza a minutos inequívocos antes de comparar o rutear. Excepción específica de sábado/domingo sustituye la regla general de ese día, no crea una ventana adicional contradictoria.
- Distinguir Sin configurar, Sin restricción, No recibe y Recoge. No asumir que un día sin información está cerrado, ni que Sin configurar significa libre 24 horas. Las ventanas cruzando medianoche necesitan día final explícito; nunca inferirlo de un Excel ambiguo.
- Intervalos idénticos no se duplican; intervalos superpuestos requieren corrección o unión explícita. La × cambia el borrador de edición y sólo persiste al guardar. Guardar una regla inválida no altera las anteriores.
- Cada sucursal mantiene su horario, punto, nota y prioridad. La edición de una matriz no propaga cambios automáticamente a sus hijos. Una futura acción «Aplicar a sucursales» exigiría selección explícita, sin destruir excepciones propias.
- Prioridad: Alta, Media, Por horario (sin prioridad explícita). Propuesta pendiente de confirmación: respetar las ventanas de recepción como restricciones, adelantar las altas y después las medias entre entregas factibles; usar horario y recorrido en el resto. Alta no autoriza llegar a un cliente cerrado. Conflictos se muestran con explicación, no se ocultan como una ruta válida.
- Domicilio inicial del registro Odoo, conservando las direcciones de entrega/facturación como registros separados. Resolver cada pedido por su destinatario, no por la primera dirección de la matriz. Correcciones de domicilio son locales.
- La primera sincronización copia la dirección de entrega de Odoo como domicilio inicial. Si el registro no es de tipo entrega, se conserva su tipo y se muestra para revisión; nunca se sustituye silenciosamente una dirección de facturación por una entrega. Una edición local activa la propiedad de Ana Rutas y las sincronizaciones posteriores ya no la sobrescriben.
- Al escribir o modificar el domicilio, Maps geocodifica y propone un punto en un mapa. El usuario puede aceptarlo o arrastrarlo antes de guardar. Una coincidencia dudosa o sin resultado queda «Punto por confirmar»; no se convierte automáticamente en coordenada válida.
- La ubicación canónica será coordenadas + referencia de lugar si existe + liga de origen + precisión/estado + autor/fecha/versión. La liga navegable se regenera desde el punto confirmado, por lo que no puede quedar apuntando a una ubicación distinta. Un enlace corto no equivale a coordenadas ya verificadas.
- Cambiar domicilio no conserva un pin antiguo como si correspondiera al nuevo texto: mostrar punto pendiente de revisión. Un pin ajustado manualmente no se reemplaza mediante geocodificación automática ni por una sincronización de Odoo.
- Futuro «Ajustar punto» del chofer: sólo el chofer asignado a una entrega pendiente puede abrir el mapa, mover el pin y confirmar. El servidor guarda una nueva versión de la ubicación del cliente/sucursal, regenera la liga de Maps y actualiza automáticamente los campos del directorio. No requiere que un administrador vuelva a capturarlos.
- La corrección del chofer actualiza también el destino de las entregas todavía pendientes vinculadas a esa sucursal. En una ruta en curso conserva el orden de paradas, actualiza la navegación a ese destino y recalcula los tiempos posteriores; no reorganiza silenciosamente la jornada ya despachada. Los borradores y rutas futuras consumen la versión nueva al optimizar. Las entregas terminadas conservan la ubicación histórica usada en ese viaje.
- Reintentos y eventos retrasados usan idempotencia y versión esperada: una ubicación vieja no pisa una corrección más reciente. Cada cambio conserva anterior/nueva coordenada, actor, entrega que originó el ajuste y fecha en auditoría.
- Google Maps todavía requiere configuración para mapa embebido/geocodificación. Abrir una liga existente es distinto y no exige configurar una API key. Enlaces que no puedan resolverse quedan pendientes, nunca como posición 0,0.

## Carga inicial del directorio Excel

1. Conservar archivo original y fila de procedencia. Leerlo sin ejecutar fórmulas, macros o enlaces; el archivo es datos, no instrucciones.
2. Sincronizar primero todos los partners reales y relaciones. Proponer correspondencias; el nombre en sistema por sí solo no determina cuál sucursal recibe cada ventana. En producción, el archivo entregado por el usuario se procesa contra IDs reales después de una vista previa de vínculos.
3. Aplicar automáticamente sólo asociaciones inequívocas que se hayan verificado. Las 66 filas sin nombre en sistema y los nombres compartidos pasan por una revisión de vínculos; la relación confirmada queda persistida para no repetir el trabajo.
4. Horarios ambiguos, «Recoge», «Por definir», ligas ausentes y texto en Liga Maps tienen estados explícitos. No inventar prioridad: el archivo no la proporciona.
5. Vista previa de cambios por cliente y columna. En primera aplicación llenar en la base de Ana Rutas las ventanas, notas y ligas aprobadas para ahorrar captura a los operadores. La aplicación se hace transaccionalmente, guarda lote/fila de procedencia y permite recuperación. Reimportar el mismo archivo es idempotente y nunca reemplaza ajustes posteriores sin elección explícita.
6. No crear clientes en Odoo ni consolidar duplicados como consecuencia de importar el Excel. Una sucursal física ausente en Odoo se reporta como vínculo pendiente; decidir su representación antes de vincular pedidos a ella.

## Conexión con pedidos, planificación y exportación

- La identidad de destinatario ya importada permite resolver el registro local por source + partnerId. Si falta, hidratar su perfil mediante lectura; no inventar otra identidad ni bloquear la importación sólo por no existir aún en el directorio.
- Ampliar el contrato actual para prioridad de tres estados y reglas semanales/múltiples ventanas, con versión de preferencias. Una migración aditiva debe preservar los snapshots, versiones, posiciones, asignaciones e identidad por plan existentes. Mapear high_priority=true a Alta; no inventar Media para false/null.
- Preparar la restricción efectiva para la fecha del plan, no para la fecha de validación Odoo. Mostrarla en tarjeta, detalle, mapa, datos del optimizador y exportación desde la misma resolución.
- Propuesta: cambios guardados se reflejan en preferencias de borradores, sin mover pedidos ni camionetas. Un plan ya calculado se marca como desactualizado si cambian restricciones; planes publicados/terminados conservan su versión hasta un flujo explícito de actualización. Publicación y optimizador siguen siendo bloques futuros.
- Archivar un cliente no elimina pedidos de planes existentes ni cancela su entrega. Un pedido validado de ese cliente puede seguir cargándose según el flujo de pedidos vigente, mostrando su estado archivado y sin reactivar el directorio. «Recoge» se identifica para no asignarlo automáticamente a reparto.
- «Exportar Excel» de clientes: exportar todos los resultados del filtro seleccionado, no sólo la página visible, indicando Activos/Archivados. Hojas Clientes y Ventanas; IDs estables, matriz/sucursal, ambos nombres, teléfonos como texto, notas, prioridad, dirección, liga, coordenadas y estado. Ventanas: una fila por regla/días, sin comprimir semántica en una cadena ambigua.
- «Exportar Excel» del planificador: sólo el plan seleccionado y una versión consistente. Incluir fecha, versión, camioneta, chofer, número de parada, cliente/sucursal, folios/surtidos, teléfono, ventana efectiva, prioridad, domicilio, liga y nota de entrega. Incluir Sin asignar. Hoja Partidas con producto, cantidad, unidad y nota del picker; no mezclarla con nota general de entrega.
- Exportación no recalcula ni modifica el plan. Sin ruta optimizada, exportar asignación/orden actuales sin inventar distancia o ETA. No sumar kg, piezas y otras unidades incompatibles. Datos como =, +, - o @ se exportan como texto cuando corresponda; no permitir inyección de fórmulas ni enlaces ejecutables.

## Diseño técnico propuesto, aún no implementado

Nombres siguientes son propuestas, no tablas/endpoints existentes:

- Directorio: route_customers con clave única (source, odoo_partner_id), relaciones fuente, snapshot Odoo separado, configuración local, archived_at y version.
- Reglas: route_customer_windows relacionadas al cliente, días/horas/tipo explícitos y validación transaccional.
- Ubicaciones: versión/historial de punto, procedencia y actor. Importaciones: lote/fila/vínculo/resultado. Sync: progreso durable con cursor, techo y fallos recuperables.
- Servicios de dominio cerrados: listar/buscar clientes, sincronizar, guardar preferencias, archivar/restaurar, importar directorio y exportar. No exponer ejecutor RPC genérico, dominios Odoo ni credenciales al navegador.
- API propuesta: GET /api/customers; POST /api/customers/sync; PATCH /api/customers/[id]; POST de archivo/restauración; endpoints de exportación de clientes y del plan. Precisar contratos, límites por lote y estados de trabajo en el bloque de especificación antes de implementar.
- Separar apertura de sesión Odoo básica y negociación de capacidades de partners de la negociación de stock.move/sale.order.line. Reutilizar autenticación, verificación de empresa y seguridad; preservar la lectura de pedidos existente.
- Paginación estable por ID, trabajo acotado por petición y continuación durable hasta completar todos los contactos. Nunca truncar el total al tamaño de una página. Reintentos no duplican, trabajo fallido conserva progreso y no anuncia éxito total.
- Si cambia origen/base/compañía: respetar la protección de instalación actual; no reutilizar IDs ni vincular configuración entre develop y producción.
- Escrituras: sesión activa, Origin, permisos, SQL parametrizado, lista de campos editables y control de versión. Lecturas/exportaciones privadas sin caché pública. Auditoría sin secretos ni volcados de clientes.
- Resolver ligas con destinos permitidos, validando cada redirección/DNS y bloqueando redes privadas; nunca convertir la celda de Maps en fetch arbitrario del servidor.

## Bloques y aceptación

1. Diseño: revisar boceto, confirmar ambigüedades de horarios y regla prioridad/ventana. Incorporar correcciones visuales antes del desarrollo.
2. Directorio y sincronización: esquema aditivo, capacidades Odoo 17/19.4, todos los partners autorizados, jerarquía, búsqueda, guardado, archivo/restauración y recuperación de sync.
3. Horarios y Excel inicial: reglas semanales, prioridades, correspondencias con sucursales, vista previa y persistencia de preferencias.
4. Pedidos y ubicaciones: contratos compartidos, resolución por fecha/sucursal, tarjetas/mapa, historial de puntos y preparación del optimizador/chofer.
5. Exportaciones y cierre: Excel de directorio y plan, QA integrada, evidencias y revisión antes de promoción.

Matriz de aceptación que deberá convertirse en Gherkin ejecutable/documentado:

| Escenario                                                           | Resultado exigido                                                                                              |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Partner customer_rank=0, sin ventas o teléfono                      | Se importa dentro del alcance permitido.                                                                       |
| Dos partners con nombre idéntico                                    | Dos registros por ID; ninguna fusión automática.                                                               |
| Varias páginas y fallo intermedio de sync                           | Continuación segura, sin duplicados ni éxito falso.                                                            |
| Alias/domicilio/horarios editados, incluso vaciados deliberadamente | Sync no los modifica.                                                                                          |
| Dos operadores guardan la misma versión                             | Uno guarda; el otro conserva edición y recibe conflicto.                                                       |
| Archivo, sync y restauración                                        | Misma identidad/configuración, sin reactivación automática.                                                    |
| Matriz archivada con sucursal activa                                | Sucursal sigue accesible y con configuración propia.                                                           |
| Campo mobile no existe                                              | No se solicita; cliente con phone se importa.                                                                  |
| Ambos teléfonos existen y difieren                                  | No se pierde ninguno.                                                                                          |
| Sábado/domingo, dos intervalos, cerrado y pendiente                 | Resolución correcta por día, sin horarios inventados.                                                          |
| Prioridad Alta con apertura posterior                               | Conflicto tratado según regla confirmada; no ETA inválida.                                                     |
| Dos filas Excel con razón social igual                              | No se asigna una ventana a la sucursal equivocada.                                                             |
| Dirección Odoo importada y posterior sync                           | Sirve de valor inicial; el sync no pisa una dirección/punto local confirmado.                                  |
| Cambio de dirección y pin anterior                                  | Geocodifica como propuesta y exige confirmar; no declara el punto anterior como actualizado.                   |
| Chofer corrige un punto de entrega pendiente                        | Actualiza ubicación/Maps del cliente, navegación y ETA automáticamente; conserva el orden de la ruta en curso. |
| Corrección de punto repetida o retrasada                            | Idempotencia y control de versión; una versión anterior no pisa la nueva; auditoría coherente.                 |
| Pedido presente en múltiples planes                                 | Mantiene identidad/asignación independiente e historial.                                                       |
| Exportación concurrente a edición                                   | Un snapshot/version consistente, nunca mezcla de estados.                                                      |
| Nombre con fórmula o liga maliciosa                                 | Exportación como texto y resolución segura; no ejecución.                                                      |
| Usuario sin sesión/activo, otra compañía u origen                   | Rechazo sin datos ni escritura.                                                                                |

Puertas: unidades de lógica afectada; integración PostgreSQL real; contrato read-only en Odoo 17 y develop 19.4; E2E de guardar/sync/archivo/restauración/búsqueda/exportar; regresión del planificador; cobertura medida (objetivo >=90% líneas del dominio nuevo y todas las rutas críticas); mutación sin supervivientes sin justificar en identidad, protección de overrides y fechas; análisis de dependencias y secretos. Reportar latencias p50/p95, errores y conteos con volumen/entorno medido; objetivo de búsqueda p95 <=300 ms de servidor a 10.000 contactos, sujeto a validación real, no resultado obtenido. No afirmar todas las puertas verdes con pruebas locales cuando falte contrato de una instalación.

## Confirmaciones pendientes

- Formato horario: resuelto en 24 horas, sin AM/PM. Las filas ambiguas del Excel siguen requiriendo elegir la hora inequívoca durante la vista previa; no se inferirán por texto.
- Prioridad vs ventana: confirmar que Alta y Media priorizan dentro de horarios factibles. Si se desea una política distinta, especificar el conflicto de recepción antes de activar optimización.
- Vínculos Excel/Odoo: confirmar coincidencias ambiguas tras la lectura real, no antes. El boceto no acredita asociaciones reales.

## Referencias

- Fuente del usuario: C:/Users/figod/Desktop/DIrectorio Clientes.xlsx, Hoja1 C2:G94.
- Odoo 17, código oficial res.partner: https://github.com/odoo/odoo/blob/17.0/odoo/addons/base/models/res_partner.py (phone y mobile, relaciones y tipos).
- Odoo SaaS 19.4, código oficial res.partner: https://github.com/odoo/odoo/blob/saas-19.4/odoo/addons/base/models/res_partner.py (phone en modelo base; capacidades a verificar en runtime).
- Contactos Odoo 19: https://www.odoo.com/documentation/19.0/applications/essentials/contacts.html
- Maps URLs: https://developers.google.com/maps/documentation/urls/get-started (liga universal por coordenadas; abrir URLs no requiere API key).
- Las páginas de External API 17/19.4 no se pudieron recuperar con el navegador en esta revisión; se contrastó el código fuente oficial. Recuperar referencia RPC y probar campos reales en el bloque de integración.
