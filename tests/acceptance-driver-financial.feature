Feature: Importes e incidencias de producto del chofer
  Scenario: Cantidades finales sin cambiar la publicación
    Given una ruta publicada con una partida y sus identificadores de importación
    When Odoo valida una cantidad final distinta de la publicada
    Then el chofer ve la cantidad final y los importes oficiales
    And la publicación original permanece intacta

  Scenario: Faltante ligado y devolución completa
    Given una partida validada con una revisión financiera vigente
    When el chofer registra toda la cantidad como faltante o devolución
    Then el descuento conserva exactamente el importe original
    And el importe actual es cero

  Scenario Outline: Reposición con elección explícita
    Given una reposición sobre una partida validada
    When el chofer elige "<elección>"
    Then la cantidad física disminuye
    And el importe afectado queda "<tratamiento>"
    Examples:
      | elección    | tratamiento              |
      | pay_full    | conservado en el actual   |
      | defer       | pendiente de reposición   |

  Scenario: Fuente cambia durante la captura
    Given un borrador basado en una revisión financiera
    When Odoo cambia la revisión antes de guardar
    Then el servidor rechaza la referencia antigua
    And el chofer conserva el borrador para revisar los nuevos importes

  Scenario: Concurrencia e idempotencia
    Given varias incidencias sobre una misma partida
    When llegan comandos simultáneos o se reenvía un comando confirmado
    Then la cantidad acumulada nunca excede la cantidad final
    And cada comando confirmado produce una sola incidencia

  Scenario: Datos vencidos o fuente inaccesible
    Given la última consulta financiera excede su vigencia o tiene error
    When el chofer intenta registrar una incidencia financiera
    Then el servidor bloquea la escritura con esa fuente
    And la pantalla identifica los datos pendientes de actualización

  Scenario: Compatibilidad y aislamiento
    Given incidencias históricas y rutas asignadas a distintos choferes
    When se migra el esquema o se consulta desde otra sesión
    Then las incidencias históricas permanecen intactas
    And cada chofer sólo recibe las finanzas de sus publicaciones autorizadas
