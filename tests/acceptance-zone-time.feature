Característica: Reparto automático por zonas, horarios y descarga real
  Escenario: Zona saturada con otra camioneta elegible
    Dado un plan con puntos confirmados, horarios y descarga configurada por cliente
    Cuando Google arma la ruta en una única solicitud Fleet
    Entonces puede reasignar visitas entre zonas para mejorar llegadas y duración
    Y conserva todos los pedidos, grupos, prioridades y tiempos de servicio

  Esquema del escenario: Flota dinámica sin cantidad fija
    Dado un plan con <cantidad> camionetas incluidas
    Cuando se construye el modelo de armado
    Entonces cada visita puede ser atendida por cualquiera de esas camionetas
    Y las preferencias geográficas son finitas y calculadas de sus puntos
    Ejemplos:
      | cantidad |
      | 1        |
      | 4        |
      | 5        |
      | 6        |
      | 12       |

  Escenario: Conflicto de horario restante
    Dado un recorrido vigente que prevé una llegada después del cierre
    Cuando el administrador abre el mapa y filtra la camioneta
    Entonces ve el pedido, cliente, ventana, ETA y minutos de atraso previstos
    Y no se registra una incidencia ni se descarta el pedido

  Escenario: Snapshot obsoleto y recuperación del proveedor
    Dado que se editó una asignación o cambió la versión del plan
    Cuando el mapa recibe lecturas de versiones diferentes
    Entonces no presenta consejos de horario del recorrido anterior
    Y al recuperarse actualiza el aviso usando el recorrido vigente
    Y si Fleet falla conserva la recuperación geográfica medida con Routes con aviso explícito

  Escenario: Seguridad y funcionamiento conservados
    Dado un actor sin permiso, un cálculo concurrente o una ruta iniciada
    Cuando intenta recalcular automáticamente
    Entonces se conservan las guardas existentes de permiso, revisión y ejecución
    Y no se alteran publicación, orden manual, liquidación ni cadencia Odoo
