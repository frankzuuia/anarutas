# language: es
Característica: Continuación confirmada sin alterar cobros ni entregas
  Escenario: Saltar una parada atendida fuera de orden
    Dado que la parada 3 ya está entregada y cobrada
    Y las paradas 2 y 4 están pendientes
    Cuando el chofer confirma el cierre completo de la parada 2
    Entonces se ofrece la parada 4 con un botón Ir
    Y no se inicia la guía hasta que el chofer pulse Ir

  Escenario: Elegir manualmente los reintentos al terminar el recorrido normal
    Dado que no quedan paradas normales por atender
    Y existen pedidos con estado pendiente de reintento
    Cuando se confirma la última atención del recorrido normal
    Entonces aparece el aviso Tienes reintentos que realizar
    Y Elegir reintento abre los pendientes vigentes del menú existente
    Y no se elige automáticamente la parada 1 ni se ofrece Ir a bodega

  Escenario: Recuperar el aviso después de un fallo de refresco
    Dado que el servidor confirmó un pago con su recibo real
    Cuando falla la lectura financiera u operativa posterior
    Y luego se recupera una lectura coherente de la misma ejecución
    Entonces aparece una sola continuación si todos los pedidos están completos
    Y no se repite el comando de cobro

  Escenario: Recibo ajeno o ruta retirada
    Dado que un aviso pertenece a otra ejecución o la ruta fue retirada
    Cuando la app actualiza el estado
    Entonces no ofrece navegación a partir de ese aviso

  Escenario: Parada con varios pedidos y regreso a bodega
    Dado que una parada contiene varios pedidos
    Cuando sólo se entrega y cobra uno
    Entonces no se ofrece avanzar por cierre completo de esa parada
    Cuando todos los pedidos de la ruta quedan entregados o reprogramados
    Y no existe cobro ni reintento pendiente
    Entonces se conserva la oferta explícita Ir a bodega según la política vigente
