import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { DiktatSession } from "@/components/a1/DiktatSession";
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function A1DiktatPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }
  setRequestLocale(locale);

  return <DiktatSession language="de" uiLocale={locale} />;
}
