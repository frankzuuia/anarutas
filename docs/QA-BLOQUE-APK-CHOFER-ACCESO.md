# QA — APK chofer, identidad y lectura de ruta

Fecha de ejecución: 21/09/2026. Rama auditada: `develop`. Este bloque no fue
publicado, migrado ni desplegado. La evidencia corresponde al árbol local y a
PostgreSQL de pruebas; no se llamó Odoo, Google Route Optimization ni Routes.

## Alcance verificado

- Configuración de PIN móvil desde Editar chofer y activación de un solo uso.
- Enrolamiento de dispositivo, desafío firmado, sesión, cierre y revocación.
- Aislamiento por identidad, camioneta y plan; un chofer no puede leer el plan
  de otro ni decidir su propio `driver_id` o `vehicle_id`.
- Cliente Android nativo: origen HTTPS dinámico, teléfono + PIN, Android
  Keystore, listado de rutas y pedidos reales de la camioneta asignada.
- Estado móvil retenido durante recreación de la actividad mediante
  `ViewModel`; PIN y código permanecen únicamente en memoria y no se guardan.
- Estados `current`, `stale`, `not_calculated`, vacío, error y sesión revocada
  se presentan sin inventar una asignación o una entrega.

## Evidencia automatizada

| Puerta                    | Comando / evidencia                                                   | Resultado                                                                |
| ------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Tipos web/API             | `npm run typecheck`                                                   | PASS                                                                     |
| Lint web/API              | `npm run lint`                                                        | PASS, 0 errores; se eliminó la advertencia del config móvil              |
| Integración móvil real    | `npx vitest run tests/driver-mobile.test.ts`                          | PASS, 6/6 con PostgreSQL real y firmas EC                                |
| HTTP + UI admin           | `npx playwright test tests/e2e/driver-mobile.spec.ts`                 | PASS, 2/2                                                                |
| Build Next                | `npm run build`                                                       | PASS; endpoints móviles incluidos                                        |
| Dependencias runtime Node | `npm audit --omit=dev --audit-level=high`                             | PASS, 0 vulnerabilidades                                                 |
| Cobertura global          | `npm run test:coverage`                                               | 456/456; líneas 95.61%, ramas 87.5%, funciones 98.01%, statements 94.52% |
| Mutación móvil            | `npm run test:mutation:driver-mobile`                                 | PASS, 93.75% global; ruta 100%; umbral 80%                               |
| Android                   | `.\gradlew.bat testDebugUnitTest assembleDebug lintDebug --no-daemon` | PASS, 51 tareas; 6/6 pruebas Android; lint verde                         |
| Firma APK                 | `apksigner verify --verbose --print-certs`                            | PASS, APK Signature Scheme v2; certificado debug                         |

La mutación produjo `reports/mutation/driver-mobile.html` y
`reports/mutation/driver-mobile.json`. Los cinco mutantes sobrevivientes y uno
sin cobertura están en validación defensiva de teléfono/encoding del pepper;
el puntaje final supera el umbral y el aislamiento de lectura de ruta obtuvo
100%.

## Artefacto Android de prueba

- Ruta: `driver-app/app/build/outputs/apk/debug/app-debug.apk`
- Tamaño: 15,501,138 bytes.
- SHA-256:
  `B5DB1846C10FCACB5CC23BC9E526D36BFFD45F3C1E8093B8370FE15E62A621F3`.
- Paquete: `com.five.anarutas.driver`, versión `0.1.0` (`versionCode 1`).
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
2. Conectar contra el entorno `develop` HTTPS, nunca producción.
3. Habilitar un chofer de prueba, generar un código y activarlo una vez.
4. Verificar entrada posterior con teléfono + PIN y firma del mismo celular.
5. Girar la pantalla durante activación y durante carga; no debe duplicar la
   solicitud ni consumir nuevamente el código.
6. Confirmar que sólo aparecen la camioneta, plan y pedidos asignados.
7. Revocar acceso desde administración y comprobar rechazo inmediato.
8. Probar pérdida/restauración de red, error de servidor y ruta sin cálculo.

La prueba física es condición de salida. También faltan firma release,
distribución administrada y configuración de `RUTAS_DRIVER_PIN_PEPPER` en el
entorno objetivo. Ninguno de esos pasos se ejecuta sin autorización expresa.
