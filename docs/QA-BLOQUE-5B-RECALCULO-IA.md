# QA — bloque 5B: recálculo automático y planificación OpenAI

Evidencia iniciada el 2026-09-10 y cierre local el 2026-09-11. Rama: `develop`.

## Resultado

La implementación local queda aprobada. El administrador define una hora de salida de
24 horas por plan. **Armar ruta** permite a OpenAI proponer y comparar distribuciones,
mientras Google evalúa recorridos por calles. Sólo una candidatura completa, factible y
con prioridad global Alta→Media→Por horario puede aplicarse. Cada camioneta sale de la
bodega y regresa a ella; el regreso cuenta en trazo, kilómetros y duración.

Después de una edición manual, Ana Rutas conserva exactamente la camioneta y posición
elegidas y agenda un recálculo vial durable. Añadir una camioneta a un plan existente y
moverle pedidos recalcula las rutas afectadas sin redistribuir los demás. Una revisión
anterior no puede sobrescribir una edición posterior.

No se declara ejecutado un smoke facturable con OpenAI, Route Optimization y Routes API:
el entorno local no contiene secretos reales. Las fronteras se validaron mediante
contratos deterministas de proveedor y PostgreSQL real; el smoke vivo se ejecuta después
de configurar los secretos privados en EasyPanel.

## Evidencia reproducible

| Puerta                  | Comando                                    | Resultado                                                                  |
| ----------------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| Tipos                   | `npm run typecheck`                        | PASS                                                                       |
| Estática                | `npm run lint`                             | PASS                                                                       |
| Unitarias e integración | `npm test` / cobertura final               | PASS — 27 archivos, 236/236 pruebas                                        |
| Cobertura               | `npm run test:coverage`                    | PASS — 91.66% declaraciones, 85.54% ramas, 97.31% funciones, 93.13% líneas |
| Mutación OpenAI/Routes  | `npm run test:mutation:routing-operations` | PASS — 375 mutaciones; 94.40% total y 97.52% cubierto; 354 eliminadas      |
| Mutación Google base    | `npm run test:mutation:routing`            | PASS — 435/435 mutaciones detectadas, 100%, 0 supervivientes               |
| Supply chain            | `npm audit --audit-level=high`             | PASS — 0 vulnerabilidades                                                  |
| Build productivo        | `npm run build`                            | PASS — Next.js 16.3.4                                                      |
| E2E                     | `npm run test:e2e`                         | PASS — 1/1 recorrido; 22.2 s de prueba, 33.4 s total Playwright            |

Los 9 mutantes sobrevivientes del conjunto nuevo corresponden a comprobaciones
sobredefensivas cuyo rechazo también queda garantizado por otra condición; 12 mutantes
sin cobertura pertenecen al transporte HTTPS real de Routes API, que deliberadamente no
se intercepta en esta evidencia. El código crítico cubierto obtuvo 97.44% y la huella
operativa obtuvo 100%; la suite
preexistente de Google conservó su umbral de 100%.

La configuración privada de OpenAI obtuvo 100% de mutación: 58/58 cambios
defectuosos fueron detectados, incluido un nivel de razonamiento no admitido.

## Matriz verificada

- Migración aditiva v7 para `departure_minute`, huella de entrada y cola durable de
  recálculo; conserva planes y ejecuciones anteriores.
- Guardado autenticado, mismo origen y con `expectedVersion`; `00:00` y `23:59` son
  válidos, formatos ambiguos o versiones concurrentes se rechazan.
- Route Optimization fija la misma salida para todas las camionetas y usa la bodega como
  `startLocation` y `endLocation`; no modela peso, volumen ni capacidad.
- OpenAI usa function calling nativo estricto. Sólo recibe IDs opacos, coordenadas,
  ventanas, prioridades y métricas; no recibe nombre, domicilio textual, teléfono ni
  nota del cliente.
- Cada propuesta debe contener cada camioneta exactamente una vez y cada entrega activa
  exactamente una vez. IDs ajenos, duplicados, faltantes, recolecciones o clientes
  archivados se rechazan antes de persistir.
- Alta debe preceder globalmente a Media y Media a Por horario. Una candidatura con
  tardanzas, conflicto global de prioridad o camioneta injustificadamente vacía no puede
  confirmarse.
- Con varias camionetas y entregas se exigen por lo menos dos distribuciones completas y
  distintas antes de confirmar. Repetir la misma propuesta reutiliza su medición y no la
  contabiliza ni factura como una alternativa nueva.
- Una propuesta Google que incumpla prioridad se devuelve a OpenAI con IDs opacos y el
  error de contrato para que construya alternativas; no aborta el plan ni se persiste.
- El comparador es lexicográfico: factibilidad, duración máxima, desbalance, espera,
  tiempo vial y distancia. OpenAI no puede saltarse esta evaluación del servidor.
- Las respuestas incompletas por límite del proveedor conservan su estado y continúan;
  otras terminaciones incompletas fallan cerradas. No se impone un límite bajo de salida.
- El recálculo manual recorre los pedidos en su orden actual, espera la siguiente ventana
  válida, identifica tardanzas y conflictos y suma el tramo final de regreso.
- La cola usa revisión, lease renovable y compare-and-swap. Reinicios, timeouts y dos
  réplicas no permiten que un trabajador viejo aplique resultados sobre una versión
  nueva; los fallos recuperables admiten reintento.
- El mapa consulta estado actualizado, muestra cálculo pendiente/en curso/fallido,
  refresca automáticamente, conserva el acomodo manual y permite reintentar un fallo.
- Polilíneas por tramo se exponen al mapa; los route tokens permanecen privados para la
  futura navegación Android.
- La exportación Excel añade salida, ETA, regreso y kilómetros sin inventar valores si la
  ejecución ya no corresponde a la huella vigente.

## Límites explícitos

- No se presupone tiempo de descarga porque el usuario no proporcionó uno; la interfaz lo
  indica y las ETA representan llegada. Agregar tiempos de servicio requiere una regla de
  negocio posterior, no un número inventado.
- Para planes pasados Google Routes no ofrece tráfico histórico en este flujo; se muestra
  estimación vial estática. Para salidas futuras se solicita tráfico previsto.
- Una edición manual puede producir una ruta imposible. Se conserva como fue ordenada y
  se muestra el conflicto; sólo **Armar ruta** puede redistribuir todo el plan.
- El proceso de trabajo automático presupone el servidor persistente usado por EasyPanel;
  no depende de una función serverless efímera.

## Configuración privada posterior al despliegue

Configurar como secretos de EasyPanel, nunca con prefijo `NEXT_PUBLIC`:

- `RUTAS_OPENAI_API_KEY` y `RUTAS_OPENAI_MODEL`.
- `RUTAS_OPENAI_REASONING_EFFORT=high` como punto inicial para este flujo complejo;
  ajustar únicamente con evidencia de calidad, latencia y consumo del ruteo real.
- `RUTAS_OPENAI_ORGANIZATION_ID` y `RUTAS_OPENAI_PROJECT_ID` sólo si aplican a la clave.
- `RUTAS_GOOGLE_PROJECT_ID`, credencial de cuenta de servicio y
  `RUTAS_GOOGLE_ROUTES_API_KEY`, además de la configuración Maps ya utilizada por el
  panel.

## Smoke vivo posterior al despliegue manual

1. Desplegar `develop`, esperar la migración v7 y comprobar `/api/ready`.
2. Abrir un plan real, guardar punto y hora de salida y pulsar **Armar ruta** una sola vez.
3. Confirmar en auditoría el modelo OpenAI, cantidad de tools/candidaturas y un único
   resultado aplicado; no deben aparecer secretos ni datos personales en logs.
4. Verificar en mapa y Excel salida, ETA, kilómetros y regreso a bodega por camioneta.
5. Mover dos paradas, cerrar/reabrir el mapa y confirmar estado de recálculo, nuevo trazo
   y el mismo orden manual.
6. Añadir una camioneta, moverle un pedido y comprobar que ambas rutas se recalculan sin
   mover silenciosamente las entregas restantes.
7. Provocar de forma controlada una clave inválida o cuota rechazada, comprobar que el
   borrador no cambia y restaurar el secreto para probar **Reintentar cálculo**.

## Reversión

Revertir el cambio en `develop` y reconstruir la aplicación. La migración v7 es aditiva:
no eliminar columnas ni la cola para retroceder, pues contienen historial y estado
operativo. No promover a `main` sin smoke vivo y autorización explícita.
