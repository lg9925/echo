import { promises as fs } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { ShadowPlayer } from "@/components/ShadowPlayer";
import { routing } from "@/i18n/routing";
import type { RawSeed } from "@/lib/types";

interface IslandMeta {
  islandId: string;
  language: string;
  name: string;
}

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
  return islands.map((isl) => ({ islandId: isl.islandId }));
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
  if (!island) notFound();

  return (
    <ShadowPlayer
      islandId={islandId}
      language={island.language}
      uiLocale={locale}
      islandName={island.name}
    />
  );
}
