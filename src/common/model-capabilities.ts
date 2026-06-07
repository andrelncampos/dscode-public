// Registry of DeepSeek V4 model names. Kept as documentation — if a non-V4
// model is added in the future, gating logic can reference this set.
export const DEEPSEEK_V4_MODELS = new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);

export function defaultsToThinkingMode(_model: string): boolean {
  return true;
}
