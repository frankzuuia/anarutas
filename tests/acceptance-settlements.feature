Feature: Cobro y liquidación histórica por rol
  Scenario: Captura neta sin cambio y selección accesible
    Given el formulario de cobro con tarjetas Efectivo Transferencia y Crédito
    When selecciona Efectivo y escribe 15.25 para un pedido de 20
    Then no existe el campo Cambio entregado
    And el comando conserva recibido 15.25 cambio 0 y saldo 4.75
    And sólo una tarjeta está seleccionada y no cambia durante un envío pendiente

  Scenario: Transferencia vacía no inventa un pago
    Given un pedido entregado con importe vigente
    When el chofer selecciona Transferencia y deja Monto transferido vacío
    Then no puede confirmar ni convertir el vacío en cero
    And una transferencia válida se registra separada del efectivo

  Scenario: Crédito después de otro medio
    Given un importe escrito previamente en Efectivo o Transferencia
    When selecciona Crédito
    Then no se muestra un campo de importe recibido
    And la confirmación conserva recibido cero y saldo completo

  Scenario: Efectivo parcial conserva saldo sin interpretar notas
    Given un pedido entregado con importe vigente de 20
    When su chofer confirma efectivo recibido de 15
    Then el recibo inmutable guarda efectivo 15 y saldo 5
    And el liquidador sólo debe recibir 15 en efectivo

  Scenario: Pago perdido durante la respuesta
    Given un comando cifrado persistido en el dispositivo
    When el servidor confirma el cobro pero se pierde su respuesta
    And la app reenvía el mismo identificador y contenido
    Then devuelve el recibo existente sin duplicar el dinero

  Scenario: Roles separados
    Given un usuario activo con rol liquidador
    When abre el panel
    Then entra a Liquidación de rutas
    And cada API operativa rechaza su acceso
    And un administrador de rutas no puede aceptar liquidaciones

  Scenario: Liquidar un pedido y después toda la ruta
    Given una ruta terminada con efectivo transferencia y crédito confirmados
    And un pedido ya aceptado por liquidación
    When el chofer solicita liquidar toda la ruta
    Then sólo reserva los cobros aún pendientes
    And los créditos y transferencias no se suman al efectivo

  Scenario: Aceptar y rechazar simultáneamente
    Given una solicitud pendiente con importes inmutables
    When dos liquidadores envían decisiones opuestas
    Then sólo una decisión se confirma
    And la otra recibe conflicto de versión

  Scenario: Rechazo y nueva solicitud
    Given una solicitud pendiente reservando cobros
    When el liquidador rechaza
    Then se conserva su actor fecha y nota
    And se libera la reserva para una nueva solicitud identificable

  Scenario: Cambio posterior al cobro
    Given un recibo confirmado con sus productos e incidencias
    When Odoo cambia los importes o se modifica una incidencia
    Then el cobro y su evidencia original permanecen iguales
    And el detalle advierte que la fuente cambió

  Scenario: Recuperación de historial y datos previos
    Given una ejecución terminada y una ruta archivada
    When el chofer original o un liquidador autorizado consulta
    Then conserva los recibos solicitudes y decisiones históricas
    And no inventa cobros para entregas antiguas

  Scenario: Recepción en un día distinto al recorrido
    Given una ruta terminada hace seis días
    And sus cobros aceptados hoy por liquidación
    When filtra por fecha de recepción de hoy
    Then aparece el dinero recibido hoy con su fecha de ruta original
    And no se suman recepciones de otros días ni solicitudes pendientes

  Scenario: Evidencia privada del recibo
    Given un cobro con una incidencia y fotografía real
    When otro chofer intenta consultar la foto por su identificador
    Then el servidor rechaza sin devolver la imagen
    And el propietario conserva acceso autorizado al original

  Scenario: Respuesta atrasada de otra pantalla
    Given una consulta financiera en vuelo
    When cambia la ruta la página o la cuenta del dispositivo
    Then la respuesta anterior no sustituye el detalle actual

  Scenario: Migración de una instalación con recorridos iniciados
    Given el esquema 35 con cuentas y ejecuciones existentes
    When el arranque aplica las migraciones 36 a 38 y vuelve a ejecutarse
    Then conserva los datos y asigna routes a las cuentas anteriores
    And no duplica cobros ni cambia el rol de una cuenta existente
