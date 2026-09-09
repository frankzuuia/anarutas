# Mínimo de contraseña — S20 / T10 · 2026-09-08

Petición explícita: permitir desde seis caracteres, mantener máximo 128 y permitir creación de usuarios a todos los administradores actuales. Sin modificación de cuentas existentes, hash, sesiones, roles, bootstrap ni protecciones de intentos/CSRF. Se informó de la menor resistencia a adivinación de contraseñas cortas; no se presenta como igual seguridad que 15 caracteres.

## Cambios

`src/core/policy.ts`: mínimo 6 en validación del hash de alta. `auth-form.tsx`, `dashboard.tsx` y `api.ts`: atributos HTML y mensajes alineados. No scripts de migración ni cambios a PostgreSQL del usuario. Sin Odoo, five, vendedores, precios, V3, main, commit, push o despliegue.

## QA reproducible

Ejecutar `npm run build`, `npm run test:coverage`, `npm run lint`, `npm run typecheck`, `npm run test:e2e`, `npm run test:mutation` y `npm audit`.

- 61/61 pruebas unitarias/integración, 5 archivos; 17.62 s.
- Límites 5 rechazado, 6/7/14/15/127/128 aceptados y 129 rechazado. Hash y verificación reales con seis caracteres; contraseñas largas siguen verificando.
- E2E con PostgreSQL aislado y Chrome: 1/1, 9.6 s de recorrido, 18.4 s total. Alta inicial y alta de otro administrador con contraseña QA aleatoria de exactamente seis caracteres; ambas cuentas inician sesión.
- Ambas APIs rechazan cinco caracteres con 400 / PASSWORD_POLICY; no se crea la cuenta rechazada. Formularios muestran minlength=6. Pruebas de revocación, CSRF, concurrencia, borradores y reinicio siguen verdes.
- Cobertura core: 87.44% líneas, 84.18% ramas, 94.33% funciones. Predicados críticos se someten a mutation testing; reporte en reports/mutation.
- Build/types/lint correctos; auditoría npm sin vulnerabilidades reportadas. No nuevas dependencias ni complejidad de control añadida: sólo cambió el umbral de longitud.

Los datos y contraseñas usados en las pruebas son exclusivamente de instalaciones QA loopback. No se guardan contraseñas en logs ni se sustituyen credenciales reales. Los tiempos indicados no son un SLO de producción. Este ajuste no cierra pendientes de despliegue/ruteo de otros bloques.
