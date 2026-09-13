# QA — consulta de incidencias del panel

12/09/2026. Develop local, base 8482923. Sin commit/push/deploy ni cambios en
EasyPanel, Odoo, Five, Ana V3, Luna o producción. Sin migración nueva.

## Alcance implementado

BL-063 / IN01..08. Consulta autenticada de previsiones del cálculo vigente;
una fila por destino con sus pedidos, camioneta/chofer, ventanas, ETA y retraso.
Plan selector, búsqueda, refresh, carga, errores y estados sin cálculo,
desactualizado e incompleto. Llegadas reales se identifica como integración
pendiente. No existe botón administrativo que registre una llegada del chofer.

El usuario confirmó que la APK no existe. «Llegué» será llegada/inicio de surtido,
no entrega finalizada. Esta entrega no implementa API ni histórico de ese evento.

La skill ui-ux-pro-max orientó etiquetas, foco, controles táctiles y estados
honestos manteniendo el tema existente; sin librería visual nueva.

## Evidencia ejecutada

- Suite completa: 36 archivos, 361/361 pruebas, 117.91 s.
- Cobertura global: statements 91.78%, ramas 84.46%, funciones 96.85%, líneas 93.06%.
- route-incidents.ts y route-incidents-query.ts: 100% en las cuatro métricas.
  Objetivo justificado por riesgo: no presentar previsiones obsoletas como reales.
- Mutación del modelo: 58/58 detectadas dentro de la corrida logística 197/197.
- Mutación de consulta: 4/4 detectadas en 55 s; cero sobrevivientes, sin cobertura,
  tiempos agotados o errores. Quitar el aislamiento deja fallar la regresión real.
- PostgreSQL aislado: consulta conserva datos/versiones del tablero; agrupa
  pedidos, guarda/relee retraso y rechaza ID inválido. No usa un sustituto de DB.
- Concurrencia: tres sesiones reales pausan la lectura con un bloqueo SQL,
  cambian una ventana y liberan la lectura. El primer resultado conserva el
  snapshot original y la siguiente lectura marca obsolescencia, sin ETA mezcladas.
- API/E2E: sin sesión devuelve 401; menú, selector, refresh y vistas existentes
  se ejercitan con Next.js y PostgreSQL reales; durante la navegación no hay POST.
- Playwright: 1 recorrido local aprobado (29.3 s), 2 recorridos de proveedores
  reales omitidos por falta de configuración privada. No cuentan como aprobados.
- Build compila en 3.2 s; TypeScript y ESLint sin errores ni advertencias de código.
- Contratos Gherkin documentados en acceptance.feature; no hay runner Cucumber.

Caso puro Kalamar: ventana 10:00–11:30, ETA 12:00 => 30 minutos de retraso
PREVISTO, agrupando folios sin multiplicar arribos. También se prueban versiones
menores/mayores, falta de medición, igualdad al cierre, sucursales distintas,
clientes archivados, nombres de pedidos alternativos y chofer ausente.

## QA visual y límites de la evidencia

Capturas de la vista Llegadas reales pendiente a 375, 768, 1024 y 1440 px en
reports/screenshots/incidents-*.png. Sin desbordamiento horizontal; capturas de
375 y 1440 inspeccionadas visualmente. Navegación y estados vacíos en navegador;
tarjetas pobladas verificadas en el modelo y DB, no aún en un recorrido live.

No hubo petición facturable por consultar incidencias ni ejecución live del nuevo
optimizador. No se publican SLO de proveedores ni latencia productiva con estos
tiempos de pruebas locales. No se afirma preparación para producción.

## Reproducción y validación pendiente

Desde Ana Rutas, Node 24 y dependencias del lockfile:

```powershell
npx vitest run tests/route-incidents.test.ts tests/routing.test.ts
npm run test:coverage
npm run test:mutation:route-logistics
npm run test:mutation:route-incidents-query
npm run test:e2e
npm run typecheck
npm run lint
git diff --check
```

Tras autorización y deploy manual en develop:

1. Armar una ruta real; abrir Incidencias y comparar ETA/retraso con el cálculo
   guardado, respetando zona horaria y todos los folios del destino.
2. Filtrar por cliente/pedido; revisar tarjetas pobladas en móvil y escritorio.
3. Cambiar un horario y comprobar estado obsoleto hasta completar recálculo.
4. Confirmar que la consulta no cambia asignaciones ni genera llamadas a proveedores.
5. Confirmar que Llegadas reales sigue pendiente: nunca usar ETA como prueba de llegada.

El evento móvil posterior requiere identidad/permiso del chofer, idempotencia,
hora original, copia histórica de ventanas y política offline. No se deducen ni
implementan esos contratos sin su bloque. Reversión del panel: código; no datos.
