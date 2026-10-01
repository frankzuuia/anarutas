# language: es
Característica: Prueba temporal de liquidación sin bodega
  Escenario: TB01 Pedidos completos sin regreso
    Dado el modo temporal habilitado por el propietario en el servidor
    Y todos los pedidos entregados y cobrados
    Cuando el chofer pulsa Liquidar toda la ruta debajo de las tarjetas
    Entonces revisa y confirma el paquete completo sin requerir bodega
    Y no se crea una llegada GPS ni un cierre operativo

  Esquema del escenario: TB02 TB03 Un pedido no permite liquidación completa
    Dado el modo de prueba y un pedido <estado>
    Cuando solicita o intenta finalizar toda la ruta
    Entonces el servidor y PostgreSQL bloquean la acción
    Ejemplos:
      | estado |
      | pendiente |
      | en atención |
      | reprogramado |
      | entregado sin cobro |

  Escenario: TB04 TB05 Recepción y cierre único
    Dado un paquete enviado sin bodega pendiente del liquidador
    Cuando cancela la recepción
    Entonces no se habilita Finalizar trabajo
    Cuando el liquidador acepta todos los recibos
    Entonces el chofer puede finalizar y consultar Buen trabajo con datos reales
    Y reintentos simultáneos producen un solo cierre

  Escenario: TB06 TB07 Restauración autoritativa
    Dado la configuración restaurada para exigir bodega
    Cuando el cliente solicita liquidar enviando una bandera para omitir bodega
    Entonces el servidor ignora esa bandera y rechaza la operación
    Y PostgreSQL rechaza una inserción directa equivalente

  Escenario: TB08 TB09 Política e historial persistidos
    Dado una recepción o cierre de prueba confirmado
    Cuando restaura la política y repite la migración
    Entonces conserva la configuración restaurada y todos los recibos
    Y un reintento idéntico recupera su confirmación original
    Y el fingerprint notifica la nueva política a la app

  Escenario: TB10 Acción visible al final
    Dado el detalle financiero del chofer con pedidos cobrados
    Cuando llega al final de las tarjetas en modo de prueba
    Entonces ve Liquidar toda la ruta y la indicación de modo de prueba
    Y conserva los botones de confirmación y cancelación accesibles
