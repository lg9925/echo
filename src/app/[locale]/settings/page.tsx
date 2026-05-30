import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { SettingsView } from "@/components/SettingsView";
import { routing } from "@/i18n/routing";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }
  setRequestLocale(locale);

  return <SettingsView uiLocale={locale} />;
}
