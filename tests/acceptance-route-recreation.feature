Feature: Recrear una ruta sin reutilizar ejecuciones históricas (BL-152)
  Scenario: RF01 Cancelar, quitar y volver a publicar una ruta iniciada
    Given una ruta iniciada con una parada corregida
    When administración cancela la ruta, quita la camioneta y la agrega de nuevo
    And publica nuevamente sus pedidos
    Then la publicación tiene una revisión mayor que todas las anteriores
    And aparece vigente sin heredar correcciones ni atención de la ejecución anterior
    And al iniciar se crea otra ejecución y se conserva íntegra la anterior

  Scenario: RF02 y RF03 Recreación sin inicio y publicación concurrente
    Given una ruta publicada que nunca se inició
    When se quita y agrega su camioneta varias veces
    And dos solicitudes intentan publicar el mismo contenido
    Then cada recreación usa una revisión nueva
    And la segunda solicitud idéntica no consume otra revisión

  Scenario: RF04 Migración automática e idempotente
    Given publicaciones vigentes, ejecuciones históricas y auditorías de rutas retiradas
    When se actualiza desde el esquema 30 al 31 y se repite la verificación
    Then se conserva el máximo por plan y camioneta
    And no cambian snapshots, fotos, cantidades ni inicio de rutas

  Scenario: RF05 y RF06 Mantener controles y recuperación
    When se intenta iniciar con revisión vieja, sin cinco fotos o en otra fecha
    Then se rechaza la operación sin modificar la ruta
    And una transacción fallida revierte publicación y contador juntos

  Scenario: RF07 y RF08 Foto real sobredimensionada en image_128
    Given que Odoo devuelve un WebP de 860 por 860 píxeles
    When el chofer autorizado consulta su miniatura
    Then recibe un WebP de máximo 128 píxeles sin metadatos
    And entradas inválidas o mayores al límite siguen rechazándose
    And productos sin foto siguen usando el logo Five
    And el contrato móvil no requiere otra APK
