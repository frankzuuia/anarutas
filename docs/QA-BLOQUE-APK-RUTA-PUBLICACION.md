# QA — publicación, fotos, inicio y vista previa de ruta

Fecha de verificación local: 23/09/2026 (America/Mexico_City). Rama `develop`. Este reporte documenta las pruebas locales previas a la publicación de cambios en `develop`; no acredita un despliegue.

## Procedimiento reproducible

Desde la raíz del repositorio:

1. `npm run typecheck`
2. `npm run lint`
3. `npm run build`
4. `npm run test:coverage`
5. `npm run test:mutation:route-start`
6. `npm run test:mutation:route-publications`
7. `npm run test:mutation:unit-photos`
8. `npx playwright test tests/e2e/driver-mobile.spec.ts`

Desde `driver-app` en PowerShell, con Android SDK configurado: `.\gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug`. En esta PC la sesión no hereda `ANDROID_HOME`; se usó `$env:ANDROID_HOME='C:\Users\figod\AppData\Local\Android\Sdk'` sólo para ese proceso.

## Evidencia obtenida

| Puerta | Resultado |
| --- | --- |
| TypeScript, ESLint, build web | Verde, sin errores ni advertencias de lint. |
| Vitest con PostgreSQL real | 43 archivos, 475 pruebas pasadas, incluida migración v14→v15 con ruta iniciada. |
| Cobertura V8 | 95.4% líneas, 94.1% sentencias, 87.72% ramas, 97.54% funciones. Inicio: 100% líneas; publicaciones: 90.78%; fotos: 88.88%. |
| HTTP/E2E Playwright | 2 flujos pasados: publicación, aislamiento móvil, cinco fotos WebP, inicio, revocación y galería administrativa. Se verifica que las cinco imágenes carguen y se decodifiquen, no sólo que exista la etiqueta. |
| Android | Pruebas unitarias, lint y APK debug compilados. Decodificación de polilínea publicada y límite de 25 destinos cubiertos por pruebas JVM. |
| Mutación inicio | 19 mutantes eliminados de 19; 100% en el rango crítico de `route-start.ts`, incluido el filtro por fecha local. |
| Mutación publicación | 97.06% en asignación y cobertura de paradas: 27 eliminados, 6 expiraron por tiempo y 1 sobrevivió. El superviviente fuerza un `UPDATE` del mismo chofer sin cambiar el resultado; no se cuenta como eliminado. |
| Mutación fotos | 20 mutantes eliminados de 20; 100% en validación de fecha local, duplicados y límite de ocho. |
| Diff/secretos | `git diff --check` sin errores. Escaneo de archivos cambiados sin claves privadas reales; la coincidencia en una prueba existente es una cadena ficticia de QA. |

La captura `reports/screenshots/unit-control-390.png` muestra la galería a 390 px con miniaturas decodificadas y tarjetas compactas. El E2E usa fotos de color sintéticas para probar carga, autorización y disposición, no representa una unidad real.

## Escenarios críticos verificados

- Borrador invisible hasta publicación; publicación individual/global idempotente y aislada por chofer.
- Publicado no iniciado editable; iniciada bloqueada en pedidos y borrado, mientras otra camioneta del plan recalcula. La asignación persistente de flota sí puede cambiar para planes futuros sin transferir la ruta iniciada.
- Inicio y reasignación concurrentes: la reasignación de flota se guarda; el inicio corresponde sólo al chofer autorizado en el instante de comenzar. Un chofer relevista no hereda el conteo ni acceso de fotos anteriores.
- El planificador distingue al dueño de la ruta iniciada del nuevo chofer persistente de la camioneta. Una publicación no iniciada para el chofer anterior indica que requiere republicación; ese traspaso no solicita otra optimización si las paradas no cambiaron.
- Fotos JPG procesadas a WebP privado; duplicados, límite de ocho, mínimo cinco, lectura ajena y expiración de quince días.
- El conteo e inicio toman sólo fotos de la fecha de servicio en la zona horaria configurada; se probó el borde donde UTC ya marca el día siguiente pero Guadalajara no. Una carga fuera de fecha devuelve conflicto.
- Control de unidades agrupa las fotos por nombre publicado de ruta y fecha; las horas usan la zona horaria del panel. Cambiar sólo el nombre del borrador no renombra la evidencia capturada.
- La vista previa de la APK decodifica el trazo publicado; abrir mapa no invoca `setDestinations`. Sólo el botón explícito **Iniciar guía** pide destinos al SDK.

## Puertas que siguen abiertas

- No hay dispositivo Android conectado para inspección visual/física de GPS, cámara, permisos, giro por giro y continuidad de guía. La compilación no sustituye esa prueba.
- La cobertura de pruebas Android aún no se midió; las pruebas JVM pasaron, pero no se declara porcentaje ni se considera cerrada la puerta instrumental.
- Develop aún requiere un volumen persistente privado para `RUTAS_UNIT_PHOTO_DIR`; sin él, fotos e inicio fallan cerrados.
- No se ha configurado una clave Android restringida para Navigation SDK. La APK debug actual no ofrece mapa; no se ha generado una solicitud de ruta ni costo de navegación en estas pruebas.
- Antes de distribuir: integrar los avisos `NOTICE.txt` y `LICENSES.txt` exigidos por Google, comprobar el diálogo de términos y advertencias al conductor, y validar que la atribución del mapa permanezca visible en teléfonos reales.
- No hay todavía medición en dispositivo/servicio desplegado de latencia p95, tasa de errores ni conteo de solicitudes facturables. No se proclama un SLO de producción sin esos datos.
- El commit y push a `develop` permiten probar el bloque en ese entorno, pero no equivalen a merge a `main` ni certifican un despliegue. Las puertas anteriores deben cerrarse antes de declarar lista la experiencia completa.

Referencias: [configuración y avisos del Navigation SDK](https://developers.google.com/maps/documentation/navigation/android-sdk/android-studio-setup), [políticas de navegación](https://developers.google.com/maps/documentation/navigation/android-sdk/policies), [interacción con GoogleMap](https://developers.google.com/maps/documentation/navigation/android-sdk/googlemap-interactions-best-practices).
