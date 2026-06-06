import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { EinbuergerungHome } from "@/components/einbuergerung/EinbuergerungHome";
import { routing } from "@/i18n/routing";

// German-specific module → only the UI locale is dynamic here.
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function EinbuergerungPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }
  setRequestLocale(locale);

  return <EinbuergerungHome uiLocale={locale} />;
}
