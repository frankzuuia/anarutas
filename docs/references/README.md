# Referencias verificadas 2026-09-08

- Next.js self hosting/runtime env: https://nextjs.org/docs/app/guides/self-hosting
- Next.js authentication: https://nextjs.org/docs/app/guides/authentication
- OWASP passwords: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP sessions: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- EasyPanel apps/environment/runtime: https://easypanel.io/docs/services/app
- Odoo external API: https://www.odoo.com/documentation/17.0/developer/reference/external_api.html (verificar versión desplegada en diagnóstico; no asumir versión por la documentación).
- PostgreSQL transactions/locks: https://www.postgresql.org/docs/current/explicit-locking.html
- PostgreSQL local real para QA: https://github.com/leinelissen/embedded-postgres (dependencia de desarrollo, no producción; sin createPostgresUser).

Decisiones: el env privado se lee al atender solicitudes/arranque, nunca NEXT_PUBLIC ni next.config.env. API key Odoo tiene permisos de su usuario, no un modo mágico read-only. SQL y permisos permanecen en servidor, no quedan a criterio de un LLM.
