# QA — Bloque 2A: flota, choferes y documentos privados

Fecha: 2026-09-08.

## Alcance cerrado

El bloque implementa la migración aditiva v2, camionetas, choferes, asignación
actual exclusiva, fotos/licencia privadas y sus pantallas compactas. No incluye
clientes, carga de pedidos Odoo, selección diaria de unidades, optimización,
mapas, APK o asistente. No modifica `five`, V3, vendedores ni listas de precios.

## Evidencia ejecutada

- `npm run typecheck`: verde.
- `npm run lint`: verde, cero errores y cero advertencias.
- `npm test -- --run`: 8 archivos y 90 pruebas verdes en 24.40 s.
- `npm run test:coverage`: 90 pruebas verdes; 91.98% líneas, 88.84% ramas,
  96.42% funciones y 91.89% sentencias.
- `npx stryker run stryker.fleet.config.mjs`: 142 mutantes instrumentados;
  131 eliminados, 4 timeouts detectados, cero sobrevivientes y puntuación 100%.
- `npm run build`: compilación productiva Next 16.3.4 verde.
- `npm audit --omit=dev`: cero vulnerabilidades.
- `npm run test:e2e`: recorrido completo verde en Chrome, con Next construido y
  PostgreSQL temporal real; 1 escenario en 18.6 s.

El E2E comprobó alta inicial, contraseña de seis caracteres, dos sesiones,
CSRF, borradores, revocación, alta/edición de dos camionetas, registro y
asignación de chofer, rechazo de doble asignación, conflicto de versión,
documentos WebP privados, rechazo de origen/contenido/versión inválidos y
ausencia de desbordamiento a 375, 940 y 1440 px.

La ampliación F-T06 comprobó además que el interruptor de disponibilidad usa
el contrato PATCH versionado existente, conserva siempre el texto
«Disponible»/«No disponible», persiste al recargar y respeta el rechazo
`UNASSIGN_FIRST` cuando hay chofer asignado. La tarjeta muestra la foto privada
del chofer autenticado y conserva el avatar neutro cuando no existe foto. El
recorrido E2E completo quedó verde en 22.8 s.

## Regresión real de la instalación local

El preview se detuvo después de apagar PostgreSQL con `pg_ctl -m fast`, se
construyó el proyecto y se levantó de nuevo usando el mismo directorio privado.
Una consulta exclusivamente `SELECT` confirmó: esquema v2, una cuenta y un
borrador preservados; en ese momento aún no se había registrado flota en esa
instalación. Los registros de prueba incorporados posteriormente se conservaron
sin migraciones destructivas.

## Hallazgos corregidos durante QA

La aplicación ya renderizaba el chofer ocupado como `option disabled` y el
servidor rechazaba la segunda asignación con 409. Playwright no reconoció el
estado mediante `toBeDisabled()` sobre `option`; la prueba ahora verifica el
atributo y la propiedad nativa `HTMLOptionElement.disabled`. También se alineó
el aserto de conflicto con el texto visible real. No se cambió la lógica de la
aplicación para satisfacer las pruebas.

## Evidencia visual

Las capturas generadas por el E2E están en `reports/screenshots/` y permanecen
ignoradas por Git. Se revisaron las vistas de tarjetas, formulario de camioneta
y documentos en escritorio, tableta y móvil. Los controles conservan foco,
contraste, densidad compacta y desplazamiento vertical sin desbordamiento
horizontal.

## Pendientes fuera de 2A

Siguen pendientes las puertas generales de integración Odoo live sólo lectura,
imagen Docker/Linux, backup/restauración y configuración real de EasyPanel. No
se autoriza commit, push, merge o despliegue con este cierre documental.
