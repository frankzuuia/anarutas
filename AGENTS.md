# Ana Rutas

- Repositorio independiente. develop = desarrollo; main = producción.
- No commit, push, merge ni despliegue sin autorización explícita.
- No modificar five, vendedores, listas de precios, V3 ni sus servicios/configuraciones.
- Mismo artefacto en todos los entornos. Configuración en runtime mediante variables de cada instalación; nunca cuentas, hosts, secretos ni IDs de negocio en código.
- Sólo lectura en Odoo en bloque 1. Datos de rutas y cuentas en PostgreSQL dedicado.
- Implementar por bloques aprobados y con evidencia de pruebas. No mocks ni integraciones simuladas.
- El futuro agente decide mediante herramientas nativas de dominio; la autorización e integridad se verifican en el servidor. No adivinar intenciones por regex.
- Consultar docs/PROGRESS.md y docs/MASTER-SPECIFICATION.md antes de continuar.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
