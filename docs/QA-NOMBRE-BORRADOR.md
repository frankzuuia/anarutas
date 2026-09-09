# QA — nombre del borrador · 2026-09-08

## Alcance

S18 / T08: edición explícita con «Cambiar nombre»; no se muestra un formulario de guardado permanente. Nuevo componente `src/components/draft-name.tsx` y conexión en Dashboard con clave por ID/versión. Se mantiene intacto el PATCH de planes, sus permisos, control de versión, SQL y auditoría. Se deshabilita seleccionar otro borrador mientras hay una operación en curso.

La guía ui-ux-pro-max orientó la acción secundaria, foco del campo, retorno de foco al cancelar y revisión responsive. Master Architect mantuvo el alcance y la evidencia del ajuste separados de los bloques pendientes. No se modificaron cuentas/bootstrap, Odoo, five, vendedores, precios, V3, credenciales o despliegues. Sin commit/push.

## Reproducción

Desde la raíz de Ana Rutas, con las dependencias instaladas y Chrome disponible:

```powershell
npm run test:coverage
npm run lint
npm run build
npm run typecheck
npm run test:e2e
npm run test:mutation
npx tsx scripts/quality-metrics.ts
npm audit
```

E2E inicia Next construido y PostgreSQL real en puertos loopback disponibles, con cuentas y borradores QA aislados. No consume el Odoo del shell ni la base de la vista local del usuario; no intercepta/responde ficticiamente solicitudes. Conservar acceso privado a `.local`; contiene bases QA y configuración local ignoradas por git.

## Evidencia y métricas

| Comprobación                                       | Resultado                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Unidades/integración                               | 59/59, 5 archivos, 16.37 s                                                                                          |
| Nuevas unidades de presentación                    | 3/3: vista inicial cerrada, escape de título y acción deshabilitada                                                 |
| Cobertura medida de core                           | Líneas 87.44%, ramas 84.18%, funciones 94.33%, sentencias 87.08%                                                    |
| E2E real completo                                  | 1/1, escenario 8.6 s; ejecución 18.4 s                                                                              |
| Mutation testing de predicados críticos existentes | 40/40 detectados, 100%, cero sobrevivientes                                                                         |
| Build / types / lint                               | Sin errores                                                                                                         |
| Auditoría npm completa y producción                | 0 vulnerabilidades reportadas                                                                                       |
| Escaneo de secretos locales conocidos              | 13 archivos cliente inspeccionados; ninguna coincidencia                                                            |
| Complejidad estimada existente                     | Máximo 21 sobre 37 funciones nombradas de core; no se modificó core                                                 |
| QA visual                                          | Revisadas capturas de escritorio cerrado y móvil abierto; sin recorte/scroll horizontal en 375, 768, 1024 y 1440 px |

La cobertura y mutación anteriores corresponden a core, no a todas las ramas del componente React. La interacción nueva se verifica con navegador real. Los tiempos son de QA local, no un SLO productivo ni latencia aislada de la API. No se certifican el conector Odoo live, Linux/Docker u otros bloques todavía pendientes.

## Recorridos comprobados

- Crear un borrador muestra el título ya guardado y ninguna caja/botón de guardar nombre.
- Abrir «Cambiar nombre» enfoca el campo con el valor actual; vacío o sin cambio no permite guardar.
- Cancelar y Escape descartan el texto, devuelven el foco y generan cero PATCH.
- Enter guarda una sola actualización con mismo ID/fecha y versión incrementada, actualiza título/lista y cierra el editor.
- Segunda sesión con versión anterior recibe 409 real; conserva su texto y no sobrescribe. Puede cancelar, actualizar y abrir el borrador vigente.
- Cambiar de borrador no traslada el texto pendiente ni genera escritura.
- Auditoría: un cambio de nombre registrado; cancelaciones/conflicto sin cambios de dominio.
- Se mantienen acceso en dos navegadores, CSRF, revocación de sesiones y persistencia tras reiniciar el proceso.

Primer intento de E2E: falló un selector de prueba ambiguo entre el aviso de conflicto y el anunciador de Next. Se acotó al texto del conflicto; repetición completa verde, sin modificar el comportamiento del sistema por ese fallo.

Capturas en `reports/screenshots/panel-desktop.png`, `panel-mobile.png`, `rename-open-375.png` y `rename-open-1440.png`; reporte Playwright en `playwright-report`, cobertura en `coverage`, mutación en `reports/mutation`.
