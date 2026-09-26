# QA — destino elegido y repunte desde GPS o mapa (0.5.4)

25/09/2026. Rama `develop`. Sólo se modifica la APK y se añade una regresión
PostgreSQL real; no hay endpoint, esquema ni clave nuevos. Sin ADB por decisión
del usuario. Backend develop y APK instalada deben tener el bloque de repunte
vigente antes de la prueba física.

## Escenarios de aceptación

```gherkin
Característica: navegación explícita a una parada consultada
  Escenario: consultar pedidos no cambia la guía
    Dado que el chofer sigue la guía a la parada 1
    Cuando toca el marcador de la parada 2
    Entonces ve sólo los pedidos de la parada 2
    Y la guía sigue apuntando a la parada 1

  Escenario: ir a la parada consultada
    Dado que la ruta está verificada y Google Navigation está listo
    Cuando pulsa «Ir a esta parada» en la ficha de la parada 2
    Entonces se cancela el destino anterior y se solicita la guía a la parada 2
    Y no cambian el orden, las asignaciones, la llegada ni la entrega

  Escenario: respuesta tardía o fallo de Google
    Dado que se sustituyó la guía a la parada 1 por la parada 2
    Cuando llega tarde el resultado de la petición anterior
    Entonces no se reactiva la guía a la parada 1
    Y si Google no traza la parada 2 se puede reintentar sin cambiar pedidos

  Escenario: ruta no autorizada o mapa aún no listo
    Dado que la ruta fue retirada o la ejecución no está verificada
    Cuando abre la ficha de una parada
    Entonces no puede iniciar una guía nueva
    Y no se escribe ningún evento de negocio

Característica: corregir un punto lejano sin debilitar Llegué
  Escenario: usar la ubicación actual
    Dado que el punto viejo está al otro lado de la ciudad
    Y el chofer está fuera del local correcto con GPS real, reciente y preciso
    Cuando pulsa «Mal punteado» y «Usar mi ubicación actual»
    Entonces el pin salta al GPS y el mapa se centra allí en un solo paso
    Y confirmar el domicilio usa el radio del punto nuevo, no el viejo

  Escenario: elegir manualmente en el mapa
    Dado que el punto viejo está lejos y el chofer está junto al local correcto
    Cuando pulsa «Elegir en el mapa» y mantiene pulsado el domicilio correcto
    Entonces el pin propuesto se mueve allí sin guardar todavía
    Y sólo puede confirmar si el GPS válido está dentro del radio del pin nuevo

  Escenario: punto manual remoto o GPS inválido
    Dado que el pin propuesto está lejos de la posición real
    O el GPS es viejo, impreciso o simulado
    Cuando intenta confirmar el punto
    Entonces la app y el servidor rechazan el comando
    Y «Llegué» conserva el radio y la precisión configurados

  Escenario: confirmación y fallo recuperable
    Dado que el pin nuevo y los cuatro campos del domicilio son válidos
    Cuando confirma el domicilio
    Entonces cliente, parada, pedido e incidencia se actualizan juntos
    Y ante fallo de red o conflicto no se crea una corrección parcial
```

## Evidencia automatizada

| Puerta | Resultado |
| --- | --- |
| Android JVM | 52 pruebas, 0 fallos y 0 errores. |
| Cobertura crítica Android | `DriverArrivalPolicy.kt` 33/33 líneas y 89/92 ramas; `GuidanceResultPolicy.kt` 18/18 líneas y 28/28 ramas. UI/Google físico no se presenta como cubierto por JVM. |
| Mutación crítica Android | 35/35 mutantes detectados, 0 supervivientes, en copia aislada de fuentes. Incluye GPS inválido, ruta retirada y guía repetida. |
| Integración PostgreSQL real | `tests/driver-execution-concurrency.test.ts`: 3/3 pruebas. Nueva regresión: punto original 20.64, punto nuevo 20.8; GPS antiguo/remoto rechazado y GPS en el punto nuevo aceptado, con cliente e incidencia. |
| Contrato y seguridad | Sin API ni secretos nuevos. `RouteExecutionModel.submit` y `executeStopCommand` siguen validando GPS/punto nuevo, identidad, versión e idempotencia. La consulta y el movimiento local del pin no escriben. |
| TypeScript/Next | `npm run typecheck`, `npm run lint` y `npm run build` verdes. |
| Dependencias runtime | `npm audit --omit=dev --audit-level=high`: 0 vulnerabilidades reportadas. |
| Android build/lint | `testDebugUnitTest assembleDebug assembleDebugAndroidTest lintDebug createDebugUnitTestCoverageReport` verde; después del último ajuste visual, `testDebugUnitTest assembleDebug lintDebug createDebugUnitTestCoverageReport` volvió a pasar. |
| APK local | `.local/releases/Five-Rutas-Chofer-0.5.4-develop.apk`, paquete `com.five.anarutas.driver`, versionCode 15, SHA-256 `5E0321C06824F3D90FCF9F65A1C8315F547DCCE3EBB6AA2EDBAD39C570EEE390`; firma debug verificada, mismo certificado SHA-256 `f92d2160eccdadb8b72ac5573ef07dc09eb8fdd57c10621d33afaeb7dd4c2e35` que 0.5.3. |

Objetivo de calidad por riesgo: 100 % de líneas de las dos políticas puras,
≥95 % de ramas de geofence, 100 % de mutantes dirigidos, cero regresiones de
autorización o escritura parcial. Resultados: 100 % líneas, 96.7 % ramas GPS,
100 % ramas de selección, 100 % mutación; defectos detectados por las suites: 0.
La duración de Vitest (39.03 s para el archivo) mide la suite local, **no** la
latencia de navegación ni un SLO del teléfono. No se declara E2E físico verde.

## QA físico pendiente del usuario

1. Instalar la APK 0.5.4 sobre la 0.5.3, sin borrar datos ni cerrar sesión.
2. Con guía a parada 1, tocar el marcador 2: sólo consultar. Pulsar «Ir a esta
   parada»: debe cambiar la guía al punto 2 sin registrar «Llegué» ni reordenar.
3. Con pin viejo lejano, entrar a «Mal punteado», usar GPS actual y comprobar
   centrado, pin y domicilio; confirmar y verificar Cliente e Incidencias por
   fecha/chofer en el panel.
4. Repetir con «Elegir en el mapa»: mantener pulsado cerca del local. Un punto
   manual fuera del radio no debe habilitar «Confirmar punto».
5. Probar red intermitente y ruta retirada mientras la ficha está abierta; no
   debe aparecer entrega o corrección parcial. Verificar atribución Google.

Reproducir en `driver-app` con JDK/SDK local de develop:
`./gradlew.bat testDebugUnitTest assembleDebug assembleDebugAndroidTest lintDebug createDebugUnitTestCoverageReport`
y `./scripts/verify-arrival-mutations.ps1`. En la raíz:
`npx vitest run tests/driver-execution-concurrency.test.ts`, `npm run typecheck`,
`npm run lint`. Resultados de cobertura en
`driver-app/app/build/reports/coverage/test/debug/report.xml` y mutaciones en
`C:/Users/figod/AppData/Local/Temp/ana-rutas-arrival-mutations-14432039987f4c768531c50c462799d0/results.json`.
