# Corrección de lectura Google — 11 septiembre 2026

## Diagnóstico y alcance

El usuario reportó ROUTING_RESPONSE_INVALID durante Armar ruta. El lector exigía
visits/transitions incluso para camionetas sin entregas. La misma respuesta con
listas explícitas era aceptada y con listas omitidas era rechazada. El formato
ProtoJSON omite listas vacías; ShipmentRoute permite vehículos sin visitas.
Esta incompatibilidad se reprodujo localmente. No se dispone del cuerpo original
de la llamada del usuario: no se atribuye a ese campo el incidente vivo con certeza.

La normalización admite listas omitidas/nulas, manteniendo tipos, identidades,
cobertura completa, conteos y validación de métricas para rutas con entregas.
Sólo las rutas vacías pueden omitir sus métricas. Las listas globales de rutas
pueden omitirse si todos los pedidos están contabilizados como omitidos y las
métricas agregadas son válidas. No se aplican candidatos inválidos ni se relajan
prioridades o ventanas.

La prueba de integración existente recibe ahora una camioneta sin listas ni
métricas: verifica que el flujo continúe hasta comparar candidatos y aplicar sólo
el mejor factible. PostgreSQL es real; las respuestas de proveedores son fixtures
de contrato, no llamadas facturables ni evidencia del resultado real de Terra.

El error público deja de afirmar que faltaron pedidos. El log añade routingField
para fallos de listas, transiciones, métricas y cobertura. No registra el cuerpo de
Google, ubicaciones, datos de clientes ni claves.

## Evidencia

Todas las puertas locales ejecutadas sobre esta corrección:

| Comando                                                                                     | Resultado                                                                       |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `npm run typecheck` / `npm run lint`                                                        | PASS                                                                            |
| `npx vitest run tests/route-optimization-google.test.ts tests/route-ai-integration.test.ts` | 18/18 PASS; 8.88 s                                                              |
| `npm run test:coverage`                                                                     | 242/242 PASS, 27 archivos; 111.79 s                                             |
| Cobertura global                                                                            | 91.68% declaraciones, 85.59% ramas, 97.31% funciones, 93.14% líneas             |
| Cobertura módulo Google                                                                     | 92.30% líneas y 92.61% ramas; incluye transporte fuera del conjunto de mutación |
| `npm run test:mutation:routing`                                                             | 486/486 detectados, 100%; parser/constructor Google 407/407; 0 supervivientes   |
| `npm run test:e2e` (incluye build)                                                          | PASS; 1/1, 21.5 s prueba, 34.8 s total                                          |
| `npm audit --audit-level=high`                                                              | 0 vulnerabilidades                                                              |
| Formato / `git diff --check`                                                                | PASS                                                                            |

Se amplió el rango de mutación para abarcar el final del parser y sus conteos
agregados. El objetivo de 100% del conjunto se conserva. No se modificaron
dependencias ni persistencia. La latencia registrada corresponde a pruebas locales;
no establece latencia ni calidad de optimización en Google/OpenAI reales.

## QA después del despliegue

1. Desplegar el commit de develop y abrir el plan reportado.
2. Confirmar bodega, hora de salida y puntos; ejecutar Armar ruta una vez.
3. Verificar que se comparen alternativas y los pedidos queden completos, o se
   informe un conflicto real de factibilidad. Verificar versión, ETA y regreso.
4. Si vuelve a fallar la lectura, revisar routingField y requestId del intento.

El smoke externo corresponde al entorno EasyPanel del usuario. La corrección no
requiere migración, cambio de secretos ni modificación de Odoo. Para revertir,
revertir el commit en develop y reconstruir; no borrar datos.

## Referencias

- https://developers.google.com/maps/documentation/route-optimization/reference/rest/v1/ShipmentRoute
- https://protobuf.dev/programming-guides/json/#presence-and-default-values
