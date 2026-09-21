# QA — APK chofer, identidad y lectura de ruta

Fecha de ejecución: 21/09/2026. Rama auditada: `develop`. Esta actualización
corresponde al árbol local y a PostgreSQL de pruebas; no se llamó Odoo,
Google Route Optimization ni Routes. El smoke test en Android físico sigue pendiente.

## Alcance verificado

- Configuración de PIN móvil desde Editar chofer y acceso directo con teléfono.
- Enrolamiento automático de dispositivo, desafío firmado, sesión, cierre y revocación.
  Tras un cambio de PIN o pérdida de clave local, el siguiente acceso con teléfono
  y PIN vuelve a vincular el celular sin código adicional.
- Aislamiento por identidad, camioneta y plan; un chofer no puede leer el plan
  de otro ni decidir su propio `driver_id` o `vehicle_id`.
- Cliente Android nativo: origen HTTPS fijado por compilación, teléfono + PIN, Android
  Keystore, listado de rutas y pedidos reales de la camioneta asignada.
- Estado móvil retenido durante recreación de la actividad mediante
  `ViewModel`; el PIN permanece únicamente en memoria y no se guarda.
- Estados `current`, `stale`, `not_calculated`, vacío, error y sesión revocada
  se presentan sin inventar una asignación o una entrega.

## Evidencia automatizada

| Puerta                    | Comando / evidencia                                                   | Resultado                                                                |
| ------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Tipos web/API             | `npm run typecheck`                                                   | PASS                                                                     |
| Lint web/API              | `npm run lint`                                                        | PASS, 0 errores; se eliminó la advertencia del config móvil              |
| Integración móvil real    | `npx vitest run tests/driver-mobile.test.ts tests/driver-mobile-phone-migration.test.ts` | PASS, 9/9 con PostgreSQL real, migración y firmas EC |
| HTTP + UI admin           | `npx playwright test tests/e2e/driver-mobile.spec.ts`                 | PASS, 2/2                                                                |
| Build Next                | `npm run build`                                                       | PASS; endpoints móviles incluidos                                        |
| Dependencias runtime Node | `npm audit --omit=dev --audit-level=high`                             | PASS, 0 vulnerabilidades                                                 |
| Cobertura global          | `npm run test:coverage`                                               | 460/460; líneas 95.71%, ramas 87.84%, funciones 98.01%, statements 94.66% |
| Mutación móvil            | `npm run test:mutation:driver-mobile`                                 | PASS, 90.09%; 100 muertos, 11 supervivientes, 0 sin cobertura/errores    |
| Android                   | `.\gradlew.bat testDebugUnitTest assembleDebug lintDebug --no-daemon` | PASS, 53 tareas; 5/5 pruebas Android; lint verde                         |
| Firma APK                 | `apksigner verify --verbose --print-certs`                            | PASS, APK Signature Scheme v2; certificado debug                         |

La medición dirigida cubre identidad telefónica, rechazo de enrolamientos
inválidos, alta atómica/idempotente de dispositivo y migración v11. Los once
supervivientes restantes no ocultan caminos sin ejecutar: el reporte registró
cero mutantes sin cobertura y superó el umbral de ruptura de 80%.

## Artefacto Android de prueba

- Ruta: `driver-app/app/build/outputs/apk/debug/app-debug.apk`
- Tamaño: 11,708,462 bytes.
- SHA-256:
  `FE3E618639B8CF70112F1B417B07BFB230258F334905D4CAB96A57061763301F`.
- Paquete: `com.five.anarutas.driver`, versión `0.1.1` (`versionCode 2`).
- `minSdk 26`, `targetSdk 36`, `compileSdk 37`.
- Permiso funcional declarado: `android.permission.INTERNET`.
- Es una APK **debug**; no es una firma ni un artefacto de producción.

## Segunda revisión con DeepSeek mediante DeepAstra

Se ejecutó una llamada real, pagada y de sólo lectura a DeepSeek V4.1 Flash,
razonamiento Max, sobre una copia aislada de los 13 archivos Android y de
especificación autorizados. Run ID `20260921T173122Z-f685f212`: 15 llamadas a
herramientas de lectura, cero comandos, cero escrituras y cero violaciones de
alcance. Estimación del launcher: USD 0.0260907–0.0521814; no es recibo oficial
del proveedor.

Codex comparó cada hallazgo con el repositorio real. Se descartó la sospecha
de incompatibilidad JSON porque la API implementa deliberadamente
`service_date`/conteo en listado y `serviceDate`/arreglo en detalle. Sí se
confirmaron y corrigieron: vacío junto con error, reentradas por doble toque,
estado perdido al rotar, error persistente al volver, mensajes ambiguos,
tema claro bajo UI oscura y valores JSON nulos.

## QA manual pendiente antes de distribución

1. Instalar esta APK debug en un Android físico API 26 o superior.
2. Confirmar que la APK conecta al HTTPS de `develop` sin pedir dirección al chofer.
3. Habilitar un chofer de prueba y establecer su PIN desde administración.
4. Entrar por primera vez únicamente con teléfono de diez dígitos + PIN y
   verificar que el celular se vincula automáticamente.
5. Verificar la entrada posterior con teléfono + PIN y firma del mismo celular;
   un reintento concurrente no debe duplicar el dispositivo.
   Simular pérdida de respuesta en el primer acceso y confirmar que el siguiente
   intento reutiliza la clave del mismo celular.
6. Confirmar que sólo aparecen la camioneta, plan y pedidos asignados.
7. Revocar acceso desde administración y comprobar rechazo inmediato.
8. Cambiar el PIN desde administración; el siguiente ingreso con el PIN nuevo debe
   registrar el celular automáticamente. Un PIN erróneo no debe desbloquearlo.
9. Probar pérdida/restauración de red, error de servidor y ruta sin cálculo.

La prueba física es condición de salida. También faltan firma release y
distribución administrada. `RUTAS_DRIVER_PIN_PEPPER` debe estar configurada en
el servidor objetivo; nunca se incluye en la APK.
