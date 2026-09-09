# QA — bloque 3C: pedidos manuales y retiro recuperable

Fecha: 2026-09-09. Rama: `develop`. Ejecución local, sin commit, push o deploy.

## Resultado funcional

- El modal conserva una sola fecha de validación e incorpora una sección compacta
  para hasta 50 folios exactos con prefijo fijo `S`.
- El lote manual omite únicamente `date_done`: mantiene empresa configurada,
  venta sale/done, surtido done, salida outgoing, destino customer, cantidad positiva
  y exclusión de devoluciones.
- Todos los folios deben producir al menos un surtido elegible antes de persistir el
  lote. Las identidades origen+surtido+venta existentes siguen evitando duplicados.
- Cada tarjeta tiene un bote rojo y confirmación accesible. Aceptar elimina sólo la
  copia del borrador, normaliza posiciones, incrementa versión y audita. Cancelar y
  Escape no escriben. Una importación posterior puede recuperar el pedido.

## Compatibilidad Odoo

No existe una rama por número de versión. La sesión de lectura consulta `fields_get`
y selecciona capacidades:

| Instalación | Cantidad detectada | Unidad detectada |
| ----------- | ------------------ | ---------------- |
| Odoo 17     | `quantity`         | `product_uom`    |
| SaaS 19.4   | `quantity`         | `uom_id`         |

La carga por fecha y por folio comparten autenticación, `allowed_company_ids`,
hidratación, notas Studio y la relación estable
`stock.move.sale_line_id → sale.order.line.order_id`. El ejecutor RPC permanece
privado y la prueba AST permite sólo authenticate/read/search_read/fields_get;
`write`, `create` y `unlink` continúan prohibidos.

## Evidencia verde

- TypeScript y ESLint: verdes.
- Build standalone Next.js: verde; ruta dinámica
  `/api/plans/[id]/orders/manual` incluida.
- Vitest con PostgreSQL real desechable: 107/107 pruebas, 12 archivos.
- Cobertura core: 96.22% statements, 92.09% branches, 96.99% functions y
  97.63% lines. La ruta crítica de eliminación verifica actor, versión, asignación,
  auditoría, hueco intermedio, recuperación, conflicto concurrente y ausencia.
- E2E construido con navegador y PostgreSQL real: 1/1 recorrido verde en 27.6 s;
  formulario de dos folios, teclado, cancelación, confirmación, borrado, recuperación,
  reasignación y regresión completa del panel.
- Mutation global: 209 mutaciones, 206 killed + 1 timeout, 0 sobrevivientes,
  score 100%. Mutation de eliminación: 22/22 killed, score 100%.
- `npm audit --omit=dev`: 0 vulnerabilidades.
- `git diff --check`: sin errores de whitespace; sólo advertencias CRLF del checkout.

Capturas:

- `reports/screenshots/load-orders-single-date.png`
- `reports/screenshots/remove-order-confirmation.png`
- `reports/screenshots/planner-seven-{768,1024,1440,1920}.png`

## Puerta externa pendiente

Este checkout no contiene variables Odoo privadas y no se copiaron secretos desde
EasyPanel. Después de publicar en develop se debe ejecutar la carga manual de sólo
lectura contra SaaS 19.4 con folios conocidos y, antes de promover a producción, un
preflight de sólo lectura contra Odoo 17. Esta puerta no autoriza escrituras Odoo ni
promoción a `main`.
