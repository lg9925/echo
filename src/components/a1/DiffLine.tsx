"use client";

// Character-diff highlight line for dictation feedback: green = correct,
// red strikethrough = the reference character the user missed/replaced,
// red underline = an extra character the user typed.

import type { DiffOp } from "@/lib/a1/charDiff";

export function DiffLine({ ops }: { ops: DiffOp[] }) {
  return (
    <p className="text-xl leading-relaxed font-medium break-words">
      {ops.map((op, i) => {
        if (op.op === "same") {
          return (
            <span key={i} className="text-green-700 dark:text-green-400">
              {op.ref}
            </span>
          );
        }
        if (op.op === "sub") {
          return (
            <span key={i}>
              <span className="text-red-600 dark:text-red-400 line-through">
                {op.typed}
              </span>
              <span className="text-zinc-900 dark:text-zinc-100 bg-amber-100 dark:bg-amber-900 rounded-sm">
                {op.ref}
              </span>
            </span>
          );
        }
        if (op.op === "del") {
          return (
            <span
              key={i}
              className="text-zinc-900 dark:text-zinc-100 bg-amber-100 dark:bg-amber-900 rounded-sm"
            >
              {op.ref}
            </span>
          );
        }
        return (
          <span key={i} className="text-red-600 dark:text-red-400 line-through">
            {op.typed}
          </span>
        );
      })}
    </p>
  );
}
