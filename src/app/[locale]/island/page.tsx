import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { IslandPlayerRouter } from "@/components/IslandPlayerRouter";
import { routing } from "@/i18n/routing";

// Player for user-created islands (picked / scenario). Their ids aren't known
// at build time, so the island id comes from ?id= read client-side — same
// pattern as the review page's ?lang=.
export default async function IslandPlayerPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }
  setRequestLocale(locale);

  return <IslandPlayerRouter uiLocale={locale} />;
}
