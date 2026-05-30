import { setRequestLocale, getTranslations } from "next-intl/server";
import { LanguageCard } from "@/components/LanguageCard";

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
  const tNav = await getTranslations("nav");

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
        <nav className="flex items-baseline gap-4">
          <a
            href={`/${locale}/settings/`}
            className="text-sm text-zinc-500 underline-offset-4 hover:underline"
          >
            {tNav("settings")}
          </a>
          <a
            href={`/${otherLocale}/`}
            className="text-sm text-zinc-500 underline-offset-4 hover:underline"
          >
            {otherLabel}
          </a>
        </nav>
      </header>

      <p className="text-sm text-zinc-500">{t("pickLanguage")}</p>
      <div className="grid gap-4">
        {TARGET_LANGS.map((lang) => (
          <LanguageCard key={lang} language={lang} uiLocale={locale} />
        ))}
      </div>
    </main>
  );
}
