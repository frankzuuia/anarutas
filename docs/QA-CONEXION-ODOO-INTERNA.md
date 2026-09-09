# QA — Conexión Odoo interna sin pestaña administrativa

Fecha: 2026-09-08.

## Alcance

Se retiraron de la interfaz autenticada la opción «Conexión con Odoo», su
diagnóstico y la explicación sobre separación de entornos. El conector cerrado,
la configuración runtime, `/api/odoo`, la autenticación, las restricciones de
sólo lectura y los nombres de eventos históricos permanecen intactos.

No se modificaron variables, credenciales, Odoo, V3, vendedores, listas de
precios ni datos existentes. No hubo commit, push, merge o despliegue.

## Evidencia ejecutada

- `npm run typecheck`: verde.
- `npm run lint`: verde.
- `npm run test:coverage`: 90 pruebas verdes; 91.98% líneas, 88.84% ramas,
  96.42% funciones y 91.89% sentencias.
- `npm run build`: compilación productiva Next 16.3.4 verde; `/api/odoo`
  continúa incluido como endpoint dinámico autenticado.
- `npm audit --omit=dev`: cero vulnerabilidades.
- `npm run test:e2e`: escenario completo verde en 20.8 s con PostgreSQL real.

El E2E verifica que no existe el botón «Conexión con Odoo» y que el endpoint
autenticado continúa respondiendo. En el entorno QA sin credenciales devolvió
`configured: false`, sin iniciar conexiones externas ni ejecutar escrituras.
La navegación real local también se inspeccionó y contiene únicamente las
funciones operativas y administrativas autorizadas.

Mutation testing no se repitió para este ajuste de presentación porque no se
modificó ninguno de los archivos críticos instrumentados. La ejecución vigente
de esos contratos permanece en 100%, con cero mutantes sobrevivientes.
