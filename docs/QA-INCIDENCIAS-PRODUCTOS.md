# QA — archivo dominical e incidencias por producto

Fecha: 2026-09-28. Repositorio Ana Rutas; cambios locales sobre develop, base
`6ded57d32be972ce8760e429b15b54501aa67fa0`. Usuario autoriza commit/push a
develop para probar el bloque; no autoriza promover a main. La prueba física
de cámara y recuperación en teléfono queda expresamente pendiente.
El usuario ejecutará Deploy manualmente en Easypanel; este bloque publica Git,
no activa ni reinicia servicios. Preflight remoto confirma develop, PostgreSQL
privado y volumen persistente de fotos; respaldo/restauración no verificados.

## Contrato aprobado

- Domingo 20:00 de la zona de instalación: archivar planes con fecha anterior al
  lunes siguiente. Conservar futuros, pedidos, publicaciones, ejecución e historial.
  Worker cada minuto y recuperación al arrancar. No es eliminación de datos/disco.
- Faltante por validación/bodega: producto manual, unidad y cantidad; chofer elige
  Operaciones o Compras. Bodega distingue Especiales, Calidad y Llegada tardía.
- Reposición por calidad/producto erróneo y devolución: desde partida publicada,
  cantidad positiva y acumulado dentro de la cantidad original. Foto obligatoria.
  Faltantes: foto opcional. No hay movimientos, devoluciones ni escrituras Odoo.
- Panel: Reportó (chofer), fotografía privada con miniatura/apertura, clasificación
  Departamento/Concepto editable por admin, resolución explícita y auditada.
  Resolver aparece sólo en Incidencias en vivo; historial no tiene esa acción.
- Vivo: reposiciones pendientes sobreviven entrega, resolución de cliente cerrado
  y archivo de plan. No las cierra automáticamente una entrega.
- Excel: **Fecha, Cliente, Producto, Cantidad, Unidad, Departamento, Detalle de la
  incidencia, Comentarios, Orden**. Nueve columnas: sin chofer, Concepto, foto o URL.

## Procedimiento reproducible local

Desde la raíz real del repositorio, usando Node 24 y las dependencias bloqueadas:

```powershell
npm run lint
npm run typecheck
npm run build
npx vitest run
npx vitest run tests/product-incidents.test.ts tests/product-incidents-evidence.test.ts tests/product-incidents-excel.test.ts --coverage --coverage.include=src/core/product-incidents*.ts --coverage.include=src/core/plan-archive.ts --coverage.thresholds.lines=95 --coverage.thresholds.branches=90 --coverage.thresholds.functions=100 --coverage.thresholds.statements=95
npx stryker run stryker.product-incidents.config.mjs
npx playwright test tests/e2e/product-incidents.spec.ts tests/e2e/control-center.spec.ts tests/e2e/panel.spec.ts tests/e2e/driver-mobile.spec.ts --workers=1
npm audit --omit=dev --audit-level=high
```

Las pruebas nuevas usan PostgreSQL 17 real y aislado por fixture, autenticación/HTTP reales, archivos de
imagen reales saneados por Sharp; no APIs falsas ni llamadas a Odoo/Google.
La suite anterior conserva sus pruebas de contrato existentes. Los datos de
publicación nuevos son semillas de prueba y no certifican un cálculo de Google.
Aceptación trazada en `tests/acceptance-product-incidents.feature` (PI01..PI14).

Android (desde driver-app, SDK configurado en ANDROID_HOME):

```powershell
.\gradlew.bat testDebugUnitTest createDebugUnitTestCoverageReport lintDebug assembleDebug --console=plain
.\scripts\verify-arrival-mutations.ps1 -ProductOnly
```

Mutantes Android ejecutados en copia temporal aislada, nunca sobre develop.

## Evidencia y métricas

- Build/tipos/lint web: sin errores. Dependencias productivas: 0 vulnerabilidades
  en auditoría npm ejecutada en esta fecha; no se agregaron dependencias.
- Políticas TS/corte semanal: 217/217 mutantes eliminados, 0 sobrevivientes,
  0 no cubiertos, 0 timeouts; `reports/mutation/product-incidents.json`.
- E2E: 9/9 recorridos aprobados. Incluyen centro de control con cuatro mapas,
  sesión y revocación, cliente cerrado, reconexión, captura HTTP con imagen,
  CSRF, clasificación versionada, Excel sin campos internos y resolución.
  Repetición final de producto: 1/1, verificando worker real de archivo al arrancar
  y ausencia de Resolver en historial (sólo en vivo); 24.2 s total.
- Muestra local del POST con foto + replay + conflicto: 141 ms combinados.
  No representa percentil ni SLO productivo; depende del entorno de QA.
- Android: 91 JVM aprobadas, 0 fallos; lint 0 errores y 33 advertencias del proyecto.
  Política ejecutable ProductIncidentPolicyKt: 100% líneas, 100% métodos,
  97.62% ramas (41/42; conversión nullable defensiva después de gramática decimal).
- Complejidad ESLint medida: validación de entrada 21, callback transaccional de
  registro 27, lectura 12, corte semanal 4. Se mantiene una sola transacción para
  identidad, suma exacta, evidencia, versiones y recibo; fronteras cubiertas en PG.
- Objetivo de cobertura dirigida: líneas/expresiones >=95%, ramas >=90%, funciones
  100%. El promedio no sustituye permisos, CAS, suma, replay, foto y corte: cada
  uno tiene casos negativos y positivos independientes.
- Cobertura dirigida final: 100% líneas (137/137), 100% funciones (30/30),
  98.21% expresiones (165/168), 97.5% ramas (156/160). La rama de recuperación de
  COMMIT incierto conserva archivos por diseño; no se certifica con prueba de red física.
- Mutantes Android: 17/17 eliminados. Evidencia temporal:
  `C:/Users/figod/AppData/Local/Temp/ana-rutas-arrival-mutations-94b18bfe46894ed38eb7b3860edbe49f/results.json`.
- Suite completa: 63 archivos aprobados, 633 pruebas aprobadas y 1 omitida por
  condición existente; 0 fallos. Corrida final 733.73 s, inicio 15:22:59.
  La primera corrida encontró dos contratos viejos: conteo de tablas con eventos
  y desmontaje del fixture v20. Se actualizaron para v27 y ambos pasaron de nuevo.
- Capturas: `.local/qa/product-incidents/history.png` y `mobile-panel.png`.
  Reportes JVM/lint/JaCoCo en `driver-app/app/build/reports`.
  Copias locales de cobertura y mutaciones en `.local/qa/product-incidents/`.

APK debug de prueba: `.local/releases/Five-Rutas-Chofer-0.8.0-develop.apk`,
code22, 69,398,997 bytes. SHA256
`ADA6EE887A8A76046FEB7F1830BE0701C3FC754C390B1460EA35414A62136CE6`.
Firma verificada por apksigner y coincidente con builds previas; no es una firma
de publicación en tienda. Primero necesita backend actualizado de este bloque.

## Seguridad e integridad revisadas

API móvil verifica sesión, asignación/ejecución, publicación, llegada vigente,
pedido y versiones; serializa comandos concurrentes. Decimal exacto también en
trigger SQL bajo bloqueo de pedido. Reporte original inmutable, admin sólo corrige
clasificación o resuelve con nota; auditoría conserva autor y valores previos.
Sin autoridad administrativa no se consulta reporte, Excel ni imagen. Mutaciones
web usan protección de origen. Texto con sintaxis de fórmula se exporta inerte.

Imagen máxima 8 MB y límite de píxeles del saneador existente; WebP sin EXIF,
archivo UUID privado. Hash en recibo evita cambiar la imagen de un comando ya
guardado. Replays/rollback descartan archivos no referenciados; ante resultado
incierto de COMMIT/BD no disponible se preserva el archivo para que el worker
compruebe referencias después. No se borra evidencia por archivo dominical ni
por resolver la incidencia. El limpiador de cliente cerrado conoce referencias
de producto y no las considera huérfanas.

## QA físico y preflight pendientes (no declarar salida productiva)

No hay dispositivo ADB operativo conectado; el emulador listado está offline.
Compilar APK no prueba cámara, rotación ni navegación sobre un teléfono real.

1. Respaldar/verificar BD y volumen privado del destino antes de migrar v27.
   Revisar zona horaria configurada; no tocar main ni Odoo.
2. Publicar backend autorizado antes de instalar APK 0.8.0/code22. Abrir ruta
   real asignada; confirmar Llegué dentro del radio y tocar una partida.
3. Intentar guardar reposición/devolución sin foto: debe impedirse. Capturar foto,
   cantidad parcial/total, Departamento y notas; comprobar miniatura en panel.
4. Cancelar cámara, reemplazar/quitar foto, rotar y cerrar modal: sin envío accidental.
   Simular pérdida de conectividad tras envío y reiniciar app: verificar mismo
   recibo, una sola incidencia y una sola imagen. La cola privada existente vence
   capturas no confirmadas a 24 horas; debe pedir nueva captura si aún no se guardó.
5. Faltante no listado sin foto; bodega con sus tres motivos. Admin corrige
   clasificación; exporta y verifica nueve columnas sin datos internos.
6. Confirmar atención con incidencias y continuar ruta: reposición sigue pendiente.
   Resolverla desde panel; historial/foto permanecen. Verificar también cliente
   cerrado, rechazo, reprogramación y navegación previa sin regresión.
7. Corte semanal en entorno de prueba: conservar lunes/futuro y ruta iniciada;
   comprobar archivo/auditoría y métricas. Si el proceso estuvo apagado, comprobar
   recuperación al arrancar; no prometer ejecución mientras el servidor no corre.

No se probó una caída física de red exactamente durante COMMIT; el código conserva
evidencia ante incertidumbre. Prueba de carga sostenida y percentiles productivos
no ejecutados. Original XLSX no adjunto: se verificaron columnas/valores y estilo
tabular verde, no igualdad visual/binaria con un archivo inexistente en el repo.
