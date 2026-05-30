import { setRequestLocale, getTranslations } from "next-intl/server";
import { IslandList } from "@/components/IslandList";
import { ReviewQueueBadge } from "@/components/ReviewQueueBadge";

// Target learning languages, in display order. Each needs a matching
// public/seed/echo_seed_<code>.json and a languages.<code> i18n key.
const TARGET_LANGS = ["de", "en"] as const;

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const tApp = await getTranslations("app");
  const tLang = await getTranslations("languages");

  const otherLocale = locale === "zh" ? "en" : "zh";
  const otherLabel = otherLocale === "zh" ? "中文" : "English";

  return (
    <main className="flex flex-1 flex-col gap-8 px-6 py-12 max-w-2xl mx-auto w-full">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight">
            {tApp("name")}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">{tApp("tagline")}</p>
        </div>
        <a
          href={`/${otherLocale}/`}
          className="text-sm text-zinc-500 underline-offset-4 hover:underline"
        >
          {otherLabel}
        </a>
      </header>

      {TARGET_LANGS.map((lang) => (
        <section key={lang} className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-medium text-zinc-700 dark:text-zinc-300">
              {tLang(lang)} — {t("pickIsland")}
            </h2>
            <ReviewQueueBadge language={lang} uiLocale={locale} />
          </div>
          <IslandList language={lang} uiLocale={locale} />
        </section>
      ))}
    </main>
  );
}
