# QA — Bloque 4 Clientes, horarios y puntos

Fecha de cierre: 2026-09-10. Rama evaluada: `develop`. Alcance: BL-018..024.

## Resultado

El bloque local está aprobado para subir a `develop`. No se hizo despliegue, no se escribió en Odoo y no se tocó `main`, Five, Ana V3 ni Luna.

| Puerta                  | Evidencia                                                                              | Resultado                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Lint                    | `npm run lint`                                                                         | Verde, cero errores y cero advertencias                                                              |
| Tipos                   | `npm run typecheck`                                                                    | Verde                                                                                                |
| Unitarias e integración | `npm test`                                                                             | Verde; 17 archivos y 126/126 pruebas, PostgreSQL embebido real, sin mocks de persistencia            |
| Cobertura               | `npm run test:coverage`                                                                | Verde; 96.78% líneas, 97.04% funciones, 86.99% ramas y 95.54% sentencias                             |
| Mutación crítica        | `npm run test:mutation:customers`                                                      | 100%; 109 mutantes, 108 muertos, 1 timeout detectado, 0 supervivientes, 0 sin cobertura              |
| E2E                     | `npm run test:e2e`                                                                     | Verde; 1/1 recorrido integral, navegador real y servidor de producción local                         |
| Build                   | `npm run build`                                                                        | Verde; rutas API nuevas incluidas                                                                    |
| Dependencias            | `npm audit --audit-level=low`                                                          | 0 vulnerabilidades conocidas                                                                         |
| Rendimiento             | `npx vitest run tests/customers-performance.test.ts --reporter=verbose --silent=false` | 10,000 clientes; búsqueda p95 11.45 ms local y exportación paginada 373 ms, SLO de búsqueda <=300 ms |

## Casos comprobados

- Identidad estable por huella de origen + ID Odoo; nombres repetidos permanecen separados.
- Sincronización añade identidades y refresca únicamente la copia fuente; alias, teléfono, nota, prioridad, domicilio, ventanas, punto y archivo locales no se pisan.
- Búsqueda ignora acentos, mayúsculas y espacios; incluye alias, Odoo, referencia, teléfonos, matriz y domicilio.
- Horarios inequívocos de 24 horas. `11:00–13:00` se persiste como 660–780 minutos; se rechazan forma inválida, días duplicados, inversión y traslape, incluyendo sábado/domingo.
- Edición y archivo/restauración usan versión optimista; una escritura obsoleta recibe 409 sin pérdida.
- Domicilio editado invalida coordenadas anteriores. Sólo un punto confirmado se consume en tablero/mapa; se conserva historial versionado.
- El tablero resuelve la preferencia vigente del destinatario sin alterar el snapshot del pedido ni planes anteriores.
- XLSX de clientes y plan se genera y vuelve a abrir; neutraliza contenido que inicia con `=`, `+`, `-` o `@`.
- Directorio, configuración de Maps y ambas exportaciones exigen sesión. Las mutaciones rechazan Origin ajeno sin cambiar la versión.
- E2E cubre 375, 768, 1024 y 1440 px para clientes, además de regresión del planificador con siete camionetas y 25 pedidos.
- El editor puede ocultarse sin escritura, protege cambios pendientes mediante confirmación, deja el directorio a ancho completo, no se reabre al buscar y vuelve al seleccionar una fila. La barra conserva únicamente Exportar Excel; Importar Excel no existe en la interfaz ni en sus rutas.
- Archivar y los botes de ventanas se validan a 28 px en escritorio y 44 px en viewport táctil/estrecho, sin cambiar la semántica, confirmaciones ni foco visible.

Los escenarios de aceptación están en `tests/acceptance.feature` y cubren sincronización, 24 horas, archivo/restauración, punto confirmado, exportaciones, concurrencia y seguridad.

## Compatibilidad Odoo y límites externos

- El conector sigue siendo sólo lectura. La sesión básica de partners está separada de la negociación de inventario/pedidos.
- `fields_get` decide en ejecución qué campos existen; nunca se solicita `mobile`, jerarquía o domicilio si la instalación no los expone. Los contratos prueban presencia/ausencia y fallo cerrado de identidad/compañía para soportar las diferencias entre Odoo 17 y SaaS 19.4.
- El repositorio sólo contiene `.env.example`; no existen credenciales locales para ejecutar un smoke contra develop 19.4 ni producción 17. Esos dos smoke son una puerta de promoción, no una prueba que se pueda declarar verde aquí.
- Google Maps no está configurado. La interfaz muestra el estado pendiente y no inventa coordenadas. Activar Maps requiere clave restringida en EasyPanel y smoke de geocodificación, arrastre y confirmación.
- La aplicación del chofer aún no tiene identidad/flujo productivo. El modelo de ubicación e historial queda versionado para que el futuro endpoint autenticado reutilice el mismo punto; no se publicó un endpoint inseguro de chofer.
- `DIrectorio Clientes.xlsx` no se importó. Antes de escribir en producción se debe leer el directorio Odoo real, generar una vista previa por ID y resolver ambigüedades; la escritura será únicamente en la base de Ana Rutas.

## Procedimiento reproducible de promoción

1. Ejecutar lint, typecheck, suite, cobertura, mutación, E2E, build y auditoría con los comandos de la tabla.
2. En develop 19.4, configurar secretos en EasyPanel y ejecutar sincronización read-only de varias páginas; verificar conteo, jerarquía, teléfonos y reintento idempotente.
3. Configurar una clave Google restringida al dominio develop y a las APIs necesarias; confirmar que cambiar domicilio invalida el pin y que el nuevo punto exige confirmación.
4. Antes de producción, ejecutar el mismo preflight read-only en Odoo 17 y revisar diferencias de `fields_get` y compañía.
5. Respaldar la base de Ana Rutas; generar vista previa del Excel por IDs Odoo; no escribir Odoo.
6. Sólo promover `develop` a `main` con todas las puertas externas verdes o una excepción explícita documentada.
