import { redirect } from "next/navigation";
import { principal } from "@/server/http";
import { AppError } from "@/core/errors";
import { Dashboard } from "@/components/dashboard";
export const dynamic = "force-dynamic";
export default async function Home() {
  const access = await principal().catch((error) => {
    if (error instanceof AppError && error.status === 401) return null;
    throw error;
  });
  if (!access) redirect("/login");
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: access.config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return (
    <Dashboard
      user={access.user}
      displayName={access.config.displayName}
      today={today}
      timezone={access.config.timezone}
    />
  );
}
