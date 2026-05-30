import { promises as fs } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ShadowPlayer } from "@/components/ShadowPlayer";
import { routing } from "@/i18n/routing";
import type { RawSeed } from "@/lib/types";

interface IslandMeta {
  islandId: string;
  language: string;
  name: string;
}

// User "picked-up words" islands are created at runtime in IndexedDB, so they
// can't be discovered from the seed files at build time. Their ids are
// deterministic, so we pre-register them here for static generation. Their
// display name is resolved per-locale at render (the seed has no entry).
const PICKED_ISLANDS: { islandId: string; language: string }[] = [
  { islandId: "de.u.picked", language: "de" },
  { islandId: "en.u.picked", language: "en" },
];

async function readAllSeeds(): Promise<RawSeed[]> {
  const dir = path.join(process.cwd(), "public", "seed");
  const files = await fs.readdir(dir);
  const seeds: RawSeed[] = [];
  for (const file of files) {
    if (!file.startsWith("echo_seed_") || !file.endsWith(".json")) continue;
    const text = await fs.readFile(path.join(dir, file), "utf8");
    seeds.push(JSON.parse(text));
  }
  return seeds;
}

async function readAllIslands(): Promise<IslandMeta[]> {
  const seeds = await readAllSeeds();
  return seeds.flatMap((seed) =>
    seed.islands.map((isl) => ({
      islandId: `${seed.language}.${isl.order}`,
      language: seed.language,
      name: isl.name,
    })),
  );
}

export async function generateStaticParams() {
  const islands = await readAllIslands();
  return [
    ...islands.map((isl) => ({ islandId: isl.islandId })),
    ...PICKED_ISLANDS.map((p) => ({ islandId: p.islandId })),
  ];
}

export default async function ShadowIslandPage({
  params,
}: {
  params: Promise<{ locale: string; islandId: string }>;
}) {
  const { locale, islandId } = await params;
  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }
  setRequestLocale(locale);

  const islands = await readAllIslands();
  const island = islands.find((i) => i.islandId === islandId);

  if (!island) {
    // Picked-up-words island: not in the seed, name comes from i18n.
    const picked = PICKED_ISLANDS.find((p) => p.islandId === islandId);
    if (!picked) notFound();
    const t = await getTranslations({ locale, namespace: "inbox" });
    return (
      <ShadowPlayer
        islandId={islandId}
        language={picked.language}
        uiLocale={locale}
        islandName={t("pickedIsland")}
      />
    );
  }

  return (
    <ShadowPlayer
      islandId={islandId}
      language={island.language}
      uiLocale={locale}
      islandName={island.name}
    />
  );
}
