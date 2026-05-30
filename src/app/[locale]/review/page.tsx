import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { ReviewSessionRouter } from "@/components/ReviewSessionRouter";
import { routing } from "@/i18n/routing";

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

  // The target learning language comes from the ?lang= query, read client-side
  // by ReviewSessionRouter (static export can't read searchParams server-side).
  return <ReviewSessionRouter uiLocale={locale} />;
}
