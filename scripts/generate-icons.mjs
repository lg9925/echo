#!/usr/bin/env node
// Rasterize public/icons/icon.svg into the PNG sizes needed by the PWA
// manifest and iOS Add-to-Home-Screen. Run via: pnpm gen:icons
//
// Edit icon.svg to customize the look, then re-run this script.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICON_DIR = path.resolve(__dirname, "..", "public", "icons");
const SRC = path.join(ICON_DIR, "icon.svg");

const TARGETS = [
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
  { name: "icon-maskable-512.png", size: 512, padding: 0.1 },
  { name: "apple-touch-icon.png", size: 180 },
];

async function main() {
  const svg = await fs.readFile(SRC, "utf8");
  for (const target of TARGETS) {
    let render = svg;
    // Maskable icons need a safe zone — wrap the SVG with extra padding.
    if (target.padding) {
      render = applyPadding(svg, target.padding);
    }
    const resvg = new Resvg(render, {
      fitTo: { mode: "width", value: target.size },
    });
    const pngData = resvg.render().asPng();
    const dest = path.join(ICON_DIR, target.name);
    await fs.writeFile(dest, pngData);
    console.log(`wrote ${target.name} (${target.size}x${target.size})`);
  }
}

function applyPadding(svg, padPct) {
  // For maskable: shrink the foreground by padPct on each side via viewBox math.
  const match = svg.match(/viewBox="(\d+) (\d+) (\d+) (\d+)"/);
  if (!match) return svg;
  const [, , , w, h] = match;
  const pad = Math.round(Math.max(Number(w), Number(h)) * padPct);
  const newViewBox = `${-pad} ${-pad} ${Number(w) + pad * 2} ${Number(h) + pad * 2}`;
  return svg.replace(/viewBox="[^"]+"/, `viewBox="${newViewBox}"`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
