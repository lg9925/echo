import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { SpeakingTutor } from "@/components/a1/SpeakingTutor";
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function A1SpeakingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }
  setRequestLocale(locale);

  return <SpeakingTutor language="de" uiLocale={locale} />;
}
