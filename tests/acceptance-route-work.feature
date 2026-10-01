# language: es
Característica: Liquidación de toda la ruta y cierre de trabajo recibido
  Escenario: LR01 Cantidad final después de devolver tres ADES
    Dado un recibo de cuatro ADES con devolución confirmada de tres
    Cuando el chofer abre su ticket de liquidación
    Entonces la cantidad final es una unidad
    Y conserva el importe original y la devolución de tres con su descuento

  Escenario: LR02 Liquidar desde bodega
    Dado el regreso a bodega comprobado y Terminar ruta confirmado
    Y todos los pedidos entregados tienen recibo
    Cuando abre Liquidación de rutas
    Entonces Liquidar toda la ruta aparece al final de la pantalla
    Y revisa los pedidos y los importes separados por moneda y medio

  Escenario: LR03a Ruta aún en recorrido
    Dado una ejecución que no ha terminado en bodega
    Cuando intenta solicitar liquidación completa o finalizar trabajo
    Entonces el servidor rechaza ambas acciones sin reservar ni cerrar cobros

  Escenario: LR03b Entrega histórica sin cobro
    Dado una ejecución terminada con un pedido entregado sin recibo
    Cuando intenta liquidar toda la ruta o finalizar trabajo
    Entonces se requiere recuperar el cobro faltante y no se inventa un importe

  Escenario: LR04 Cobro individual ya recibido
    Dado una ruta con tres recibos y uno ya recibido por liquidación
    Cuando revisa y confirma la liquidación completa
    Entonces el paquete contiene sólo los otros dos recibos
    Y el cierre de trabajo contabiliza los tres pedidos sin duplicar recepción

  Escenario: LR05 Solicitud individual aún pendiente
    Dado una solicitud individual en revisión que reserva un cobro de la ruta
    Cuando intenta enviar la liquidación completa
    Entonces se bloquea el solapamiento y se conserva la solicitud original

  Escenario: LR08 Cambio entre revisión y envío
    Dado el paquete revisado por el chofer
    Cuando el liquidador acepta un cobro antes del envío del paquete
    Entonces el servidor rechaza la versión antigua y devuelve el estado vigente

  Escenario: LR06a Cancelar antes de confirmar
    Dado el modal de liquidación completa con pedidos e importes
    Cuando el chofer cancela
    Entonces no se registra una solicitud ni se mueve dinero

  Escenario: LR13a Consultar los tickets desde el paquete
    Dado una solicitud completa pendiente en el panel del liquidador
    Cuando abre la tarjeta y selecciona un cliente
    Entonces abre el ticket individual con cantidades finales e incidencias amarillas
    Y cerrar el ticket vuelve al paquete conservando sus pedidos

  Escenario: LR06b Cancelar recepción
    Dado el paquete pendiente y el modal de confirmar recepción
    Cuando el liquidador pulsa Cancelar
    Entonces la solicitud sigue pendiente y no se habilita Finalizar trabajo

  Escenario: LR10 Rechazo y nueva solicitud
    Dado una liquidación completa pendiente
    Cuando el liquidador la rechaza con su nota
    Entonces se conserva el rechazo y se liberan los recibos
    Y el chofer puede enviar un paquete nuevo con otro identificador

  Escenario: LR02b Recibir toda la liquidación
    Dado el liquidador autorizado revisando la versión vigente del paquete
    Cuando acepta los importes
    Entonces todos los recibos del paquete quedan recibidos en una transacción
    Y transferencias y crédito conservan su clasificación sin convertirse en efectivo
    Y Finalizar trabajo se habilita automáticamente para el chofer

  Escenario: LR16 Finalizar trabajo aún pendiente de recepción
    Dado cualquier recibo sin aceptación del liquidador
    Cuando se envía directamente el comando Finalizar trabajo
    Entonces el servidor y la base de datos rechazan el cierre

  Escenario: LR17 Buen trabajo con resumen real
    Dado todos los recibos aceptados y la ruta terminada
    Cuando el chofer confirma Finalizar trabajo
    Entonces guarda un cierre único e inmutable
    Y Buen trabajo muestra pedidos entregados e incidencias activas del recibo
    Y muestra el valor neto total de la ruta incluyendo crédito y recepciones individuales

  Escenario: LR19a Respuesta perdida y reintento simultáneo
    Dado el mismo identificador y contenido del comando de cierre
    Cuando dos reintentos llegan simultáneamente
    Entonces existe un solo cierre y una sola auditoría
    Y el reintento devuelve el mismo resumen con duplicate verdadero

  Escenario: LR18 Recepción completa por pedidos
    Dado todos los cobros recibidos individualmente
    Cuando el chofer abre la ruta terminada
    Entonces puede finalizar sin enviar un paquete vacío ni duplicar dinero
    Y el panel muestra los tickets recibidos de la ruta

  Escenario: LR19b Comando reutilizado con otro contenido
    Dado un cierre ya confirmado
    Cuando reenvía su identificador con un resumen diferente
    Entonces recibe conflicto y el resumen original permanece intacto

  Escenario: LR11 Aislamiento del chofer
    Dado una ejecución asignada a otro chofer
    Cuando intenta consultar o cerrar ese trabajo
    Entonces recibe rechazo sin acceder a sus datos
    Y cerrar su propia ruta no cambia los eventos financieros del otro chofer

  Escenario: LR23 Cambios y borrado de cierre
    Dado un cierre guardado con sus recibos
    Cuando se intenta actualizar o borrar su registro
    Entonces la base de datos rechaza la operación

  Escenario: LR14 Monedas y precisión
    Dado recibos con distintas monedas y cantidades decimales exactas
    Cuando se construye el resumen de trabajo
    Entonces calcula cada moneda por separado sin pérdida de precisión

  Escenario: LR15 Migración repetida
    Dado una instalación del esquema treinta y nueve con historia financiera
    Cuando aplica el esquema cuarenta y vuelve a ejecutar la migración
    Entonces conserva cobros recepciones y cierres sin duplicarlos

  Escenario: LR07b Historial compatible
    Dado una APK anterior con comandos pendientes de liquidación
    Cuando reintenta su contrato sin el campo nuevo de revisión
    Entonces conserva la idempotencia original y los permisos del servidor

  Escenario: LR07a Respuesta de solicitud agrupada perdida
    Dado el mismo comando de liquidación persistido en el dispositivo
    Cuando el servidor guarda el paquete y la app pierde la respuesta
    Entonces reintentar devuelve el mismo paquete sin reservar de nuevo

  Escenario: LR09 Dos decisiones simultáneas
    Dado dos liquidadores con la misma revisión del paquete pendiente
    Cuando uno acepta y otro rechaza simultáneamente
    Entonces se confirma sólo una decisión y la otra recibe conflicto

  Escenario: LR12 Fuente posterior al cobro
    Dado un recibo con productos importes e incidencias confirmados
    Cuando cambia la fuente Odoo o una incidencia posterior
    Entonces el ticket del paquete conserva el recibo original y advierte el cambio

  Escenario: LR13b Paquete de cincuenta pedidos
    Dado cincuenta pedidos cobrados y una solicitud completa en revisión
    Cuando el liquidador abre el paquete y su último ticket
    Entonces el scroll pertenece al modal y el pie sigue dentro de la pantalla
    Y cerrar el ticket conserva los cincuenta pedidos del paquete
    Y una aceptación recibe los cincuenta cobros en una sola transacción

  Escenario: LR20 Resumen de fuentes congeladas
    Dado las incidencias y cantidades congeladas al confirmar los cobros
    Cuando posteriormente cambia una incidencia operativa
    Entonces el resumen de trabajo conserva los recibos sin revaluar el dinero

  Escenario: LR21 Incidencias canceladas y fotografías
    Dado una incidencia activa con varias fotografías y otra cancelada al cobrar
    Cuando calcula el resumen de trabajo
    Entonces cuenta la incidencia activa una sola vez y omite la cancelada

  Escenario: LR22 Valor de ruta con recepción anterior
    Dado tres pedidos cobrados y uno ya recibido en una solicitud individual
    Cuando acepta los dos restantes y finaliza el trabajo
    Entonces el valor neto de ruta incluye los tres una sola vez

  Escenario: LR24 Consulta posterior al cierre
    Dado un trabajo finalizado con su resumen persistido
    Cuando el mismo chofer vuelve a la ruta desde un dispositivo autorizado
    Entonces puede consultar el mismo resumen sin volver a cerrar o cobrar
