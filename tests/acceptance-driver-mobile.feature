Feature: Acceso móvil del chofer a su propia ruta
  Scenario: El administrador autoriza un celular sin exponer el PIN
    Given un chofer activo con teléfono válido y un administrador autenticado
    When el administrador establece un PIN y genera una activación de un solo uso
    Then sólo el hash del PIN y del código quedan persistidos
    And el código aparece una vez y no figura en listados ni auditoría

  Scenario: Sólo el dispositivo autorizado inicia sesión
    Given un celular activado y una clave privada que no salió de Android
    When el chofer presenta teléfono, PIN y firma un desafío vigente
    Then recibe una sesión móvil revocable y ve su camioneta y pedidos
    But no ve los pedidos de otro chofer aunque conozca el ID del plan

  Scenario: Activación o firma repetidas
    Given un código o desafío ya consumido
    When se vuelve a presentar o dos solicitudes compiten por usarlo
    Then a lo sumo una solicitud puede autorizar acceso

  Scenario: Cambio de PIN o teléfono
    Given un chofer con sesión móvil vigente
    When el administrador cambia el PIN o el teléfono de la ficha
    Then la sesión anterior deja de autorizar
    And el celular debe activarse nuevamente

  Scenario: Ruta sin cálculo vigente
    Given un plan con pedidos asignados pero sin cálculo vial vigente
    When el chofer consulta su ruta
    Then ve sólo sus pedidos y un estado explícito de cálculo ausente u obsoleto
    But no se dibuja una ruta vieja como si estuviera vigente
