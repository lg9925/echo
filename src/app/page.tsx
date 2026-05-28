import { routing } from "@/i18n/routing";

export default function RootRedirect() {
  const script = `
    var supported = ${JSON.stringify(routing.locales)};
    var fallback = ${JSON.stringify(routing.defaultLocale)};
    var pref = (navigator.language || fallback).slice(0, 2);
    var target = supported.indexOf(pref) >= 0 ? pref : fallback;
    window.location.replace("/" + target + "/");
  `;

  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <noscript>
        <a href={`/${routing.defaultLocale}/`}>
          Go to /{routing.defaultLocale}/
        </a>
      </noscript>
      <script dangerouslySetInnerHTML={{ __html: script }} />
      <p className="text-zinc-500 text-sm">Redirecting…</p>
    </main>
  );
}
