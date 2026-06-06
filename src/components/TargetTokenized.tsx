"use client";

const WORD_RE = /[\p{L}']+/gu;

type Part = { kind: "word" | "text"; text: string };

function tokenize(target: string): Part[] {
  const parts: Part[] = [];
  let lastIdx = 0;
  for (const m of target.matchAll(WORD_RE)) {
    const idx = m.index ?? 0;
    if (idx > lastIdx) {
      parts.push({ kind: "text", text: target.slice(lastIdx, idx) });
    }
    parts.push({ kind: "word", text: m[0] });
    lastIdx = idx + m[0].length;
  }
  if (lastIdx < target.length) {
    parts.push({ kind: "text", text: target.slice(lastIdx) });
  }
  return parts;
}

export function TargetTokenized({
  target,
  onTapWord,
  className = "text-2xl font-medium leading-relaxed",
}: {
  target: string;
  onTapWord: (word: string) => void;
  /** Wrapper class — defaults to the shadowing player's large style. */
  className?: string;
}) {
  const parts = tokenize(target);
  return (
    <p className={className}>
      {parts.map((part, i) =>
        part.kind === "word" ? (
          <button
            key={i}
            type="button"
            onClick={() => onTapWord(part.text)}
            className="underline decoration-dotted decoration-zinc-300 dark:decoration-zinc-700 underline-offset-4 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-sm px-0.5"
          >
            {part.text}
          </button>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </p>
  );
}
