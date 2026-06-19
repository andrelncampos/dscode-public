import React, { useEffect, useMemo, useState } from "react";
import { useInput, Text } from "ink";
import DropdownMenu from "../DropdownMenu";
import type { DropdownMenuItem } from "../DropdownMenu";
import type { ModelConfigSelection } from "../../../settings";
import {
  MODEL_CATALOG,
  THINKING_OPTIONS_BY_TYPE,
  getModelCapabilities,
  type ModelEntry,
  type ThinkingEffort,
} from "../../../common/model-catalog";
import { DEFAULT_MODEL_PRICING } from "../../../common/model-capabilities";
import { getErrorMessage } from "../../../common/error-utils.js";

type ModelStep = "model" | "thinking";

type Props = {
  open: boolean;
  modelConfig: ModelConfigSelection;
  width: number;
  onClose: () => void;
  onModelConfigChange: (selection: ModelConfigSelection) => string | Promise<string>;
  onStatusMessage?: (message: string | null) => void;
  /** Set of provider names that have configured API keys. Models for providers NOT in this set show "(no key)" suffix. */
  providerKeys?: Set<string>;
};

function getPricingIndicator(modelId: string): string {
  const pricing = DEFAULT_MODEL_PRICING[modelId];
  if (!pricing) return "?";
  if (pricing.inputPrice >= 5) return "$$$";
  if (pricing.inputPrice >= 1) return "$$";
  return "$";
}

function getThinkingOptionIndex(
  options: { effort: ThinkingEffort; thinkingEnabled: boolean }[],
  config: Pick<ModelConfigSelection, "thinkingEnabled" | "reasoningEffort">
): number {
  const index = options.findIndex((option) => {
    if (!config.thinkingEnabled) return !option.thinkingEnabled;
    return option.thinkingEnabled && option.effort === config.reasoningEffort;
  });
  return index >= 0 ? index : 0;
}

const PROVIDER_ORDER = ["deepseek", "openai", "anthropic"] as const;
const PROVIDER_LABELS: Record<string, string> = {
  deepseek: "── DeepSeek ──",
  openai: "── OpenAI ──",
  anthropic: "── Anthropic ──",
};

const ModelsDropdown: React.FC<Props> = ({
  open,
  modelConfig,
  width,
  onClose,
  onModelConfigChange,
  onStatusMessage,
  providerKeys,
}) => {
  const [step, setStep] = useState<ModelStep | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pendingModel, setPendingModel] = useState<ModelEntry | null>(null);

  // Build model items grouped by provider.
  type FlatItem = DropdownMenuItem & { _selectable?: boolean; _modelId?: string };
  const { flatItems, selectableCount } = useMemo(() => {
    const items: FlatItem[] = [];
    let selectable = 0;

    for (const provider of PROVIDER_ORDER) {
      const models = MODEL_CATALOG.filter((m) => m.provider === provider).sort(
        (a, b) => b.contextWindow - a.contextWindow
      );

      if (models.length === 0) continue;

      // Header row (non-selectable).
      items.push({
        key: `header-${provider}`,
        label: PROVIDER_LABELS[provider] ?? provider,
        selected: false,
        _selectable: false,
      });

      for (const model of models) {
        const pricing = getPricingIndicator(model.id);
        const isCurrent = model.id === modelConfig.model;
        const hasKey = !providerKeys || providerKeys.has(model.provider);
        const parts: string[] = [model.displayName, pricing];
        if (isCurrent) parts.push("(current)");
        if (!hasKey) parts.push("(no key)");

        items.push({
          key: model.id,
          label: parts.join("  "),
          description: isCurrent ? "current model" : "",
          selected: isCurrent,
          _selectable: true,
          _modelId: model.id,
        });
        selectable++;
      }
    }

    return { flatItems: items, selectableCount: selectable };
  }, [modelConfig.model, providerKeys]);

  // Initialize state when opened.
  useEffect(() => {
    if (open) {
      // Find the current model's position in the selectable items.
      let selIdx = 0;
      for (const item of flatItems) {
        if (item._selectable) {
          if (item._modelId === modelConfig.model) {
            break;
          }
          selIdx++;
        }
      }
      if (selIdx >= selectableCount) selIdx = 0;
      setPendingModel(null);
      setStep("model");
      setActiveIndex(selIdx);
    } else {
      setStep(null);
    }
  }, [open, modelConfig.model, flatItems, selectableCount]);

  // Validate activeIndex bounds.
  useEffect(() => {
    if (step === "model" && activeIndex >= selectableCount) {
      setActiveIndex(Math.max(0, selectableCount - 1));
    }
  }, [activeIndex, step, selectableCount]);

  function selectModel(): void {
    const models = MODEL_CATALOG.filter((m) => {
      // Find model matching the selectable index.
      let idx = 0;
      for (const mi of flatItems) {
        if (mi._selectable) {
          if (idx === activeIndex && mi._modelId === m.id) return true;
          idx++;
        }
      }
      return false;
    });
    const model = models[0] ?? MODEL_CATALOG[0]!;
    setPendingModel(model);
    setStep("thinking");

    const options = THINKING_OPTIONS_BY_TYPE[model.reasoning.type] ?? THINKING_OPTIONS_BY_TYPE.none;
    setActiveIndex(getThinkingOptionIndex(options, modelConfig));
  }

  function selectThinking(): void {
    const model = pendingModel ?? getModelCapabilities(modelConfig.model) ?? MODEL_CATALOG[0]!;
    const options = THINKING_OPTIONS_BY_TYPE[model.reasoning.type] ?? THINKING_OPTIONS_BY_TYPE.none;
    const option = options[activeIndex] ?? options[0]!;
    const selection: ModelConfigSelection = {
      model: model.id,
      thinkingEnabled: option.thinkingEnabled,
      reasoningEffort: option.effort,
    };
    onClose();
    Promise.resolve(onModelConfigChange(selection))
      .then((message) => {
        if (message) onStatusMessage?.(message);
      })
      .catch((error) => {
        const msg = getErrorMessage(error);
        onStatusMessage?.(`Failed to update model settings: ${msg}`);
      });
  }

  useInput(
    (input, key) => {
      if (!step) return;

      if (step === "model") {
        if (key.upArrow) {
          setActiveIndex((idx) => (idx - 1 + selectableCount) % selectableCount);
          return;
        }
        if (key.downArrow) {
          setActiveIndex((idx) => (idx + 1) % selectableCount);
          return;
        }
        if ((input === " " && !key.ctrl && !key.meta) || (key.return && !key.shift && !key.meta)) {
          selectModel();
          return;
        }
        if (key.tab || key.escape) {
          onClose();
          return;
        }
      } else if (step === "thinking") {
        const options =
          THINKING_OPTIONS_BY_TYPE[pendingModel?.reasoning.type ?? "none"] ?? THINKING_OPTIONS_BY_TYPE.none;
        const optionCount = options.length;

        if (key.upArrow) {
          setActiveIndex((idx) => (idx - 1 + optionCount) % optionCount);
          return;
        }
        if (key.downArrow) {
          setActiveIndex((idx) => (idx + 1) % optionCount);
          return;
        }
        if ((input === " " && !key.ctrl && !key.meta) || (key.return && !key.shift && !key.meta)) {
          selectThinking();
          return;
        }
        if (key.escape) {
          setStep("model");
          // Reset active index to the pending model position.
          if (pendingModel) {
            let selIdx = 0;
            for (const item of flatItems) {
              if (item._selectable) {
                if (item._modelId === pendingModel.id) break;
                selIdx++;
              }
            }
            setActiveIndex(Math.min(selIdx, selectableCount - 1));
          }
          return;
        }
      }
    },
    { isActive: open }
  );

  if (!open || !step) return null;

  if (step === "model") {
    // Map the selectable activeIndex to the displayed flatItems list.
    const flatWithHeaders: DropdownMenuItem[] = flatItems.map((item, _flatIdx) => {
      // Compute a display index: how many selectable items have we passed?
      if (!item._selectable) {
        return { ...item, selected: false };
      }
      // Map the selectable index to flat index.
      return { ...item };
    });

    // Compute the active flat index from selectable activeIndex.
    let activeFlatIdx = 0;
    let selCount = 0;
    for (let i = 0; i < flatItems.length; i++) {
      if (flatItems[i]._selectable) {
        if (selCount === activeIndex) {
          activeFlatIdx = i;
          break;
        }
        selCount++;
      }
    }

    return (
      <DropdownMenu
        width={Math.max(width, 50)}
        title="Select Model"
        helpText="Space/Enter select · Esc to cancel"
        items={flatWithHeaders}
        activeIndex={activeFlatIdx}
        activeColor="#229ac3"
        maxVisible={12}
        renderItem={(item, isActive) => {
          const flatItem = item as FlatItem;
          const isHeader = !flatItem._selectable;
          if (isHeader) {
            return <Text dimColor>{item.label}</Text>;
          }
          const hasKey = item.key
            ? !providerKeys || providerKeys.has(MODEL_CATALOG.find((m) => m.id === flatItem._modelId)?.provider ?? "")
            : true;
          return (
            <Text dimColor={!hasKey}>
              {isActive ? "❯ " : "  "}
              {item.label}
            </Text>
          );
        }}
      />
    );
  }

  // Step === "thinking"
  const model = pendingModel ?? MODEL_CATALOG[0]!;
  const options = THINKING_OPTIONS_BY_TYPE[model.reasoning.type] ?? THINKING_OPTIONS_BY_TYPE.none;
  const thinkingItems: DropdownMenuItem[] = options.map((option, i) => ({
    key: option.label,
    label: option.label,
    description: option.thinkingEnabled ? `effort: ${option.effort}` : "thinking disabled",
    selected: getThinkingOptionIndex(options, modelConfig) === i,
  }));

  return (
    <DropdownMenu
      width={width}
      title={`Thinking Mode — ${model.displayName}`}
      helpText="Space/Enter apply · Esc to go back"
      items={thinkingItems}
      activeIndex={activeIndex}
      activeColor="#229ac3"
      maxVisible={8}
    />
  );
};

export { getThinkingOptionIndex };
export default ModelsDropdown;
