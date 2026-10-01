Feature: Fuente Odoo vigente, cobro antes de cierre y recepción individual
  El chofer confirma cobro y entrega juntos.
  La cuenta de liquidación recibe cada cliente sin esperar a terminar la ruta.

  Scenario: CP01 el worker corrige un pedido validado sin volver a importarlo
    Given un pedido del borrador aún indica pendiente y cantidad 3
    And Odoo ya lo validó con cantidad 3.2
    When el worker obtiene la observación coherente de ese picking y orden
    Then el borrador muestra validado y cantidad 3.2 automáticamente
    And se actualizan versión, auditoría y evento del panel
    And la asignación, posición y ventana permanecen iguales

  Scenario: CP02 partidas añadidas, faltantes y canceladas
    Given Odoo cambió movimientos de un pedido sin iniciar
    When el worker actualiza el borrador por picking, orden y movimiento
    Then sólo aparecen movimientos actuales con cantidad positiva
    And las notas se conservan únicamente para el mismo movimiento y producto
    And un picking cancelado no puede publicarse

  Scenario: CP03 una publicación iniciada mantiene su operación
    Given una camioneta inició su publicación y otra sigue en borrador
    When Odoo modifica las cantidades y el worker sincroniza
    Then sólo la camioneta sin iniciar actualiza sus partidas operativas
    And las publicaciones y la ejecución iniciada permanecen intactas
    And una publicación pendiente con datos anteriores no puede iniciarse

  Scenario: CP04 errores y observaciones repetidas
    Given una observación ya fue guardada íntegramente
    When se repite o falla una sincronización posterior
    Then no se altera la versión por un resultado idéntico
    And un fallo conserva la última información válida
    And el worker recupera automáticamente según su intervalo y backoff

  Scenario: CP05 el cobro incluye devoluciones antes del cierre
    Given un pedido atendible tiene importe original 2502.44 MXN
    And sus devoluciones y faltantes descuentan 119.06 MXN
    When el chofer pulsa Confirmar atención con incidencias
    Then se abre Monto a recibir por 2383.38 MXN sin cerrar el pedido
    When elige Efectivo y acepta el modal Recibe 2383.38 MXN
    Then entrega y recibo se guardan en una única transacción
    And el detalle conserva productos, precios, descuentos e incidencias

  Scenario: CP06 cancelar o perder la base vigente no cierra
    Given el chofer abrió el cobro de un pedido pendiente
    When cancela la pantalla o el modal
    Then no existe un recibo ni una entrega nueva
    When intenta confirmar con importe, visita o revisión desactualizada
    Then se rechaza la operación sin cambios parciales

  Scenario: CP07 respuesta perdida y doble confirmación
    Given el mismo comando de cobro se transmitió dos veces
    When el servidor confirma o recupera su respuesta
    Then sólo existe un recibo y un evento de entrega
    And un cambio en el contenido de ese comando se rechaza
    And un fallo al insertar el recibo revierte también la entrega

  Scenario Outline: CP08 el medio conserva importes y componentes exactos
    Given el monto oficial es 2383.38 MXN
    When el chofer confirma <medio> con efectivo <efectivo> y transferencia <transferencia>
    Then se registra recibido <recibido> y deuda <deuda>
    And los componentes de efectivo y transferencia se suman por separado
    Examples:
      | medio                   | efectivo | transferencia | recibido | deuda   |
      | Efectivo                | 2383.38  | 0             | 2383.38  | 0       |
      | Transferencia           | 0        | 2383.38       | 2383.38  | 0       |
      | Crédito                 | 0        | 0             | 0        | 2383.38 |
      | Efectivo + transferencia| 1000     | 1383.38       | 2383.38  | 0       |

  Scenario: CP09 y CP10 solicitud individual durante recorrido activo
    Given el chofer cerró y cobró un pedido y la ruta sigue activa
    Then la cuenta de liquidación ve la tarjeta del cliente y folio con importe verde
    And Aceptar está desactivado hasta la solicitud del chofer
    When el chofer acepta el modal Liquidar de ese pedido
    Then Aceptar se habilita automáticamente sólo para ese importe
    And cancelar el modal de recepción mantiene la solicitud pendiente

  Scenario: CP11 recepción exclusiva, exacta y sin duplicados
    Given el chofer solicitó liquidar un cliente
    When la cuenta de liquidación acepta su cliente, folio, medio e importe
    Then se registra una única recepción con decisión versionada
    And una cuenta de rutas u otro chofer no pueden aceptarla
    And una recepción concurrente no puede duplicar ni cambiar el importe

  Scenario: CP12 historia y recepción por ruta completa
    Given existen recibos antiguos y nuevas recepciones individuales
    When se consulta el historial o se repite una migración
    Then se conservan recibos y componentes originales
    And la fecha de recepción corresponde al día local de aceptación
    And liquidar toda la ruta exige término operativo y todos los cobros
    And un recibo aceptado no se solicita ni se cuenta otra vez

  Scenario: CP13 entrega anterior sin cobro no habilita bodega
    Given la versión anterior cerró una entrega con fuente financiera y sin recibo
    When el chofer abre ese pedido
    Then puede registrar el cobro pendiente
    And regreso a bodega y cierre permanecen bloqueados hasta guardarlo

  Scenario: CP14 detalle móvil y reconexión
    Given el pedido cobrado aparece en Liquidación de rutas con nombre y fecha
    When el chofer abre su cliente
    Then ve precios, devoluciones, total, notas y fotos del recibo confirmado
    And Liquidar es amarillo y exige Aceptar o Cancelar
    And las tarjetas de los cuatro medios conservan etiquetas y emojis con letra grande
    And un envío pendiente se recupera sin crear otro comando
