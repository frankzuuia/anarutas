import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Ana Rutas",
  description: "Administración y planificación de rutas",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
