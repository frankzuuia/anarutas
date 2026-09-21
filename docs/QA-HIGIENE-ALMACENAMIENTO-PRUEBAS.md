# QA — higiene de almacenamiento de pruebas

## Alcance

Corrección exclusiva de infraestructura local de pruebas. No modifica código de
producción, rutas, Odoo, PostgreSQL de EasyPanel, `preview-db` ni contratos de
negocio.

## Autopsia

El directorio local del repositorio alcanzó 147.1 GB. La evidencia mostró:

- 1,167 clústeres `pg-*` en `.local`;
- 2,875 clústeres adicionales dentro de diez sandboxes `.stryker-tmp`;
- `startPostgres()` configuraba `persistent: true` y su cierre únicamente detenía
  el pool y el servidor, sin eliminar `databaseDir`;
- Stryker conservaba el directorio temporal cuando una ejecución fallaba porque
  su valor predeterminado de `cleanTempDir` era `true`, no `"always"`.

La limpieza manual recuperó 142.5 GB y dejó el repositorio en 1.3 GB. La
corrección evita una nueva acumulación.

## Contratos implementados

1. Cada `startPostgres()` crea un directorio `pg-*` exclusivo.
2. `persistent: false` hace que `embedded-postgres` elimine sus datos al detenerse.
3. Una eliminación defensiva con reintentos borra el directorio exacto incluso si
   el proveedor no lo hizo.
4. Pool, servidor y directorio se intentan cerrar por separado; un fallo no impide
   los pasos restantes y se reporta como error agregado.
5. `close()` es idempotente: múltiples consumidores comparten la misma promesa.
6. Fallos de inicialización o migración ejecutan la misma limpieza antes de
   propagarse.
7. Todos los configs Stryker heredan `cleanTempDir: "always"` y excluyen `.local`,
   `.next`, cobertura y reportes.

## Escenarios Gherkin

```gherkin
Feature: Higiene de almacenamiento de las pruebas

  Scenario: Una base PostgreSQL real se elimina al terminar
    Given una prueba inicia un clúster PostgreSQL real en .local/pg-*
    And existe un directorio vecino que no pertenece al clúster
    When la prueba cierra su conexión y el servidor
    Then el directorio pg-* ya no existe
    And el directorio vecino permanece intacto
    And una segunda llamada de cierre termina sin error

  Scenario: Stryker termina una ejecución satisfactoria
    Given una configuración de mutación hereda la política base
    When Stryker completa todos sus mutantes
    Then cleanTempDir tiene el valor "always"
    And .stryker-tmp no existe al finalizar
    And no queda ningún clúster pg-* de esa ejecución

  Scenario: Una configuración nueva omite la política de almacenamiento
    Given existe un archivo raíz stryker*.config.mjs
    When se ejecuta la regresión de configuraciones
    Then la prueba falla si cleanTempDir no es "always"
    Or falla si falta una exclusión obligatoria
```

## Procedimiento reproducible

Desde la raíz del repositorio:

```powershell
npm test -- tests/stryker-config.test.ts tests/postgres-lifecycle.test.ts
npm test
npm run test:coverage
npm run lint
npm run typecheck
npm run build
npm run test:mutation:fleet-routing-budget
```

Antes y después de las pruebas con PostgreSQL:

```powershell
(Get-ChildItem -LiteralPath '.local' -Directory -Filter 'pg-*' -Force).Count
Test-Path -LiteralPath '.stryker-tmp'
```

Los valores aceptables al finalizar son `0` y `False`, respectivamente.

## Evidencia del 15/09/2026

- Regresión dirigida: 2 archivos, 22/22 pruebas, `pg-*` antes/después 0/0.
- Suite completa: 40 archivos, 449/449 pruebas, `pg-*` después 0 y sin sandbox.
- Cobertura: 94.63% statements, 88.09% ramas, 97.91% funciones y 95.77% líneas.
- Mutation testing dirigido: 5/5 mutantes detectados, 100%, cero sobrevivientes.
- `npm run lint`: verde.
- `npm run typecheck`: verde.
- `npm run build`: verde con Next.js 16.3.4.
- Al final: `pg-* = 0`; `.stryker-tmp = False`.
- `preview-db` y `preview-runtime.json` permanecieron intactos.

## Riesgos y recuperación

- Si el proceso del sistema operativo termina de forma no capturable, Stryker
  intenta retirar siempre su sandbox; el siguiente arranque no reutiliza el
  clúster porque cada directorio es único.
- Un fallo de limpieza es visible: la prueba falla con
  `TEST_POSTGRES_CLEANUP_FAILED`; no se oculta como éxito.
- Reversión técnica: revertir únicamente el helper, la política base, sus imports
  y las dos regresiones. No existe migración ni estado productivo que revertir.
