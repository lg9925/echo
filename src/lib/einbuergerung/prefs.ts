// 德国入籍考试 — small UI preferences (localStorage). Keeping the Chinese
// hidden by default forces active recall of the German; power users can flip it.

const SHOW_ZH_KEY = "echo:einb:showZh";

/** Whether to show the Chinese translation by default. Default: false (hidden). */
export function getShowZh(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SHOW_ZH_KEY) === "1";
}

export function setShowZh(value: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SHOW_ZH_KEY, value ? "1" : "0");
}
