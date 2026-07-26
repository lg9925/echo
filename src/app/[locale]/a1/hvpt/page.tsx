import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { HvptSession } from "@/components/a1/HvptSession";
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function A1HvptPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }
  setRequestLocale(locale);

  return <HvptSession language="de" uiLocale={locale} />;
}
