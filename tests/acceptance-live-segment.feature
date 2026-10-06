Feature: Consultar tiempo entre paradas sin modificar la ruta
  Background:
    Given una cuenta activa de rutas y una ejecución visible en Ruta en vivo

  Scenario: Llegada a la quinta parada desde el trayecto a la segunda
    Given GPS reciente y destino activo en la parada 2
    When marco los relojes de las paradas 2 y 5
    Then Google recibe ubicación actual, 2, 3, 4 y 5 en ese orden
    And el estimado suma descarga de 2, 3 y 4 pero no descarga de 5
    And el resumen junto al tiempo del chofer indica Desde ahora y el tramo
    And no cambia el orden, la navegación, los pedidos ni la liquidación

  Scenario: Descarga en curso y continuación hasta el destino elegido
    Given el chofer lleva 3 minutos atendiendo una parada con descarga de 10 minutos
    When consulto hasta una parada posterior
    Then se suman 7 minutos de descarga restante en el origen
    When cambia la parada activa
    Then el tramo sigue desde esa parada y descarta el resultado anterior
    And cuando la parada activa sea el destino sólo estima el trayecto restante

  Scenario: Consulta independiente y selección inversa
    Given el chofer va hacia la parada 2
    When marco primero la parada 5 y después la 3
    Then se consulta la salida de 3 hacia 5 con descarga en 4
    And se identifica como Al salir y no exige GPS para ese origen fijo

  Scenario: Intermedias atendidas, reintentos y descarga no configurada
    Given una parada intermedia atendida y otra con reintento no seleccionado
    And una descarga sin configurar
    When consulto el tramo
    Then no se incluyen las paradas atendidas ni el reintento
    And se avisa el reintento omitido y la descarga no incluida

  Scenario Outline: Permisos y entrada privada
    Given <condicion>
    When solicito el estimado por HTTP
    Then se rechaza antes de calcular <resultado>
    Examples:
      | condicion                           | resultado |
      | sesión ausente                      | 401       |
      | cuenta de liquidación               | 403       |
      | origen HTTP ajeno                    | 403       |
      | coordenadas añadidas por el cliente | 400       |
      | parada de otra ejecución            | 409       |

  Scenario: Caché, concurrencia y recuperación
    Given varias consultas idénticas y autorizadas
    When llegan juntas
    Then comparten el cálculo vigente sin modificar datos de negocio
    When cambia el contexto durante Google o vence el GPS
    Then se retira el número anterior y se informa la causa
    When vuelve el GPS o se recupera la configuración de Google
    Then la siguiente consulta recupera el resultado sin reutilizar un error

  Scenario: Tramos largos y orden fijo
    Given más de 25 paradas intermedias
    When consulto el tramo
    Then se divide por el límite real de Google sin omitir ni duplicar trayectos
    And Google conserva el orden de las paradas

  Scenario: Celular y Centro de control
    When uso teclado o celular y abro cuatro pantallas de rutas
    Then los relojes tienen nombre accesible y estado seleccionado
    And cada pantalla conserva su propia selección
    And no se desborda horizontalmente el panel
