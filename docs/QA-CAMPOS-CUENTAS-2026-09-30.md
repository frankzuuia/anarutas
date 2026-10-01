# Nombre y usuario de cuentas internas

Fecha: 2026-09-30. Base develop6f68cb7. Solicitud posterior al ajuste APK0.8.10; se modifica únicamente marcado del formulario web, regresión y documentación.

## Causa comprobada

El formulario de Ana Rutas usa name/login de texto; el servidor normaliza el usuario con NFKC y minúsculas y no exige correo. La captura muestra «Nuevo correo electrónico alternativo», la sugerencia de Email Aliases de Brave. El [código oficial AddEmailAliasSuggestsion](https://github.com/brave/brave-core/blob/master/chromium_src/chrome/browser/ui/autofill/chrome_autofill_client.cc) ofrece alias si encuentra un formulario de alta y su campo username, incluso con tipo text. La [descripción oficial de Brave](https://brave.com/privacy-updates/39-email-aliases/) confirma que es una función del navegador.

Los campos anteriores tenían sólo autocomplete off e identificadores genéricos, sin IDs propios. Se añade type/text e inputMode/text explícitos, IDs y labels asociados, y autocomplete section-routes/section-settlement con name, username y new-password. Se aclara «Usuario interno; no requiere correo electrónico» mediante texto vinculado a su campo. Nombre y usuario conservan sus límites y el contrato FormData anterior.

Esto elimina la ambigüedad del marcado, pero no garantiza ocultar la sugerencia nativa de Brave en un username de registro. No se modifican preferencias globales del navegador, no se fuerza readonly ni se engaña al gestor de contraseñas. El aviso no impide crear una cuenta con usuario sin @. No atribuir a la aplicación una validación de correo que no existe.

## Verificación

Aprobados: typecheck, ESLint (0errores/1advertencia preexistente), build Next y E2E real completo contra PostgreSQL (1/1,21.4s). El recorrido de liquidación ahora crea administrador de rutas y liquidador con nombres acentuados y usuarios con espacios sin @, comprueba los datos guardados y autentica cada cuenta en contexto separado. Pasaron los permisos de ambos roles, identidad de campos, required, accesibilidad y conservación del borrador del otro formulario. Captura real del panel revisada, campos y ayuda legibles; no se certifica desaparición del popup nativo de Brave.

Comandos desde raíz:

```powershell
npm run typecheck
npm run lint
npm run build
npx playwright test tests/e2e/settlements.spec.ts
```

El dominio de cuentas y las políticas no cambian; las28pruebas de unidad/PG ejecutadas en esta sesión cubren pagos y roles. No hay migración ni nueva lógica crítica para mutation testing adicional. La cobertura/mutación monetaria permanece en QA-LIQUIDACION-COMPLETA-0.8.9.md y QA-CAPTURA-COBRO-0.8.10.md. Complejidad, latencia de autenticación y SLO no cambian por declarar atributos HTML; no se inventan nuevas métricas de producción.

Evidencia: `.local/account-fields-{typecheck,lint,build,e2e}.log` y captura `.local/qa-settlements/accounts.png`. No se crean cuentas en el servidor desplegado durante estas pruebas, ni se registra la contraseña de las cuentas temporales. Despliegue manual de develop por el propietario; no requiere volver a generar APK0.8.10.

QA de navegador del propietario: después del deploy, recargar el panel, escribir nombre completo y usuario interno en ambos formularios y comprobar que no hay validación de correo. La sugerencia nativa de Brave puede aparecer en Usuario y se puede ignorar; su desaparición no está certificada por las pruebas Chromium de la aplicación.
