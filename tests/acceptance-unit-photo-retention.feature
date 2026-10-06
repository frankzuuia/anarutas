Feature: Retención independiente de fotografías de unidades
  Las fotografías de inspección de unidades duran treinta días desde su captura.
  Su limpieza física diaria no modifica la política de evidencias de incidencias.

  Scenario: Captura y reintento de la misma fotografía
    Given una ruta publicada para un chofer autorizado que aún no inicia
    When carga una fotografía y reintenta la misma carga
    Then la fotografía vence treinta días después de su captura original
    And el reintento conserva su identidad y vencimiento
    And otro chofer no puede acceder a ella

  Scenario: Actualización automática de las fotografías que todavía existen
    Given fotografías conservadas bajo la política anterior de quince días
    When la instalación migra a la versión 44 incluso con ejecuciones concurrentes
    Then cada vencimiento legado pasa a captura más treinta días
    And repetir la migración no extiende nuevamente los vencimientos
    And los vencimientos explícitos distintos de la política anterior se conservan
    And no se recrean archivos ni registros eliminados

  Scenario: Conservación y vencimiento independientes del barrido
    Given una fotografía capturada hace veintinueve días
    Then continúa accesible para sus usuarios autorizados
    When llega su vencimiento a los treinta días
    Then las APIs rechazan el acceso aunque el barrido todavía no haya corrido

  Scenario: Barrido diario de unidades
    Given un barrido de unidades completado
    When pasan una hora o veintitrés horas
    Then no se consulta la base ni se recorren archivos de unidades para limpiar
    When se cumplen veinticuatro horas
    Then se eliminan los registros vencidos en lotes hasta terminar
    And los archivos vigentes se conservan aunque su fecha de modificación sea antigua

  Scenario: Fallos, concurrencia y recuperación
    Given almacenamiento de unidades temporalmente inaccesible
    When falla la limpieza
    Then queda pendiente para reintentar
    And dos llamadas simultáneas del mismo proceso no duplican el barrido
    And varios procesos no reclaman dos veces el mismo registro vencido
    And un archivo huérfano antiguo se reintenta tras recuperarse el almacenamiento

  Scenario: Las otras evidencias siguen separadas
    Given el barrido de unidades está esperando su siguiente ejecución diaria
    When vence una evidencia de incidencias
    Then su limpiador propio puede retirarla sin esperar al barrido de unidades
    And el barrido de unidades no recorre el directorio de incidencias
