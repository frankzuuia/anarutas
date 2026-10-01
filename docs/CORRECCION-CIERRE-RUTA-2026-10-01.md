# Cierre de ruta después de Finalizar trabajo

Plan confirmado por el propietario el 2026-10-01. No usar ui-ux-pro-max.

## Causa y contrato

Finalizar trabajo persiste route_driver_work_completions, pero las lecturas
operativas sólo consultan route_driver_execution_completions. En el modo de
prueba el cierre GPS permanece ausente, por lo que Inicio conserva la ruta,
planificación sólo muestra started_at y Ruta en vivo mantiene el seguimiento.
Las tarjetas usan mínimo100dp y horizontalScroll dentro de un AlertDialog
estrecho: el tercero queda fuera del ancho disponible.

BL184: Cierre final confirmado -> trabajo completado es estado terminal de la
ejecución original; Inicio queda sin ruta actual, planificación muestra Ruta
finalizada, se excluye del informe en vivo y se bloquean nuevas acciones/GPS.
Lectura de historial, tickets, resumen, cierre GPS y reintentos se conservan.
Permisos y aceptación financiera existentes permanecen. El evento y fingerprint
ya existentes notifican el cierre; Android también refresca tras confirmación.

BL185: Modal de liquidación -> usar superficie ancha existente con cabecera y
acciones fijas, contenido vertical y tres tarjetas dentro del ancho disponible;
sin scroll horizontal, recorte ni truncamiento monetario. Letras grandes pueden
aumentar altura y dividir el importe en líneas sin cambiar el valor.

## Conexiones y límites

Proyectar cierre operativo o financiero desde sus tablas reales con un fragmento
SQL compartido, sin cambiar ni fabricar comprobantes GPS. La lectura reconoce
trabajos ya cerrados automáticamente, sin reparación manual de datos. Las
proyecciones siempre coinciden con execution/publication_revision originales;
otra ruta o revisión no hereda un cierre ajeno.

Al confirmar trabajo, detener target/ETA/GPS persistidos dentro de la misma
transacción y conservar coordenadas históricas. La guarda operativa consulta el
estado terminal antes de nuevos comandos. Replays originales conservan su
resultado; recepción y cobros permanecen append-only. Cancelar una publicación
finalizada se rechaza para impedir que se presente como retirada/reabierta.

Android limpia selección operativa al recibir el cierre, detiene NavigationRegistry
y mantiene el modal Buen trabajo en la pestaña financiera. Mis rutas permite
consulta histórica con Ruta finalizada. Inicio no reutiliza una ruta finalizada
como fallback. Otra publicación actual se selecciona si existe.

Modo temporal sin bodega permanece false según BL183. Su restauración posterior
no forma parte de esta petición. Sin cambios de roles, proveedores, dependencias,
credenciales ni escritura Odoo. No es necesario alterar el esquema financiero.

## Matriz y bloques

| Caso | Resultado / verificación                                                                         |
| ---- | ------------------------------------------------------------------------------------------------ |
| CR01 | Sin cierre de trabajo: conserva recorrido normal y restricciones de cobro                        |
| CR02 | Tras aceptación y Finalizar: Inicio sin ruta y planificación finalizada; PG/HTTP/JVM             |
| CR03 | Ruta cerrada ausente en vivo; GPS/target/ETA detenidos; PG/HTTP                                  |
| CR04 | Comandos nuevos de servicio/reintento/GPS/cancelación bloqueados; PG                             |
| CR05 | Confirmación concurrente/replay: un cierre y resumen intacto; PG/HTTP                            |
| CR06 | Trabajo ya guardado antes del cambio: lectura terminal automática; PG                            |
| CR07 | Otro chofer/publicación/ruta sin cierre no se altera; PG/JVM                                     |
| CR08 | Bodega y modo temporal: ambos cierres terminales, GPS real conservado; PG/HTTP                   |
| CR09 | Historial/ticket/resumen consultables y aceptación completa intacta; PG/HTTP/JVM                 |
| CR10 | Android recibe evento/confirmación; limpia ruta sin cerrar Buen trabajo; JVM/Compose             |
| CR11 | Tres métodos caben en modal sin scroll lateral, importe íntegro y cancelar no envía; Compose     |
| CR12 | Letra grande/cifras largas/50 pedidos: altura adaptable y acciones accesibles; Compose/QA física |

Bloque1: modal y medidas Android, pruebas de límites de ancho/semántica.
Bloque2: SQL de lectura compartido, selección actual, comandos, live y planificación.
Bloque3: reconciliación Android, Gherkin/regresión/contrato/E2E/mutación/cobertura,
seguridad, build y APK compatible. Evidencia y procedimiento físico reproducible.

Guía Route Handlers de Next16.3.8 instalada revisada. Auditoría local:
GREEN LIGHT, INTEGRITY TOTAL, MATCH PERFECT con CR-T01..03. Se mantiene la
excepción física aprobada previamente; no se certifica teléfono por compilar.
