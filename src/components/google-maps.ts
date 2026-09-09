let loading: Promise<void> | undefined;
declare global {
  interface Window {
    rutasMapsReady?: () => void;
    gm_authFailure?: () => void;
  }
}
export function loadGoogleMaps(key: string): Promise<void> {
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => fail(), 30000);
    const previousAuthFailure = window.gm_authFailure;
    const cleanup = () => {
      window.clearTimeout(timeout);
      delete window.rutasMapsReady;
      window.gm_authFailure = previousAuthFailure;
    };
    const fail = () => {
      cleanup();
      script.remove();
      loading = undefined;
      reject(
        new Error(
          "No se pudo conectar con Google Maps. Revisa la conexión y la configuración del mapa.",
        ),
      );
    };
    window.rutasMapsReady = () => {
      cleanup();
      resolve();
    };
    window.gm_authFailure = fail;
    script.onerror = fail;
    const query = new URLSearchParams({
      key,
      v: "quarterly",
      loading: "async",
      callback: "rutasMapsReady",
      language: "es",
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${query}`;
    script.async = true;
    script.nonce =
      document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce || "";
    document.head.append(script);
  });
  return loading;
}
