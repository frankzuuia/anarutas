# Tiempo entre paradas — bloque aprobado, 2026-10-05

El propietario aprobó «vale dale» después de precisar un recorrido equivalente
a añadir destinos en Google: ubicación actual → parada activa → intermedias →
destino, con descargas pendientes antes de llegar. Dos relojes seleccionan el
tramo. Si su origen coincide con la parada activa, el origen sigue al chofer;
otro origen representa una consulta desde la salida de esa parada.

Autopsia: `LiveRouteView` sólo seleccionaba un punto para verlo en el mapa.
`routeEta` representa exclusivamente el destino del Navigation SDK. La lectura
en vivo no exponía descarga, aunque existe `route_customers.unloading_minutes`.
Reutilizar ese ETA como si correspondiera a la quinta parada sería incorrecto.

## Contrato

- Consulta privada de rutas; mismo rol y aislamiento que `/api/live-routes`.
- Dos puntos de la misma ejecución, ordenados por posición; destino pendiente.
- En modo actual: GPS fresco y parada activa requeridos. Incluir llegada a la
  parada activa, descarga restante según tiempo configurado/atención transcurrida,
  trayectos y descargas intermedias. No incluir descarga del destino.
- Omitir pedidos entregados/reprogramados y reintentos no elegidos; informar los
  reintentos omitidos. Nunca cambiar destinos, estados, asignaciones o prioridades.
- Descarga sin configurar no se inventa: se informa cuántas faltan en el estimado.
- Google Routes real con tráfico y puntos intermedios en su orden. Su duración
  vial se suma a las descargas configuradas; es una aproximación, no una promesa.
- Más de 25 puntos intermedios se dividen por el límite real del proveedor.
- Caché sólo en memoria por base/ejecución/contexto, 60 s, hasta 128 resultados;
  compartir consultas idénticas, máximo 8 consultas simultáneas por proceso/base,
  timeout total 25 s. No son límites a pedidos/rutas. Sin reintentos de red ocultos.
- Revalidar permisos/contexto al terminar; descartar respuesta de una selección
  vieja, ruta finalizada, coordenada corregida, nueva parada activa o datos vencidos.
- Refrescar mientras la consulta permanezca visible; pausar en pestaña oculta.

## Aceptación y QA

| Caso | Evidencia necesaria |
| --- | --- |
| En camino a 2, destino 5 | GPS→2→3→4→5 y descarga 2/3/4, nunca 5 |
| Atendiendo 2 | Sólo descarga restante en 2 más 3/4 y trayectos |
| Consulta 3→5 independiente | Salida de 3; descarga de 4 únicamente |
| Parada intermedia ya entregada | Omitida, sin redirigir al chofer |
| Reintentos y descarga desconocida | Advertencia explícita, sin datos inventados |
| Cambio de GPS/estado/punto/destino | Actualización acotada y descarte de respuestas viejas |
| Ruta/usuario ajenos, CSRF, sesión revocada | Rechazo antes del cálculo y al devolver |
| Google falla/cuota/timeout | Error honesto y recuperación en próxima consulta |
| Más de 25 intermedias | Todos los puntos, sin truncar |
| Desktop/móvil/cuatro pantallas | Relojes accesibles, selecciones independientes |

Puertas: unitarias y cobertura dirigida, mutaciones críticas, PostgreSQL/HTTP
reales, contrato Google real, E2E, tipos/lint/build y regresión afectada. Registrar
latencia, cobertura, mutación, defectos y límites en el QA antes de subir develop.
No despliegue, no nueva APK. Google: https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes
