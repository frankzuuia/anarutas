Feature: Menú de administración lateral en celular
  Scenario: Entrar y abrir navegación
    Given una cuenta de rutas o liquidación autenticada en celular
    Then el menú comienza cerrado y el contenido comienza debajo de la barra superior
    When pulsa Abrir menú
    Then aparece a la izquierda una lista vertical con las mismas opciones y permisos
    And el contenido permanece en la misma posición

  Scenario Outline: Cierre accesible
    Given el menú lateral está abierto
    When lo cierra mediante <acción>
    Then el foco vuelve al botón Abrir menú y el scroll del contenido se restaura
    Examples:
      | acción |
      | X |
      | Escape |
      | un toque fuera |
      | una opción permitida |

  Scenario: Gestos internos y foco
    Given el menú está abierto
    When toca dentro o arrastra desde dentro hacia fuera
    Then el menú sigue abierto
    And Tab y ShiftTab no permiten actuar sobre el fondo

  Scenario: Giro de pantalla y escritorio
    Given un menú abierto en celular
    When el viewport cambia a escritorio
    Then el menú modal se cierra y libera el contenido
    And conserva sección, datos y el estado anterior del menú de escritorio

  Scenario: Estado y actualizaciones
    Given consulta liquidación con un chofer seleccionado
    When abre el menú y llega una actualización real
    Then el menú conserva su identidad y foco
    And al cerrar conserva el filtro y los totales

  Scenario: Pantallas cortas y embebidas
    Given una pantalla estrecha, corta o con letra ampliada
    Then las opciones se desplazan verticalmente dentro del cajón y X queda accesible
    And no existe scroll lateral ni un menú adicional en dashboards embebidos
