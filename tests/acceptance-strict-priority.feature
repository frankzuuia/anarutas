Feature: Prioridad estricta por camioneta en el armado de rutas
  El administrador exige altas, luego medias y después por horario.
  La prioridad es individual por cliente y cada punto físico pertenece a una sola camioneta.

  Scenario: SP01 Un punto combina una alta y una entrega por horario
    Given un cliente alto comparte coordenadas exactas con un cliente por horario
    And esa camioneta lleva otros clientes altos y medios
    When el administrador arma el borrador
    Then todas las altas preceden a todas las medias y a las de horario
    And la misma camioneta atiende ambos clientes aunque deba volver al punto
    And Google mide el recorrido final con la descarga de cada cliente

  Scenario Outline: SP02 Flota dinámica y prioridades independientes
    Given el plan tiene <camionetas> camionetas disponibles
    When se arma la ruta con prioridades mixtas
    Then cada camioneta respeta altas, medias y por horario
    And el proceso conserva todos los pedidos y la identidad de las camionetas
    And una camioneta no espera a las prioridades de otra camioneta
    Examples:
      | camionetas |
      | 1          |
      | 2          |
      | 4          |
      | 5          |
      | 6          |

  Scenario: SP03 Google ya respeta todas las prioridades
    Given Google devuelve rutas completas con prioridades válidas
    When se verifica la respuesta
    Then se conservan la secuencia, relojes, métricas y trazos originales
    And no se consultan tramos adicionales en Routes

  Scenario: SP04 Sólo una camioneta necesita cambiar
    Given otra camioneta ya respeta todas sus prioridades
    When se corrige el orden de la camioneta afectada
    Then únicamente se recalcula la camioneta afectada
    And conserva todos sus pedidos sin recibir pedidos de otra camioneta
    And la otra camioneta mantiene sus tiempos y trazos

  Scenario: SP05 Un cliente tiene varios pedidos
    Given varios pedidos pertenecen al mismo contacto de entrega
    When se aplica la prioridad vigente del cliente
    Then sus pedidos permanecen contiguos y en la misma camioneta
    And la descarga del cliente se contabiliza una vez en esa visita

  Scenario: SP06 La prioridad impide cumplir un cierre
    Given una entrega por horario queda después de clientes altos y medios
    When Google calcula una llegada posterior al cierre
    Then se conserva el orden de prioridad
    And el panel conserva y muestra el atraso previsto
    And llegar antes de la apertura no genera una espera artificial

  Scenario: SP07 Respuesta incompleta o punto repartido
    Given la respuesta duplica u omite pedidos o reparte un mismo punto entre camionetas
    When se valida el resultado
    Then la respuesta no es elegible para guardar
    And el borrador conserva su último estado válido ante una recuperación fallida

  Scenario: SP08 Falla la medición de la corrección
    Given el orden necesita cambiar y Routes no está disponible
    When se intenta recalcular
    Then el proceso informa el fallo y no guarda una ruta parcial
    And no oculta el fallo reasignando los pedidos a otra camioneta
    And libera su reserva sin eliminar una reserva nueva

  Scenario: SP09 Conflicto de versión o cálculo concurrente
    Given otro cálculo ocupa el mismo borrador o cambian los datos operativos
    When se intenta calcular o guardar una versión antigua
    Then se rechaza la operación incompatible
    And no se duplican los resultados ni se sobrescribe una versión nueva

  Scenario: SP10 Recuperación geográfica conserva prioridades
    Given Fleet no devuelve una solución completa utilizable
    When se mide la recuperación por zonas con Google Routes
    Then también se exige el orden altas, medias y por horario
    And no se repite la llamada Fleet

  Scenario: SP11 Índices y filtrado de entregas
    Given hay clientes archivados, pedidos de recoge y camionetas sin pedidos
    When se corrige una camioneta distinta de la primera
    Then se conservan los índices reales de entregas y camionetas
    And los pedidos excluidos no se confunden con entregas ni cambian de modalidad

  Scenario: SP12 Acceso autorizado y forecast vigente
    Given un recibo real de Google se guarda en PostgreSQL
    When un administrador consulta el panel
    Then ve la secuencia guardada y los atrasos de esa versión
    And anónimos, orígenes ajenos y liquidadores no pueden armar rutas
    And una edición posterior retira el forecast obsoleto
