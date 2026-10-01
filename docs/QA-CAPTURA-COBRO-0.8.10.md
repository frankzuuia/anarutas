# Captura de cobro — APK 0.8.10

Fecha: 2026-09-30. Base develop 7be149e. Ajuste BL-169 solicitado por el propietario durante su QA de APK0.8.9. Cambios únicamente en presentación/captura Android, pruebas y documentación; backend y esquema38 conservados.

## Resultado funcional

- 💵 Efectivo, 🏦 Transferencia y 🧾 Crédito como tarjetas de ancho completo, mínimo88dp, emoji, descripción, radio exclusivo y borde/acento del tema. El texto puede crecer sin altura máxima ni truncamiento. El emoji es decorativo para evitar duplicar el anuncio del lector de pantalla.
- Se retira «Cambio entregado» del formulario. «Efectivo recibido» representa lo que conserva el chofer; el comando nuevo lleva cambio cero. El historial sigue mostrando los recibos previos sin recalcularlos.
- Transferencia usa «Monto transferido» obligatorio. Vacío no es cero. Un monto parcial genera saldo pendiente; un importe mayor al total, negativo o sin precisión válida no se confirma.
- Crédito no muestra entrada de importe y conserva recibido cero, aunque hubiera una cantidad escrita en otro medio. El contrato continúa siendo un medio por pedido; no se implementan pagos mixtos a partir de una pregunta del propietario.
- Fuente ausente/no vigente, revisión cambiada, busy/pending y cola cifrada conservan las guardas anteriores. Este ajuste no afirma resolver un pedido que todavía diga «Por confirmar».

## Evidencia y alcance

Verificación automatizada aprobada: 127/127 pruebas JVM (0 fallos/errores/omisiones), 28/28 de contrato monetario/roles/PostgreSQL real (64.33s), 6/6 mutaciones detectadas y Gradle test/lint/assemble/coverage correcto (5m45s). Lint: 0 errores, 35 advertencias existentes, ninguna en el formulario nuevo ni la captura modificada. Política monetaria: 18/18 líneas cubiertas, 67/70 ramas (95.71%); las tres ramas restantes son código generado de datos. La función nueva de captura tiene cobertura completa y complejidad ciclomática1. Objetivo >=95% líneas/ramas en política crítica; las tres mutaciones de captura y tres regresiones monetarias se detectaron.

El verificador de mutación inicialmente dejó como salida el código1 esperado del último Gradle mutado a pesar de detectar6/6. Se corrigió únicamente su salida final y se repitió el caso de transferencia vacía: detectado y proceso de auditoría terminado con código0. No fue un fallo de aplicación ni se ocultó un mutante superviviente.

JVM incluye dos regresiones nuevas sobre captura neta, transferencia vacía y cambio de medio. Compose añade tres recorridos de controles reales: selección exclusiva/deshabilitada, nombres/ausencia de cambio/vacío, letra150% a320dp; compilación de instrumentación aprobada. ADB volvió a comprobarse: emulator-5554 offline, ejecución visual pendiente. Estas pruebas no simulan un servidor ni confirman dinero.

La excepción física previa sigue vigente: la ejecución visual de Compose, gestos y tamaño de letra en el teléfono queda a cargo del propietario. Compilar la instrumentación no equivale a ejecutarla. No se modifica autorización, persistencia, fuente Odoo ni servicios externos; se repite el contrato real de cobro/liquidación PostgreSQL. No es necesario repetir la regresión general del backend para este ajuste exclusivamente Android.

## Reproducción

Desde driver-app con ANDROID_HOME configurado:

```powershell
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest createDebugUnitTestCoverageReport --console=plain
.\scripts\verify-payment-mutations.ps1 -Only capture_zero_change,capture_no_blank_default,capture_preserves_method,cash_overpayment,currency_quantum,credit_has_no_cash
```

Desde la raíz: `npx vitest run --config vitest.settlements.config.ts --reporter=verbose`.

Evidencia local: `.local/payment-ui-0.8.10-build.log`, `.local/payment-ui-0.8.10-mutations.log`, `.local/payment-ui-0.8.10-mutation-exit.log`, `.local/payment-ui-0.8.10-contract.log`. APK: `.local/releases/ana-rutas-driver-0.8.10-cobro.apk`, 69,065,550bytes, versionCode32/minSdk26. SHA256: EF7E24BC35ED0A6D1E9F8ECE608E880448E774529F24C77BA8EB72CAE1ED875C. apksigner verificó certificado idéntico a0.8.9 (f92d2160eccdadb8b72ac5573ef07dc09eb8fdd57c10621d33afaeb7dd4c2e35), compatible con actualización conservando datos.

## QA del propietario

Actualizar la APK conservando datos. No hace falta un deploy nuevo del servidor para este ajuste.

1. Abrir un pedido entregado con importes vigentes; verificar las tres tarjetas, emojis, selección y tamaño de letra grande.
2. Elegir efectivo: comprobar que sólo aparece «Efectivo recibido», sin entrada de cambio. Registrar el importe neto real y comparar el saldo antes de confirmar.
3. Elegir transferencia: borrar el monto y comprobar que Confirmar queda deshabilitado; escribir el monto transferido real y revisar la confirmación.
4. Elegir crédito después de escribir un monto: comprobar que desaparece el campo y la confirmación no registra dinero recibido.
5. Abrir un recibo anterior y verificar que sigue intacto; revisar separación efectivo/transferencia/crédito en liquidación.

Referencia de accesibilidad: [Android Compose, controles y semántica](https://developer.android.com/develop/ui/compose/accessibility/api-defaults). No se añaden dependencias ni llamadas de red por tarjeta; el efecto de selección es local y no usa animación obligatoria.
