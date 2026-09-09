# QA — bloque 3A pedidos surtidos

Fecha: 2026-09-09. Rama local: develop. Sin commit, push ni despliegue.

## Resultado funcional

- Conector real, sólo lectura, contra vegetables3 saas~19.4+e.
- Rango local 2026-09-08 en America/Mexico_City: 7 salidas de cliente
  inspeccionadas, 7 envíos construidos, 27 partidas y 0 excluidas en 5,268 ms.
- Se conservaron S00001..S00007 como siete pedidos: Progreso 2, Fonda Martha 2,
  Café El Paraíso 1, Cocina San Miguel 1 y Taquería Los Arcos 1.
- La fuente fue stock.picking done/outgoing/customer con date_done; las partidas
  fueron stock.move done, quantity positiva, enlazadas a sale_line_id y sin retorno.
- No se ejecutó ningún método Odoo write/create/unlink. El contrato estático falla
  si aparece alguno de esos métodos.

## Persistencia e integridad

- Migración v3 probada desde v1 y v2 concurrentemente, preservando cuentas,
  borradores y flota.
- Identidad global source+picking+order, carga repetida y competencia entre dos
  planes verificadas con PostgreSQL 17 real.
- Dos pedidos del mismo cliente permanecen separados; recargar conserva su
  asignación. Quitar una camioneta devuelve sus pedidos a Sin asignar.
- Ventanas y prioridad quedan null y visibles como pendientes.
- Versiones y actor activo verificados en selección/movimiento; auditoría para
  carga, selección de flota y movimiento.

## Puertas ejecutadas

- `npm test`: 10 archivos, 96 pruebas verdes.
- `npm run test:coverage`: líneas 98.40%, statements 95.07%, funciones 96.42%,
  branches 90.32%. El adaptador de red odoo.ts no participa en la cifra local:
  se valida con lectura live y contrato AST para evitar una integración simulada.
- `npm run test:mutation`: 100%, 120 mutantes eliminados, 1 timeout equivalente,
  0 sobrevivientes y 0 sin cobertura, sobre seguridad y validación de pedidos.
- `npm run test:e2e`: navegador real + PostgreSQL real; dos sesiones, modal de
  camionetas, tarjeta, asignación, concurrencia y reinicio verdes; screenshots
  375/1440 px, sin desbordamiento del documento.
- `npm run typecheck`, `npm run lint`, `npm run build`: verdes. Next generó
  `/api/plans/[id]/orders` y `/api/plans/[id]/vehicles` como rutas dinámicas.
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilidades.

## Límite del bloque y siguiente conexión

Este bloque carga y permite administrar pedidos. Aún no afirma que la asignación
manual sea una ruta óptima. Google Route Optimization requiere OAuth/IAM, proyecto
con facturación, domicilios geocodificables y punto de inicio. El almacén Odoo
vegetables3 (warehouse 1, partner 1) fue leído y no tiene calle, ciudad ni código
postal. Antes de activar «Armar ruta con IA» se requiere el domicilio real de salida
y la configuración Google propia de Ana Rutas. La API devuelve asignación por
vehículo, orden, métricas y envíos omitidos; el siguiente bloque debe aplicar el
resultado con versión y conservar edición manual.
