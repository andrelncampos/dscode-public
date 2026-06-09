import type { LlmStreamProgress, SessionEntry, SkillInfo } from "../../session";
import type { ModelConfigSelection } from "../../settings";
import type { PromptDraft } from "../views/PromptInput";

export type PromptStreamState = {
  busy: boolean;
  loadingText?: string | null;
  streamProgress?: LlmStreamProgress | null;
  nowTick?: number;
  runningProcesses?: SessionEntry["processes"];
};

export type PromptModelState = {
  modelConfig: ModelConfigSelection;
  skills: SkillInfo[];
};

export type PromptDisplayState = {
  screenWidth: number;
  promptHistory: string[];
  promptDraft?: PromptDraft | null;
  helpVisible?: boolean;
  disabled?: boolean;
  placeholder?: string;
};
