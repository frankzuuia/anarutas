# language: es
Característica: Liquidación legible y limitada a pedidos finalizados
  Escenario: LC01 Validación automática sin camioneta asignada
    Dado un pedido importado en Pedidos sin asignar y el tablero abierto
    Cuando Odoo devuelve la entrega validada con las cantidades finales
    Entonces el worker actualiza el pedido y su versión
    Y el evento actualiza el tablero sin recargar ni mover el pedido
    Y se conserva la asignación vacía

  Escenario: LC04 Precios y cantidades precisos
    Dado un recibo por 1086.500000 MXN y una devolución de 4.000000 unidades
    Cuando se consulta en el panel o en la aplicación
    Entonces se muestra $1,086.50 MXN y 4 unidades
    Y los precios unitarios fraccionarios conservan su precisión
    Y un importe desconocido no se presenta como cero

  Escenario: LC05 Incidencias explican el total confirmado
    Dado un cobro confirmado con devoluciones, reposiciones e impuestos
    Cuando se abre el pedido en liquidación
    Entonces cada incidencia indica su producto, cantidad y descuento exacto
    Y el pedido completo aparece antes del total original, devoluciones, total final y cobro
    Y debajo del desglose las incidencias se muestran en texto amarillo sin recuadros rellenos
    Y las incidencias canceladas no descuentan dinero
    Y las reposiciones diferidas se distinguen del descuento
    Y el redondeo del pedido se explica por separado
    Y una modificación posterior de Odoo no reescribe el recibo

  Escenario: La cantidad del resumen corresponde al pedido final
    Dado un pedido de 5 unidades de alfalfa con devolución confirmada de 4
    Cuando se abre el modal del pedido en liquidación web
    Entonces Cantidad final muestra 1 unidad de alfalfa
    Y el importe original conserva el valor de las 5 unidades
    Y el importe final conserva el cobro confirmado de la unidad restante
    Y el detalle amarillo conserva las 4 unidades devueltas y su descuento

  Escenario: LC08 Cincuenta pedidos y detalle independiente
    Dado un recorrido con 50 pedidos cobrados
    Cuando el liquidador busca un cliente o filtra por estado
    Entonces la lista presenta hasta 12 tarjetas por página
    Y puede abrir un pedido en un modal con desplazamiento propio
    Y cerrar con Escape devuelve el foco al botón que lo abrió
    Y consultar no crea solicitudes ni modifica dinero

  Escenario: LC10 Solicitud y recepción conservan sus permisos
    Dado un pedido cobrado que el chofer aún no ha liquidado
    Entonces Aceptar permanece deshabilitado
    Cuando el chofer confirma Liquidar
    Entonces la cuenta de liquidación puede aceptar mediante confirmación
    Y una cancelación no modifica la solicitud
    Y un reintento no duplica el cobro ni la recepción
    Y la cuenta de rutas no puede recibir dinero

  Esquema del escenario: LC12 Visibilidad de pedidos en liquidación del chofer
    Dado un pedido con estado <estado> y cobro <cobro>
    Cuando el chofer abre Liquidación de rutas
    Entonces el pedido <visibilidad>
    Ejemplos:
      | estado       | cobro        | visibilidad |
      | abierto      | sin registrar| no aparece  |
      | entregado    | sin registrar| no aparece  |
      | entregado    | confirmado   | aparece     |
      | reprogramado | sin registrar| no aparece  |

  Escenario: Recuperación de un cobro interrumpido
    Dado que la aplicación pierde la respuesta de un cobro enviado
    Cuando vuelve la conexión
    Entonces recupera el mismo comando pendiente sin duplicarlo
    Y el pedido aparece en liquidación cuando se confirma entrega y cobro
    Y el formulario operativo puede consultar el pedido antes de cerrarlo
