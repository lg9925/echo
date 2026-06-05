// 德国入籍考试 — pure filtering for practice (no React, no DB).
//
// Lets the learner narrow practice by 批次(day) / 主题(category) / 技巧标签(tags)
// and by mistake state (只练错题 / 未做过). study/tags being empty must never
// exclude a question except via an explicit tag filter.

import type { QuizProgress, QuizQuestion } from "../types";

export type QuizStatusFilter = "all" | "wrong" | "unseen";

export interface QuizFilter {
  day: number | null; // D1–D6, null = any
  category: string | null; // null = any
  tags: string[]; // OR semantics; empty = no tag constraint
  status: QuizStatusFilter;
}

export const EMPTY_FILTER: QuizFilter = {
  day: null,
  category: null,
  tags: [],
  status: "all",
};

export function filterQuestions(
  questions: readonly QuizQuestion[],
  filter: QuizFilter,
  progressById: Map<number, QuizProgress>,
): QuizQuestion[] {
  return questions.filter((q) => {
    if (filter.day !== null && q.day !== filter.day) return false;
    if (filter.category !== null && q.category !== filter.category) return false;
    if (filter.tags.length > 0 && !filter.tags.some((t) => q.tags.includes(t)))
      return false;
    if (filter.status !== "all") {
      const p = progressById.get(q.id);
      if (filter.status === "wrong" && p?.lastResult !== "wrong") return false;
      if (filter.status === "unseen" && p && p.attempts > 0) return false;
    }
    return true;
  });
}

/** Distinct facet values present in the bank, for building the filter UI. */
export function quizFacets(questions: readonly QuizQuestion[]): {
  categories: string[];
  days: number[];
  tags: string[];
} {
  return {
    categories: [...new Set(questions.map((q) => q.category))].sort(),
    days: [...new Set(questions.map((q) => q.day))].sort((a, b) => a - b),
    tags: [...new Set(questions.flatMap((q) => q.tags))].sort(),
  };
}
