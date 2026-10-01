# language: es
Característica: Ruta finalizada después de recepción y cierre de trabajo
  Esquema del escenario: CR01 CR02 CR08 Confirmar cierre de trabajo
    Dado todos los pedidos entregados y cobros aceptados por el liquidador
    Y la política de bodega <modo>
    Cuando el chofer confirma Finalizar trabajo
    Entonces se guarda un cierre único con su resumen real
    Y Inicio queda sin esa ruta actual
    Y planificación muestra Ruta finalizada
    Ejemplos:
      | modo |
      | normal con recorrido terminado en bodega |
      | prueba autorizada sin regreso |

  Escenario: CR03 CR04 Detener y bloquear operaciones posteriores
    Dado un cierre de trabajo confirmado
    Cuando se actualiza Ruta en vivo
    Entonces la ruta no aparece ni transmite GPS nuevo
    Y se detienen destino y ETA
    Y comandos nuevos de servicio, reintento, reinicio y cancelación se rechazan

  Escenario: CR05 CR07 Reintento concurrente aislado
    Dado la confirmación original del chofer
    Cuando llegan dos reintentos simultáneos
    Entonces persiste un único cierre y sólo aumenta una vez la revisión
    Y conserva el mismo resumen y recibos
    Y otra ruta o publicación no hereda el cierre

  Escenario: CR06 CR09 Historial ya existente
    Dado un trabajo finalizado antes de esta corrección
    Cuando se consultan Inicio, planificación e informe en vivo
    Entonces reconocen automáticamente su estado finalizado
    Y el ticket y resumen siguen consultables
    Y no se fabrica una llegada GPS

  Escenario: CR10 Recepción de cierre en Android
    Dado una ruta en navegación y la pestaña de liquidación abierta
    Cuando recibe la confirmación de trabajo
    Entonces detiene navegación y limpia selección operativa
    Y conserva Buen trabajo hasta que el chofer lo cierre

  Escenario: CR11 CR12 Modal sin recorte
    Dado una solicitud de toda la ruta en un teléfono angosto
    Cuando abre el modal con texto grande o importes largos
    Entonces Efectivo, Transferencias y Crédito caben sin scroll horizontal
    Y el contenido puede crecer verticalmente con las acciones visibles
    Y Cancelar no envía una solicitud
