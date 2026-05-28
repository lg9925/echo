import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { ReviewSession } from "@/components/ReviewSession";
import { routing } from "@/i18n/routing";

// For now the only target language is German. Phase 4+ can add a picker.
const DEFAULT_TARGET_LANGUAGE = "de";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }
  setRequestLocale(locale);

  return (
    <ReviewSession language={DEFAULT_TARGET_LANGUAGE} uiLocale={locale} />
  );
}
