# QA — observabilidad natural del ruteo

Alcance: Ana Rutas `develop`; salida estándar del servicio `app` visible en
EasyPanel. Sin cambios de esquema ni variables nuevas.

## Evidencia dirigida

- `route-observability.test.ts`: serialización natural por nivel, correlación,
  duración, lista cerrada de detalles y comportamiento fail-open.
- `route-ai-integration.test.ts`: recorrido completo con Ana Rutas, OpenAI,
  Google Route Optimization, Google Routes y PostgreSQL; inicio, avance,
  terminación y fallo versionado.
- La integración niega explícitamente claves, `private_key`, nombre de cliente y
  referencia de domicilio dentro de la salida serializada.

## Resultado local final

| Puerta | Resultado |
| --- | --- |
| Suite con cobertura | 33 archivos, 332 pruebas, 332 aprobadas |
| Cobertura global | 91.27% statements, 84.51% branches, 97.13% functions, 92.65% lines |
| Mutación del logger | 100%; 23 mutantes eliminados, 0 sobrevivientes y 0 sin cobertura |
| Integración de sistemas | PASS; cinco sistemas, inicio, progreso, terminación, fallo y privacidad |
| Lint / TypeScript / build | PASS; 0 errores y 0 advertencias |
| Seguridad de dependencias | `npm audit --audit-level=high`: 0 vulnerabilidades |
| E2E local | 1 PASS; 2 live omitidos por ausencia deliberada de credenciales facturables |

## QA manual después del deploy

1. Abrir `ana-rutas-develop/app` → Logs en EasyPanel.
2. Pulsar **Armar ruta** una vez en el plan de prueba.
3. Filtrar por el `requestId` de la primera línea `routing.request.received`.
4. Confirmar que aparecen los cinco sistemas y que el último evento es
   `routing.completed` con todos los pedidos, o `routing.failed` con etapa y
   código sanitario.
5. Confirmar visualmente que no aparecen secretos ni datos personales.

## Reversión

Revertir el commit de este bloque en `develop`. No hay migraciones ni datos que
revertir.
