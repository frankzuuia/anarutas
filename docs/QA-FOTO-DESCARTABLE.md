# QA — eliminar foto de unidad antes de iniciar

## Escenarios de aceptación

```gherkin
Feature: Descartar una foto de salida equivocada
  Scenario: Chofer reemplaza una foto borrosa
    Given tiene una ruta publicada sin iniciar y cinco fotos propias visibles
    When elige la foto borrosa, confirma Eliminar foto y toma una nueva
    Then la primera foto ya no aparece ni es accesible
    And el conteo pasa de cinco a cuatro y de nuevo a cinco
    And Iniciar ruta sólo se habilita con las cinco fotos persistidas

  Scenario: Chofer conserva la foto
    Given abrió la confirmación de una foto
    When pulsa Conservar foto
    Then no se envía DELETE ni cambia el conteo

  Scenario: Ruta ya iniciada
    Given la ruta ya fue iniciada
    When intenta borrar una foto mediante una petición directa
    Then el servidor responde 409 y conserva el registro y el WebP
    And la APK no muestra la acción Eliminar

  Scenario: Inicio y borrado simultáneos con cinco fotos
    Given la ruta tiene exactamente cinco fotos
    When llegan a la vez Iniciar ruta y Eliminar foto
    Then sólo una acción se confirma
    And jamás queda una ruta iniciada con cuatro fotos

  Scenario: Foto ajena o antigua
    Given una foto de otro chofer, plan, unidad o día de servicio
    When el chofer intenta borrarla
    Then recibe 404 sin información del propietario
    And el archivo y metadato permanecen intactos
```

## Ejecución y puertas

1. `npm run typecheck`, `npm run lint`, `npm run test:coverage`, `npm run build`.
2. `npm run test:e2e -- tests/e2e/driver-mobile.spec.ts` con PostgreSQL real; verificar 401/404/409, 5→4→5, archivo privado y pantalla admin.
3. `npm run test:mutation:unit-photo-deletion` para permisos, estado y conteo; `npm audit --omit=dev --audit-level=high`.
4. En `driver-app/`: `./gradlew.bat testDebugUnitTest assembleDebug lintDebug`. Instalar la APK actualizada sobre la anterior y comprobar en Android físico miniatura, confirmación, accesibilidad, borrado, reintento sin red y ausencia de Eliminar tras iniciar.
5. En develop, desplegar backend con volumen privado y repetir el flujo con foto de cámara real. La prueba física y la latencia p95 no se infieren del emulador ni de unitarias.

Métricas objetivo: cero borrados cruzados, cero inicios con menos de cinco fotos, cero fotos borradas accesibles, cero llamadas Google/Odoo por DELETE, 100 % de predicados de permiso/estado cubiertos por integración y mutation score dirigido ≥80 %. Revisar `Server-Timing` para latencia p95 y errores 401/404/409/503 en logs de develop.

## Evidencia local del 23/09/2026

- `npm run test:coverage`: 43 archivos y 487 pruebas verdes; 95.65 % líneas, 88.13 % ramas globales. `unit-photos.ts`: 93.65 % líneas, 84.81 % ramas.
- `npm run test:mutation:unit-photo-deletion`: 93.94 % (25 mutantes eliminados, 6 por timeout, cero sobrevivientes, dos ramas defensivas sin cobertura por estados excluidos por claves foráneas/serialización).
- `npm run test:e2e -- tests/e2e/driver-mobile.spec.ts`: 2/2 verdes con PostgreSQL real y API HTTP, incluido 401/409, recaptura y conteo 5→4→5.
- `./gradlew.bat testDebugUnitTest assembleDebug lintDebug --no-daemon`: verde para APK 0.2.3; `npm run typecheck`, `npm run lint` y `npm audit --omit=dev --audit-level=high` verdes, cero vulnerabilidades reportadas.
- Aún pendiente: instalación y QA visual/físico en el teléfono, medición p95 en develop y prueba del volumen real tras Deploy. No declarar producción lista con esta evidencia local.
