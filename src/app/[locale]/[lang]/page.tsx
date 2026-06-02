import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { IslandList } from "@/components/IslandList";
import { ReviewQueueBadge } from "@/components/ReviewQueueBadge";

const TARGET_LANGS = ["de", "en"] as const;

export function generateStaticParams() {
  return TARGET_LANGS.map((lang) => ({ lang }));
}

export default async function LanguageHubPage({
  params,
}: {
  params: Promise<{ locale: string; lang: string }>;
}) {
  const { locale, lang } = await params;
  const isLocale = routing.locales.includes(locale as (typeof routing.locales)[number]);
  const isLang = (TARGET_LANGS as readonly string[]).includes(lang);
  if (!isLocale || !isLang) notFound();
  setRequestLocale(locale);

  const tNav = await getTranslations("nav");
  const tLang = await getTranslations("languages");
  const tHome = await getTranslations("home");

  return (
    <main className="flex flex-1 flex-col gap-6 px-6 py-12 max-w-2xl mx-auto w-full">
      <header className="flex items-baseline justify-between">
        <a
          href={`/${locale}/`}
          className="text-sm text-zinc-500 underline-offset-4 hover:underline"
        >
          ← {tNav("home")}
        </a>
        <a
          href={`/${locale}/settings/`}
          className="text-sm text-zinc-500 underline-offset-4 hover:underline"
        >
          {tNav("settings")}
        </a>
      </header>

      <h1 className="text-3xl font-semibold tracking-tight">{tLang(lang)}</h1>

      {/* Per-language actions */}
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={`/${locale}/${lang}/inbox/`}
          className="rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-1.5 text-sm font-medium hover:opacity-90"
        >
          {tNav("inbox")}
        </a>
        <a
          href={`/${locale}/${lang}/vocab/`}
          className="rounded-full border border-zinc-300 dark:border-zinc-700 px-4 py-1.5 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-900"
        >
          {tNav("vocab")}
        </a>
        <ReviewQueueBadge language={lang} uiLocale={locale} />
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-zinc-700 dark:text-zinc-300">
          {tHome("pickIsland")}
        </h2>
        <IslandList language={lang} uiLocale={locale} />
      </section>
    </main>
  );
}
