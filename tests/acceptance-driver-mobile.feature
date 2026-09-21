Feature: Acceso móvil del chofer a su propia ruta
  Scenario: El administrador habilita acceso sin exponer el PIN
    Given un chofer activo con teléfono válido y un administrador autenticado
    When el administrador establece un PIN de cuatro dígitos
    Then sólo el hash protegido del PIN queda persistido
    And el chofer puede entrar con su teléfono normalizado y el PIN

  Scenario: El primer acceso vincula automáticamente el celular
    Given un chofer habilitado y un celular sin registro previo
    When el chofer presenta teléfono, PIN y la clave pública creada por Android Keystore
    Then el servidor registra el celular y entrega una sesión móvil revocable
    And la clave privada nunca sale de Android

  Scenario: Sólo el chofer identificado ve su ruta
    Given un celular registrado y una clave privada que no salió de Android
    When el chofer presenta teléfono, PIN y firma un desafío vigente
    Then recibe una sesión móvil revocable y ve su camioneta y pedidos
    But no ve los pedidos de otro chofer aunque conozca el ID del plan

  Scenario: Primer acceso repetido o concurrente
    Given el mismo celular y la misma clave pública
    When dos solicitudes válidas intentan vincularlo al mismo tiempo
    Then ambas reconocen el mismo dispositivo sin crear duplicados

  Scenario: Respuesta de primer acceso perdida por la red
    Given el servidor ya registró la clave pública del celular
    When la respuesta se pierde y el chofer reintenta con teléfono y PIN
    Then la APK reutiliza la misma clave y el servidor devuelve el mismo dispositivo

  Scenario: Un celular no puede pertenecer a dos choferes
    Given una clave pública registrada por un chofer
    When otro chofer intenta vincular la misma clave pública con sus credenciales
    Then el servidor rechaza el acceso sin transferir el dispositivo

  Scenario: Cambio de PIN o teléfono
    Given un chofer con sesión móvil vigente
    When el administrador cambia el PIN o el teléfono de la ficha
    Then la sesión anterior deja de autorizar
    And el chofer debe volver a entrar con el teléfono y PIN vigentes

  Scenario: PIN cambiado y celular anterior revocado
    Given un chofer cuyo celular fue revocado automáticamente al cambiar el PIN
    When ingresa el teléfono y el PIN nuevos en la misma APK
    Then la app vincula de nuevo el celular sin pedir servidor ni código de activación
    But un PIN incorrecto no restablece el acceso

  Scenario: Bloqueo ante intentos incorrectos
    Given un chofer con acceso móvil habilitado
    When se presentan cinco PIN incorrectos
    Then el acceso queda bloqueado temporalmente
    And ni el PIN ni el teléfono completo aparecen en la auditoría

  Scenario: Ruta sin cálculo vigente
    Given un plan con pedidos asignados pero sin cálculo vial vigente
    When el chofer consulta su ruta
    Then ve sólo sus pedidos y un estado explícito de cálculo ausente u obsoleto
    But no se dibuja una ruta vieja como si estuviera vigente
