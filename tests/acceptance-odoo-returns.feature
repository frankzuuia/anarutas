# language: es
Característica: Preparar devoluciones parciales en Odoo para validación manual
  La APK informa cantidades con evidencia y la administración conserva el cobro.
  Odoo recibe únicamente los movimientos seleccionados del surtido validado.

  @contrato
  Esquema del escenario: Detectar la operación nativa por capacidades reales
    Dado el registro, campos y botones oficiales de <version>
    Cuando el conector inspecciona la instalación
    Entonces selecciona <metodo> y la unidad <unidad>
    Y no llama una operación de devolución total ni intercambio
    Ejemplos:
      | version | metodo                | unidad      |
      | 17      | create_returns        | product_uom |
      | 19      | action_create_returns | product_uom |
      | 20      | action_return         | uom_id      |

  @postgres @integracion_real_20
  Escenario: Devolución nueva con fotografía y cierre de cobro
    Dado un pedido confirmado con surtido validado del Odoo de develop
    Y un chofer autenticado en su ruta y una fotografía válida
    Cuando registra una devolución de 0.25 de un movimiento del pedido
    Entonces no se crea todavía una devolución remota
    Cuando confirma atención y cobro con la base financiera vigente
    Entonces se guardan cobro y trabajo de envío en la misma transacción
    Y Odoo contiene únicamente ese producto con cantidad 0.25
    Y el traslado queda pendiente de validación manual
    Y la tarjeta administrativa muestra su referencia y estado

  @postgres
  Escenario: Correcciones, cancelaciones e historial
    Dado una devolución capturada antes de habilitar la capacidad
    Y dos devoluciones nuevas del mismo movimiento después de habilitarla
    Y otra devolución nueva cancelada antes de cerrar el cobro
    Cuando se corrige la cantidad de una devolución nueva y se confirma el cobro
    Entonces se suman sólo las dos cantidades nuevas no canceladas
    Y la devolución histórica y la cancelada no se envían

  @seguridad
  Escenario: Aislar chofer, fuente, compañía e identidades
    Cuando un chofer ajeno intenta registrar la incidencia
    Entonces se rechaza la solicitud sin guardar evidencia ni trabajo
    Cuando cambian la fuente Odoo o la compañía del trabajo
    Entonces no se escribe en ese Odoo
    Y la base rechaza trabajos y enlaces que no pertenecen al mismo cobro y pedido

  @contrato
  Escenario: Cantidad excesiva o unidad incompatible
    Dado devoluciones previas pendientes o validadas del movimiento
    Cuando la cantidad nueva excede el saldo o la conversión pierde precisión
    Entonces se rechaza la preparación y no se valida ningún traslado

  @integracion_real_20
  Escenario: Respuesta perdida tras el commit remoto
    Dado una creación nativa ya confirmada por Odoo cuya respuesta local se pierde
    Cuando vuelve a ejecutarse el trabajo
    Entonces recupera el mismo traslado por referencia única y compañía
    Y verifica los movimientos antes de continuarlo
    Y no crea una segunda devolución

  @integracion_real_20
  Escenario: Dos trabajadores, repetición del cobro y origen financiero cambiado
    Cuando dos trabajadores procesan el mismo trabajo simultáneamente
    Entonces uno prepara la devolución y el otro no la duplica
    Y repetir la confirmación del cobro conserva el mismo recibo
    Y la observación posterior de stock devuelto conserva el importe capturado

  @integracion_real_20
  Escenario: Resultado remoto incierto sin referencia encontrada
    Dado una creación iniciada sin evidencia del traslado resultante
    Cuando la reconciliación no encuentra la referencia esperada
    Entonces mantiene el estado incierto y vuelve a comprobar después
    Y no crea otro traslado a ciegas

  @pendiente_instancia_17
  Escenario: Certificar el contrato en un Odoo 17 de pruebas
    Dado un Odoo 17 de pruebas autorizado con un surtido validado
    Cuando se ejecuta el recorrido completo con unidades de producto y movimiento distintas
    Entonces crea una devolución nativa de cantidades equivalentes exactas
    Y la validación permanece exclusivamente manual
