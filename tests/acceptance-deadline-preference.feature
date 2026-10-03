Característica: Preferencia explícita por entregar dentro de horario
  Escenario: Corregir atrasos previstos con el mismo lote y flota
    Dado un borrador real con pedidos obligatorios, ventanas y descarga por cliente
    Cuando el administrador arma sus rutas
    Entonces Google recibe alternativas de llegada dentro de cada ventana
    Y cada alternativa tardía tiene un costo fijo además de demora proporcional
    Y cada pedido conserva identidad, agrupación, carga, ubicación y duración
    Y el resultado completo mantiene los tiempos y recorridos devueltos por Google

  Escenario: Cierre anterior a la salida o flota insuficiente
    Dado que una ventana terminó antes de la salida o no es viable llegar a tiempo
    Cuando se construye el modelo
    Entonces no se inventa una llegada dentro de horario
    Y la opción tardía conserva el pedido y carga la demora ya inevitable
    Y el panel informa cualquier atraso calculado con su ETA real

  Escenario: Varias ventanas y espera
    Dado un cliente con ventanas separadas y otra visita sin horario
    Cuando Google asigna y secuencia el lote
    Entonces puede elegir una ventana posterior válida sin penalización de atraso
    Y el intervalo cerrado no se transforma en horario de recepción
    Y la visita sin horario no recibe restricciones inventadas

  Esquema del escenario: Flota dinámica y una solicitud
    Dado un plan con <vehiculos> camionetas
    Cuando el administrador arma sus rutas
    Entonces se utiliza la misma política sin fijar nombres, IDs o cantidades
    Y se realiza una sola solicitud Fleet
    Ejemplos:
      | vehiculos |
      | 1         |
      | 4         |
      | 5         |
      | 6         |
      | 12        |

  Escenario: Fallos, concurrencia y permisos
    Dado un actor sin permiso, versión obsoleta, cálculo concurrente o ruta iniciada
    Cuando solicita armar rutas
    Entonces siguen vigentes las guardas existentes y no se sobrescribe el plan
    Y un fallo del proveedor conserva la recuperación vial y su aviso
    Y no se duplica la llamada Fleet ni se altera publicación o liquidación
