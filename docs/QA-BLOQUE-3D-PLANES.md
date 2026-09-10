# QA — bloque 3D: cargas independientes, pedidos reutilizables y borrado de plan

Fecha: 2026-09-09. Rama: `develop`. Ejecución local; sin deploy ni cambios a
`main`.

## Diagnóstico y corrección

- Los botones de carga compartían un booleano visual y la carga manual guardaba
  primero camionetas. Ahora cada acción tiene identidad visual propia; la manual
  ejecuta únicamente `POST /orders/manual` y se retiró «Guardar camionetas».
- La restricción `UNIQUE(source,picking_id,order_id)` hacía global la pertenencia.
  La migración v4 crea primero la unicidad
  `(plan_id,source,picking_id,order_id)` y luego retira la anterior, sin modificar
  filas existentes. Cada plan conserva una copia operativa independiente.
- No existía borrado completo. `DELETE /api/plans/[id]` usa sesión, Origin, JSON,
  expectedVersion, bloqueo y transacción; elimina dependencias locales en orden y
  registra `plan.deleted`.

## Evidencia funcional y visual

- La carga por fecha guarda la selección y después consulta sólo la fecha elegida.
- La carga manual no consulta la fecha ni guarda la selección del formulario.
- Repetir una carga no duplica dentro del mismo plan; el mismo surtido sí entra en
  múltiples planes. Mover o quitar una copia no toca otra.
- Cancelar, cerrar o Escape en «Borrar plan» no escriben. Confirmar lo retira del
  selector y abre otro borrador o el estado vacío.
- Capturas inspeccionadas:
  `reports/screenshots/load-orders-single-date.png` y
  `reports/screenshots/delete-plan-confirmation.png`.

## Puertas y métricas

- TypeScript, ESLint y build standalone Next.js: verdes.
- Vitest con PostgreSQL real desechable: 109/109 pruebas, 12 archivos.
- Cobertura: 96.64% statements, 92.48% branches, 97.05% functions y 97.70%
  lines; `plans.ts` 100% de líneas.
- E2E construido, navegador real y PostgreSQL: 1/1 verde. Verifica solicitudes
  separadas, ausencia del botón redundante, CSRF del DELETE, cancelación,
  confirmación, selector, auditoría y regresión del panel.
- Mutation identidad por plan: 100%, 37 killed + 1 timeout, cero sobrevivientes o
  sin cobertura.
- Mutation borrado de plan: 100%, 23/23 killed, cero sobrevivientes o sin
  cobertura.

## Límites

El E2E usa Odoo deliberadamente sin configurar para observar los contratos sin
simular respuestas externas; las lecturas live 19.4/17 siguen siendo la puerta
externa documentada en el bloque 3C. Esta entrega no escribe Odoo ni despliega
EasyPanel.
