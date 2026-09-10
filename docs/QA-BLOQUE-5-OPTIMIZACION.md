# QA — bloque 5: optimización vial Google

Fecha de evidencia local: 2026-09-10. Rama: `develop`.

## Resultado

El bloque local queda aprobado. Ana Rutas construye un modelo real de Google Route
Optimization con un único punto de salida confirmado, sin peso/capacidad y sin regreso
obligatorio; aplica asignación y orden en una transacción versionada y conserva ETA,
distancia, duración, polilíneas y tokens privados para la futura APK Android.

La prueba viva facturable contra Google no se declara ejecutada: requiere que el usuario
despliegue `develop`, configure la sugerencia `Calle 5 1106, Colonia Industrial,
Guadalajara, Jalisco, México` y confirme visualmente sus coordenadas en la interfaz.

## Evidencia reproducible

| Puerta                  | Comando                         | Resultado                                                               |
| ----------------------- | ------------------------------- | ----------------------------------------------------------------------- |
| Tipos                   | `npm run typecheck`             | PASS                                                                    |
| Estática                | `npm run lint`                  | PASS                                                                    |
| Unitarias e integración | `npm test`                      | PASS — 20 archivos, 146/146 pruebas                                     |
| Cobertura               | `npm run test:coverage`         | PASS — 93.37% sentencias, 87.48% ramas, 95.53% funciones, 94.61% líneas |
| Mutación crítica        | `npm run test:mutation:routing` | PASS — 410/410 eliminados, 100%, 0 supervivientes, 0 sin cobertura      |
| Supply chain            | `npm audit --audit-level=high`  | PASS — 0 vulnerabilidades                                               |
| Build productivo        | `npm run build`                 | PASS — Next.js 16.3.4                                                   |
| E2E                     | `npx playwright test`           | PASS — 1/1 recorrido, 34.4 s                                            |

## Matriz verificada

- Configuración versionada y auditada del punto de salida; la dirección por sí sola
  nunca se convierte en coordenada aceptada.
- Modelo `DRIVING` con tráfico, ventanas duras de 24 horas y precedencia
  Alta→Media→Por horario; no contiene demanda, límites de carga ni `endLocation`.
- OAuth usa una cuenta de servicio en servidor y el alcance `cloud-platform`; proyecto,
  credencial y host no son controlables por el navegador.
- Sin salida, flota, pedidos o puntos confirmados se rechaza antes de invocar Google.
- Un lease por plan/versión evita solicitudes pagadas duplicadas entre sesiones y se
  recupera por vencimiento si el proceso termina abruptamente.
- La llamada externa ocurre fuera de la transacción; al aplicar se vuelven a comprobar
  usuario, versión del plan y versión del origen.
- Asignaciones, posiciones, métricas, run, paradas y auditoría se confirman o revierten
  juntas en PostgreSQL.
- Los tokens de navegación se guardan en el snapshot privado y nunca aparecen en la API
  pública ni en el tablero web.
- Eliminar o recargar un pedido no destruye el historial inmutable de paradas; mover un
  pedido manualmente marca la optimización como obsoleta.
- El mapa muestra la salida, polilíneas, ETA y kilómetros únicamente para una ejecución
  vigente.

## Seguridad, rendimiento y observabilidad

- Sesión, mismo origen, JSON, límite de cuerpo, UUID, rangos geográficos y versiones se
  validan antes de mutar estado.
- La respuesta de Google está limitada a 20 MiB y se valida por estructura, índices,
  unicidad, cobertura y métricas antes de tocar el borrador.
- Las escrituras de pedidos/paradas son masivas con `unnest`; no existe una consulta por
  parada.
- `X-Request-ID`, `Server-Timing`, códigos sanitizados, métricas del recorrido y auditoría
  `plan.optimized` permiten correlacionar latencia y fallos sin registrar secretos.
- Objetivos operativos iniciales para el smoke: cero escritura parcial ante error, una
  sola llamada por plan/versión concurrente y respuesta HTTP dentro del timeout dinámico
  solicitado a Google más 15 segundos de margen de transporte.

## QA posterior al deploy manual

1. Ejecutar migración v6 mediante el arranque normal y comprobar `/api/ready`.
2. Añadir `RUTAS_DEPOT_ADDRESS=Calle 5 1106, Colonia Industrial, Guadalajara,
Jalisco, México` si se desea precargar el texto; no contiene coordenadas.
3. Abrir **Punto de salida**, ubicar la dirección, revisar el pin y guardar sólo cuando
   corresponda físicamente a la salida.
4. Confirmar puntos de clientes reales, abrir un borrador de prueba y pulsar **Armar
   ruta** una sola vez.
5. Comparar pedidos, secuencia, ETA, km y polilínea con el plan; mover una parada y
   verificar el aviso de ruta obsoleta.
6. Revisar Cloud Logging/facturación mediante el request ID. No imprimir ni descargar la
   cuenta de servicio durante la prueba.

## Reversión

Revertir el commit de `develop` y reconstruir la aplicación. Las tablas v6 son aditivas;
no deben eliminarse para volver al código anterior. Los planes, clientes, pedidos y flota
preexistentes permanecen intactos. No promover a `main` sin smoke vivo y autorización
explícita.
