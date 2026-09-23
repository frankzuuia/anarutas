# Cancelación administrativa de inicio — QA

## Contrato

El administrador activo puede cancelar **una** camioneta iniciada, con versión de plan y revisión de publicación esperadas. La operación transaccional revoca la publicación, incrementa su revisión, limpia el estado de inicio y audita quién canceló y cuándo. No modifica otras camionetas ni borra fotos. La APK consulta publicaciones mientras está en primer plano, cada 30 s y al volver a la app; esta consulta no llama a Google. Un teléfono sin conexión no puede reflejar la revocación hasta reconectarse, pero las API de lectura, fotos e inicio la rechazan desde el commit.

La migración v17 mantiene la guarda de PostgreSQL contra mutaciones directas de rutas iniciadas; sólo acepta la transición exacta de cancelación en una transacción administrativa marcada localmente. Al republicar se conserva la identidad `(plan,camioneta)` y se incrementa otra vez la revisión para invalidar peticiones viejas de la APK.

## Aceptación (Gherkin)

```gherkin
Feature: Cancelar inicio accidental de una ruta
  Scenario: Revocación autorizada
    Given una camioneta publicada, iniciada y con cinco fotos vigentes
    When el administrador confirma cancelar esa ruta con versiones actuales
    Then el chofer deja de verla en Inicio y Ruta
    And las API de pedidos, fotos e inicio ya no la entregan
    And las fotos siguen visibles en Control de unidades
    And el administrador puede mover sus pedidos y republicar

  Scenario: Competencia con cambios de estado
    Given una ruta iniciada
    When dos administradores intentan cancelarla con la misma revisión
    Then sólo una transacción la revoca
    And la segunda recibe conflicto o ruta retirada
    And se registra un solo evento de cancelación

  Scenario: Petición atrasada de la APK
    Given una ruta cancelada y republicada
    When el celular intenta iniciar con la revisión anterior
    Then recibe conflicto y no inicia la nueva publicación

  Scenario: No se cancela otra camioneta
    Given dos camionetas en el mismo plan
    When administración cancela sólo una ruta iniciada
    Then la otra conserva intactos su publicación e inicio
```

## Procedimiento reproducible

1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:coverage`.
2. `npm run build` y `npm run bundle:migration` para verificar la API y la migración empaquetada.
3. En `driver-app/`, con Android SDK configurado: `./gradlew.bat testDebugUnitTest assembleDebug lintDebug`.
4. En develop, iniciar una ruta tras cinco fotos reales; confirmar cancelación desde su tarjeta. Comprobar en un segundo celular o sesión que sale del panel tras la sincronización y que la foto permanece en Control de unidades. Mover un pedido, republicar y verificar revisión nueva. No ejecutar este escenario en producción con rutas reales.
5. Verificar la imagen Docker en develop: `/odoo-logo-inverted.svg` debe devolver 200 y el botón debe mostrar el logotipo, no un icono roto.

## Métricas y puertas

Objetivo: 100 % de escenarios de revocación/autorización/replay cubiertos en integración PostgreSQL; cero rutas revocadas visibles por las API móviles; cero llamadas Google provocadas por cancelar; cero eventos duplicados de cancelación por revisión; errores API registrados para conflictos. Medir cobertura y mutation score del código crítico, además de latencia p95 de cancelación y sincronización móvil en QA. La prueba física del refresco de la APK y el despliegue Docker quedan como puertas operativas hasta ejecutarse en develop.
