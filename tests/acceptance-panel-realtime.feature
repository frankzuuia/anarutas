Feature: Panel operativo en tiempo real
  Scenario: Un chofer inicia su ruta mientras el administrador observa el plan
    Given una ruta publicada con cinco fotos válidas y un administrador conectado
    When el chofer confirma iniciar ruta
    Then la transacción confirma el inicio
    And el panel muestra "Ruta iniciada" sin recarga manual
    And no se consulta Google ni Odoo

  Scenario: Cambios en otra sesión y formularios sin guardar
    Given dos administradores conectados y un formulario local en edición
    When la otra sesión modifica el plan o la flota
    Then los datos visibles se actualizan automáticamente
    And el texto sin guardar se conserva
    And las escrituras aún validan expectedVersion

  Scenario: Recuperación de red y expiración segura
    Given un panel conectado que pierde la red
    When recupera la conexión
    Then vuelve a consultar el estado confirmado actual
    And indica el estado de sincronización
    But si su sesión fue revocada vuelve al acceso sin revelar datos

  Scenario: Transacción fallida
    When una modificación termina en rollback
    Then no se notifica un cambio que no existe

  Scenario: Foto descartada antes del inicio
    Given la APK compatible y el servidor con DELETE desplegado
    When el chofer elimina una foto antes de iniciar
    Then se actualizan el conteo y el control de unidades del panel
    But una ruta iniciada mantiene sus fotos protegidas

  Scenario: Nuevo día de operación
    Given el chofer cargó cinco fotos ayer
    When cambia el día en la zona horaria configurada del servidor
    Then esas fotos no habilitan una nueva salida de hoy
    And el inicio de un plan de ayer se rechaza
    And al sincronizar la APK limpia las fotos mostradas del día anterior sin cerrar sesión
    And requiere cinco fotos válidas de la ruta de hoy

  Scenario: Base de datos lenta o interrumpida
    Given un panel conectado
    When la validación de sesión espera un bloqueo de base de datos
    Then los latidos no acumulan validaciones concurrentes
    And un fallo técnico cierra el canal para reconectar sin afirmar que la contraseña es inválida
