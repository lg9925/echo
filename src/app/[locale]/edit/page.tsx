import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { IslandEditor } from "@/components/IslandEditor";
import { routing } from "@/i18n/routing";

// Island content editor. Like the player page, the island id comes from ?id=
// read client-side (user-island ids aren't known at build time), and all
// content lives in IndexedDB — so this static page edits seed and user islands
// alike.
export default async function EditIslandPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }
  setRequestLocale(locale);

  return <IslandEditor uiLocale={locale} />;
}
