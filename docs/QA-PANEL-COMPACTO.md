# Panel compacto — S19 / T09 · 2026-09-08

Cambio funcional de producto limitado a CSS del panel autenticado. Sin cambios a lógica, API, Odoo, credenciales, bases del usuario o código de five. Sin commit, push ni despliegue. Login conserva sus controles originales. Se conservaron permisos, validaciones y mensajes existentes.

## Diseño aplicado

Guía utilizada: ui-ux-pro-max, para densidad, jerarquía discreta, foco visible, legibilidad y objetivos táctiles. Se conservó la paleta existente y no se importaron tipografías externas, animaciones o dependencias. No se aplicó zoom ni transform para encoger la interfaz.

- Botones principales de escritorio: 34 px; campos de aproximadamente 36 px. En móvil o puntero táctil, mínimo 44 px y campos de 16 px.
- Título del panel 24 px; títulos de tarjetas 16 px; contenido de controles 13 px en escritorio.
- Cabeceras de tarjeta con rellenos 12/16 px, radio 10 px y barra superior mínima de 56 px.
- Barra lateral 196 px (184 px en escritorio estrecho); menos separaciones, estados vacíos menores, bordes sólidos discretos.
- Lista lateral de borradores con altura propia, sin estirarse a la altura total del tablero.

## QA reproducible y evidencia

```powershell
npm run build
npm run test:coverage
npm run lint
npm run typecheck
npm run test:e2e
npm run test:mutation
npm audit
```

- Build, types y lint correctos.
- 59/59 unidades/integración, 5 archivos, 18.39 s.
- Cobertura de core sin cambio: 87.44% líneas, 84.18% ramas, 94.33% funciones. No es cobertura CSS.
- E2E real con Chrome, Next construido y PostgreSQL aislado: 1/1; escenario 11.2 s, ejecución total 21.3 s. Sin mocks ni consultas a Odoo.
- Dimensiones CSS computadas verificadas a 375, 768, 940, 1024 y 1440 px: botones, títulos, radio, foco y ausencia de scroll horizontal tanto en reposo como editando.
- Pruebas existentes de alta/login, dos sesiones, cancelar sin PATCH, guardar, conflicto 409, revocación y reinicio pasaron.
- Mutación de predicados críticos existentes: 40/40 detectados (100%). No se mutó CSS; no se añadió lógica de dominio.
- Auditoría de dependencias: cero vulnerabilidades reportadas.
- QA visual: inspección de `compact-940.png`, `compact-1440.png`, `compact-375.png` y `compact-users.png` en `reports/screenshots`. Capturas adicionales de conexión y editor disponibles allí.
- Servicio local del usuario respondió 200 en `/api/health`. No se alteraron sus cuentas ni sus borradores para probar.

Latencias indicadas pertenecen a QA local, no a un SLO productivo. Persisten los pendientes de integración/despliegue del bloque 1; este ajuste no certifica el ruteo aún no implementado.
