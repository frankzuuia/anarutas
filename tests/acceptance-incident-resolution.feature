Feature: Resolución visible y regreso al pedido del chofer
  Scenario: Resolver una reposición desde un cuadro completo
    Given un administrador autorizado y una reposición pendiente
    When explica cómo se resolvió en escritorio o pantalla de 390 píxeles
    Then texto, campo y botones quedan dentro del marco con margen
    And la sección Resueltas con título verde conserva chofer, tipo y explicación
    And la incidencia sale de las pendientes sin alterar cobro, Excel ni Odoo

  Scenario: Historial resuelto con lectura compartida
    Given cincuenta y dos reposiciones resueltas con evidencia privada
    When el administrador consulta sus dos páginas o filtra fecha y chofer
    Then no se pierden ni duplican filas
    And los cursores de otros filtros o apartados se rechazan
    And Visto conserva para todos el primer administrador que lo marcó
    And usuarios sin permiso no leen la consulta ni las fotografías
    And un reporte retirado desaparece de Resueltas

  Scenario: Separar resolución administrativa de entrega
    Given un pedido rechazado resuelto por administración
    Then aparece en Resueltas y conserva su Visto compartido
    And una entrega registrada no se etiqueta como resolución administrativa
    And consultar o resolver no crea nuevas notificaciones de alarma

  Scenario Outline: Regreso al pedido después del comprobante
    Given el chofer tiene abierto el formulario de <operacion>
    When llega un comprobante válido del mismo pedido y parada
    And la lectura de ejecución termina verificada y sin envío pendiente
    Then el formulario se cierra hacia la ficha del pedido anterior
    And una revisión antigua no cierra un formulario que acaba de abrirse
    Examples:
      | operacion |
      | alta |
      | edición |
      | cancelación |

  Scenario: Preservar captura ante resultado incierto
    Given un envío pendiente, lectura fallida o comprobante de otro pedido
    When el servidor responde o el teléfono rota
    Then el formulario no anuncia éxito ni navega por un recibo ajeno
    And el reintento conserva comando, evidencia y protección de duplicados

  Scenario Outline: Usar cantidad disponible antes del pago
    Given una partida con cantidad disponible exacta 1.25
    When el chofer elige <tipo>
    Then Usar toda la cantidad disponible está debajo de cantidad afectada
    And está antes de Pago de la reposición cuando corresponde
    And pulsarlo coloca 1.25 sin cambiar unidad ni cálculo de disponible
    And un formulario no editable o disponible cero no permite el botón
    Examples:
      | tipo |
      | Reposición por calidad |
      | Reposición por producto erróneo |
      | Devolución |
