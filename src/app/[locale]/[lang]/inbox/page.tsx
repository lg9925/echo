import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { InboxView } from "@/components/InboxView";
import type { TargetLanguage } from "@/lib/api/contracts";

const TARGET_LANGS = ["de", "en"] as const;

export function generateStaticParams() {
  return TARGET_LANGS.map((lang) => ({ lang }));
}

export default async function LanguageInboxPage({
  params,
}: {
  params: Promise<{ locale: string; lang: string }>;
}) {
  const { locale, lang } = await params;
  const isLocale = routing.locales.includes(locale as (typeof routing.locales)[number]);
  const isLang = (TARGET_LANGS as readonly string[]).includes(lang);
  if (!isLocale || !isLang) notFound();
  setRequestLocale(locale);

  return <InboxView uiLocale={locale} language={lang as TargetLanguage} />;
}
