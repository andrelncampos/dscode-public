import React, { useMemo, useState } from "react";
import { Box, Text } from "ink";
import * as os from "node:os";
import path from "node:path";
import type { SkillInfo } from "../../session";
import type { ResolvedDeepcodingSettings } from "../../settings";
import { buildSlashCommands, BUILTIN_SLASH_COMMANDS, formatSlashCommandDescription } from "../core/slash-commands";
import type { I18nTFunction } from "../../i18n/translate";
import { useLocale } from "../../i18n/context";
import { ThemedGradient } from "./ThemedGradient";
import { AsciiLogo } from "../ascii-art";
import { useAppContext } from "../contexts";
import { WELCOME_PANEL_MIN_WIDTH } from "../core/layout-constants";
import { detectTerminalRuntime } from "../core/terminal-runtime";
import { useKittyProtocolActive } from "../hooks";

type WelcomeScreenProps = {
  projectRoot: string;
  settings: ResolvedDeepcodingSettings;
  skills: SkillInfo[];
  width: number;
};

function getShortcutTips(t: I18nTFunction, kittyActive: boolean): Array<{ label: string; description: string }> {
  const profile = detectTerminalRuntime();
  const shiftEnterWorks = kittyActive || profile.shiftEnterCapable;
  const primaryNewline = shiftEnterWorks ? "Shift+Enter" : "Ctrl+J";
  const tips: Array<{ label: string; description: string }> = [
    { label: "Enter", description: t("welcome.tip-send-prompt") },
    { label: primaryNewline, description: t("welcome.tip-insert-newline") },
  ];
  // Show the alternative newline shortcut as a separate tip
  if (shiftEnterWorks) {
    tips.push({ label: "Ctrl+J", description: t("welcome.tip-insert-newline-alt") });
  } else {
    tips.push({ label: "\\ + Enter", description: t("welcome.tip-insert-newline-alt") });
  }
  tips.push(
    { label: "Ctrl+V", description: t("welcome.tip-paste-image") },
    { label: "Esc", description: t("welcome.tip-interrupt") },
    { label: "/", description: t("welcome.tip-slash-commands") },
    { label: "Ctrl+D twice", description: t("welcome.tip-quit") }
  );
  return tips;
}

export function WelcomeScreen({ projectRoot, settings, skills, width }: WelcomeScreenProps): React.ReactElement {
  const { version } = useAppContext();
  const { t } = useLocale();
  const kittyActive = useKittyProtocolActive();
  const tips = useMemo(() => buildWelcomeTips(skills, t, kittyActive), [skills, t, kittyActive]);
  const [tipIndex] = useState(() => randomTipIndex(tips.length));
  const compact = width < WELCOME_PANEL_MIN_WIDTH + 20;
  const cwd = formatHomeRelativePath(projectRoot);
  const tip = tips[Math.min(tipIndex, Math.max(0, tips.length - 1))] ?? tips[0];
  const effortLabel = settings.thinkingEnabled ? settings.reasoningEffort : "--";

  return (
    <Box flexDirection="column" marginY={1}>
      {/* Logo with cyberpunk gradient */}
      <Box justifyContent="center">
        <ThemedGradient bold>{AsciiLogo}</ThemedGradient>
      </Box>

      {/* Status bar */}
      <Box justifyContent="center" marginTop={1} paddingX={2}>
        <Text dimColor>
          ▸ <Text color="#06b6d4">{settings.model}</Text>
          {"  │  "}
          thinking: <Text color={settings.thinkingEnabled ? "#06b6d4" : "gray"}>{effortLabel}</Text>
          {"  │  "}
          {t("status.cwd")}: <Text color="#06b6d4">{compact ? "~" : cwd}</Text>
          {"  ◈"}
        </Text>
      </Box>

      {/* Version line */}
      <Box justifyContent="center" marginTop={compact ? 0 : 0}>
        <Text color="gray" dimColor>
          {t("welcome.version", { version: version || "unknown" })}{" "}
          <Text dimColor>{t("welcome.label-by")} Andre LN Campos</Text> —{" "}
          {settings.thinkingEnabled ? t("welcome.thinking-active") : t("welcome.non-thinking")}
        </Text>
      </Box>

      {/* Random tip */}
      {tip ? (
        <Box justifyContent="center" marginTop={2}>
          <Text dimColor>
            <Text color="#7b2fff">▸</Text> <Text color="gray">{tip.label}</Text>
            {" — "}
            {tip.description}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

export function formatHomeRelativePath(value: string, home = os.homedir()): string {
  const normalizedValue = path.resolve(value);
  const normalizedHome = path.resolve(home);
  const relative = path.relative(normalizedHome, normalizedValue);

  if (relative === "") {
    return "~";
  }
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    return `~${path.sep}${relative}`;
  }
  return normalizedValue;
}

export function buildWelcomeTips(
  skills: SkillInfo[],
  t: I18nTFunction,
  kittyActive = false
): Array<{ label: string; description: string }> {
  const slashTips = buildSlashCommands(skills)
    .filter((item) => item.kind !== "skill" || item.skill?.isLoaded)
    .map((item) => ({
      label: item.label,
      description: formatSlashCommandDescription(item.description, t),
    }));

  return [
    ...slashTips,
    ...getShortcutTips(t, kittyActive).filter(
      (tip) => !BUILTIN_SLASH_COMMANDS.some((command) => command.label === tip.label)
    ),
  ];
}

function randomTipIndex(length: number): number {
  return length > 0 ? Math.floor(Math.random() * length) : 0;
}
