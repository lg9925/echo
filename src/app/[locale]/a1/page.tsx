import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { A1Home } from "@/components/a1/A1Home";
import { routing } from "@/i18n/routing";

// A1 course is German-specific (Goethe A1) → only the UI locale is dynamic,
// following the einbuergerung precedent. The data model stays language-
// parameterized (宪法原则四) — the component takes language as a prop.
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function A1Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }
  setRequestLocale(locale);

  return <A1Home language="de" uiLocale={locale} />;
}
