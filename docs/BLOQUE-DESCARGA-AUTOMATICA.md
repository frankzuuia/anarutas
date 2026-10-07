# Descarga automática por cliente — 2026-10-06

Bloque aprobado: empezar con **2 visitas** y actualizar con la tercera y
siguientes. No modifica cobro, liquidación, zonas, prioridades ni Odoo.

## Contratos DA01..10

- DA01: llegada GPS hasta confirmar el cobro del último pedido de la visita.
  Varios pedidos del mismo cliente en una visita aportan una sola muestra.
- DA02: cero/una muestra usa el respaldo manual. Desde dos, mediana de las
  últimas tres visitas completas, redondeada hacia arriba a minutos. Con dos
  se promedian ambas; con tres se usa el valor central.
- DA03: Android captura el cierre mediante reloj monotónico anclado al
  servidor, al confirmar. Su comando persistido conserva ese instante en
  reintentos; recepción tardía no alarga la descarga.
- DA04: APK anterior, fecha imposible, visita incompleta o pedidos cerrados en
  visitas diferentes no producen aprendizaje. Falta de telemetría opcional no
  cambia aceptación financiera. No inferir mediciones históricas.
- DA05: evidencia única por pago y muestra única por parada/visita. Autorización,
  recibos, locks y transacción existentes protegen concurrencia/reintentos.
- DA06: historial por identidad real del cliente y versión de ubicación;
  otra ubicación no hereda duraciones del punto anterior.
- DA07: automático por defecto; modo manual fijo opcional. Valor manual
  separado y con permisos/versionado actuales. Panel muestra tiempo efectivo,
  respaldo, cantidad de muestras y última medición.
- DA08: nuevos armados leen el valor efectivo para Google y huellas. Aprender
  no genera trabajo periódico ni recálculos; conserva snapshots publicados e
  iniciados. Avance conserva la duración publicada cuando existe.
- DA09: proyección SQL indexada, sin escribir cliente durante pago ni introducir
  bloqueos pago→cliente→plan. Las lecturas derivan las últimas tres muestras.
- DA10: migración aditiva45. APK compatible; backend primero para aprender.
  Entrega develop después de QA; sin despliegue automático.

## Calidad

Pruebas PostgreSQL reales, HTTP/Chrome, contratos Google, reloj Kotlin,
regresión financiera/ruteo, cobertura, mutaciones, latencia y supply chain.
Matriz y resultados en el informe QA. La captura es telemetría del dispositivo
autenticado, no certificación antifraude. No se crean métricas del chofer.
Una visita olvidada puede influir al empezar con dos; mediana de tres reduce
el efecto de un valor aislado. Mostrar la base del cálculo, sin prometer tiempos
exactos de operación. Prueba física Android queda explícita si no hay equipo.
