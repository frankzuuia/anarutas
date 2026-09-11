# Ana Rutas

Aplicación independiente. El repositorio `five` y sus servicios no se modifican.

## Estado

Bloque 1: cuentas propias, sesiones, borradores de planificación versionados, auditoría y conector Odoo privado de sólo lectura. No hay todavía carga de pedidos, mapas, optimización ni asistente conectado. Esos bloques están en docs/BUSINESS_LOGIC.md.

## Ejecutar

1. Node 24, `npm ci`.
2. Configurar variables de `.env.example` en el entorno. Para local, se admite `.env.local` con `next`; la migración CLI recibe las variables del shell o `node --env-file=.env.local --import tsx scripts/migrate.ts`.
3. PostgreSQL dedicado y vacío, con usuario propio: `npm run db:migrate`.
4. `npm run dev` o `npm run build` y `npm start`.
5. Abrir `/setup`, introducir el secreto `RUTAS_BOOTSTRAP_TOKEN` y elegir nombre, usuario y contraseña. No hay usuario por defecto. Retirar el secreto de bootstrap del entorno después del alta. El formulario público queda bloqueado desde la primera cuenta, aunque el secreto continúe configurado.

Las claves, hosts Odoo, usuarios y IDs no están en el código. `RUTAS_DATABASE_URL` nunca toma la conexión del bot. `RUTAS_INSTANCE_ID` debe ser estable por instalación; no se usa para distinguir artificialmente develop/main ni se basa en el usuario.

### Vista local aislada

`npm run preview:local` inicia PostgreSQL real y Next en loopback, fuera de EasyPanel. Genera claves aleatorias una vez en `.local/preview-runtime.json` (ignorado por git). Usa su campo `bootstrapToken` para activar tu cuenta; no compartas ese archivo, también contiene la conexión local. Puedes proporcionar tu propio `RUTAS_BOOTSTRAP_TOKEN` desde el shell. Reutiliza los datos y puertos locales en siguientes arranques. No utiliza conexiones Odoo del shell: para una prueba de integración usa el despliegue normal con las variables de esa instalación. Esta utilidad local NO cambia el comportamiento del artefacto productivo ni bloquea `main`.

## Promover a producción

El MISMO código y la MISMA imagen pueden ejecutarse en ambas instalaciones, leyendo variables en runtime. Se cambia la versión desplegada, no el código para cada usuario. Pasar a `main` requiere autorización expresa y las puertas de QA. La primera instalación de producción sí necesita crear el servicio/base propios y configurar sus variables; un merge por sí solo no crea infraestructura. Después de ese aprovisionamiento inicial, la imagen aplica las migraciones al arrancar.

No usar el workflow de despliegue de `five`. No copiar su Postgres/Redis, usuarios de rutas, caché, secretos o IDs entre servidores. Las variables ya existentes en el EasyPanel de un servicio NO se heredan automáticamente en otro. Nunca dar al agente acceso a EasyPanel.

### Odoo

Configurar URL, base, usuario, clave y empresa de CADA instalación en su servicio de rutas. Crear cuenta de integración con permisos mínimos de lectura para producción. La API key hereda permisos del usuario; el adaptador además sólo implementa consultas cerradas. Cambiar URL/base/empresa produce un fingerprint distinto para el futuro aislamiento de caché. No se actualiza ningún campo de Odoo en este bloque.

### Control de consumo Google

El panel consulta datos reales de Cloud Billing; no estima llamadas a partir de clics internos. Habilitar en la cuenta de facturación las exportaciones **Standard usage cost** y **Pricing data** hacia un mismo dataset BigQuery, habilitar BigQuery API y crear una cuenta de servicio FinOps dedicada. Conceder `roles/bigquery.jobUser` en el proyecto que ejecuta la consulta y `roles/bigquery.dataViewer` únicamente sobre el dataset exportado. Después, configurar las seis variables `RUTAS_GOOGLE_*` del bloque FinOps de `.env.example`. El JSON de la cuenta se guarda codificado en base64 como secreto privado; nunca se pega en el chat ni se expone al navegador.

Google actualiza esas exportaciones con retraso, por lo que la pantalla muestra la hora oficial del último dato. Ana Rutas reemplaza su caché PostgreSQL en cada sincronización y conserva el último corte confirmado si BigQuery falla.

## QA reproducible

`npm run typecheck`, `npm run lint`, `npm run test:coverage`, `npm run test:mutation`, `npm run build`, `npm run test:e2e`, `npm audit`.

Integración/E2E usan procesos PostgreSQL reales temporales, no mocks. Los registros QA no se crean en Odoo ni en servicios de otros proyectos. E2E requiere Chrome disponible (`PLAYWRIGHT_CHANNEL` permite elegir otro canal instalado). Los reportes y capturas quedan en `reports/`, `coverage/` y `playwright-report/` ignorados por git. Mutation está acotado a `src/core/policy.ts`, no equivale a cubrir todo el backend.

## Operación antes de producción

- HTTPS válido por Cloudflare Full (strict), dominio y origen coincidentes; DB privada no publicada.
- Base dedicada, usuario no superusuario, backup cifrado y prueba real de restauración en instalación aislada; registrar RPO/RTO acordados. Los backups no se configuran automáticamente en servicios ajenos.
- Instalar y probar en Linux la imagen Docker; no asumir que un build local Windows lo valida.
- Monitorizar readiness, HTTP error rate, latencias/Server-Timing, recursos y eventos; evitar imprimir cuerpos de autenticación/Odoo.
- Planificar rotación/recuperación de contraseñas, retención de sesiones/auditoría y políticas de seguridad antes de apertura productiva.

No hay commits, pushes, remotos ni despliegues implícitos en estos comandos.
