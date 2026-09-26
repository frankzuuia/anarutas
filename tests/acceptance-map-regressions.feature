Feature: Reloj GPS y mapa fiel a las asignaciones actuales
  Scenario: Lectura GPS precisa entre dos pulsos de pantalla
    Given el último pulso ocurrió en 100000 ms y la lectura GPS en 100350 ms
    When la pantalla evalúa Llegué o Confirmar punto a los 100360 ms
    Then usa el reloj actual y mantiene la acción habilitada dentro del radio
    And el modal de domicilio utiliza la misma evaluación

  Scenario: Sin callbacks nuevos la muestra caduca
    Given una lectura válida cuya edad máxima viene del servidor
    When un pulso ocurre después de esa vigencia
    Then la acción se bloquea sin ampliar radio ni vigencia
    And muestras realmente futuras, simuladas o fuera de radio permanecen bloqueadas

  Scenario: Se quita el último pedido de una camioneta
    When el pedido vuelve a Sin asignar
    Then Todas las camionetas no muestra ese punto ni el recorrido anterior
    And el pedido sigue disponible al seleccionar Sin asignar
    And no se muestra Recorrido vigente con cero paradas

  Scenario: La asignación cambia con el mapa abierto
    When el pedido pasa a otra camioneta y llega la actualización del tablero
    Then sólo aparece en la camioneta nueva
    And un cálculo de otra versión o secuencia no dibuja líneas antiguas
    And no se borra el pedido ni se publica una ruta
