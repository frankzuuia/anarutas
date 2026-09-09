"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="auth-box" style={{ minHeight: "100vh" }}>
      <div className="stack">
        <h1>No pudimos abrir el panel</h1>
        <p className="muted">
          Revisa la conexión y la configuración de esta instalación. No se ha
          confirmado ningún cambio.
        </p>
        <button onClick={reset}>Reintentar</button>
        <a href="/login">Volver al acceso</a>
      </div>
    </main>
  );
}
