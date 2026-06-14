import React, { useState, useMemo, useCallback } from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import type { McpServerStatus, McpExecutionRecord, McpErrorRecord } from "../../mcp/mcp-manager";
import type { McpPolicy } from "../../mcp/mcp-policy";
import {
  formatScopeLabel,
  getScopeColor,
  formatPolicyStats,
  getPolicyStatsColor,
  formatRelativeTime,
  truncateToolDescription,
} from "../core/mcp-tui-utils";

type McpViewMode = "server-list" | "server-detail" | "execution-history" | "error-log";

type DetailItem = {
  type: string;
  name: string;
  namespacedName: string;
  description?: string;
  policyAction?: "allow" | "ask" | "deny";
  denyReason?: string;
};

type Props = {
  statuses: McpServerStatus[];
  onCancel: () => void;
  onReconnect: (name: string) => void;
  onReconnectFromList: (name: string) => void;
  onDisableServer: (name: string) => void;
  onApproveTool: (serverName: string, toolName: string) => void;
  onDenyTool: (serverName: string, toolName: string) => void;
  onResetToolPolicy: (serverName: string, toolName: string) => void;
  executionHistory: Map<string, McpExecutionRecord[]>;
  errorLog: Map<string, McpErrorRecord[]>;
  policy?: McpPolicy;
  projectRoot: string;
};

export function McpStatusList({
  statuses,
  onCancel,
  onReconnect,
  onReconnectFromList,
  onDisableServer,
  onApproveTool,
  onDenyTool,
  onResetToolPolicy,
  executionHistory,
  errorLog,
  policy,
  projectRoot: _projectRoot,
}: Props): React.ReactElement {
  const { columns, rows } = useWindowSize();
  const [viewMode, setViewMode] = useState<McpViewMode>("server-list");
  const [selectedServerIndex, setSelectedServerIndex] = useState(0);
  const [activeServerName, setActiveServerName] = useState("");

  const goBack = useCallback(() => {
    setViewMode("server-list");
  }, []);

  const enterDetail = useCallback(() => {
    const server = statuses[selectedServerIndex];
    if (server && (server.status === "ready" || server.status === "failed" || server.status === "reconnecting")) {
      setActiveServerName(server.name);
      setViewMode("server-detail");
    }
  }, [statuses, selectedServerIndex]);

  const showHistory = useCallback((name: string) => {
    setActiveServerName(name);
    setViewMode("execution-history");
  }, []);

  const showErrors = useCallback((name: string) => {
    setActiveServerName(name);
    setViewMode("error-log");
  }, []);

  useInput((input, key) => {
    if (statuses.length === 0 && (key.escape || (key.ctrl && (input === "c" || input === "C")))) {
      onCancel();
    }
  });

  if (statuses.length === 0) {
    return (
      <Box flexDirection="column" marginLeft={1} paddingX={1} gap={1} borderStyle="round" borderDimColor>
        <Box flexDirection="column">
          <Text color="#229ac3" bold>
            Manage MCP servers
          </Text>
          <Text dimColor>0 servers</Text>
        </Box>
        <Box flexDirection="column">
          <Text dimColor>No MCP servers configured.</Text>
          <Text dimColor>Add MCP servers to your settings to get started.</Text>
        </Box>
        <Text dimColor>Esc to close</Text>
      </Box>
    );
  }

  if (viewMode === "execution-history") {
    return (
      <ExecutionHistoryView
        serverName={activeServerName}
        records={executionHistory.get(activeServerName) ?? []}
        onBack={goBack}
        rows={rows}
        columns={columns}
      />
    );
  }

  if (viewMode === "error-log") {
    return (
      <ErrorLogView
        serverName={activeServerName}
        errors={errorLog.get(activeServerName) ?? []}
        onBack={goBack}
        rows={rows}
        columns={columns}
      />
    );
  }

  if (viewMode === "server-detail") {
    return (
      <ServerDetailView
        server={statuses[selectedServerIndex]}
        onBack={goBack}
        onCancel={onCancel}
        onReconnect={onReconnect}
        onShowHistory={showHistory}
        onShowErrors={showErrors}
        onApproveTool={onApproveTool}
        onDenyTool={onDenyTool}
        onResetToolPolicy={onResetToolPolicy}
        policy={policy}
        rows={rows}
        columns={columns}
      />
    );
  }

  return (
    <ServerListView
      statuses={statuses}
      selectedIndex={selectedServerIndex}
      onSelect={setSelectedServerIndex}
      onEnter={enterDetail}
      onCancel={onCancel}
      onReconnectFromList={onReconnectFromList}
      onDisableServer={onDisableServer}
      rows={rows}
      columns={columns}
    />
  );
}

// ── Server List View ─────────────────────────────────────────────────────

function ServerListView({
  statuses,
  selectedIndex,
  onSelect,
  onEnter,
  onCancel,
  onReconnectFromList,
  onDisableServer,
  rows,
  columns,
}: {
  statuses: McpServerStatus[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onEnter: () => void;
  onCancel: () => void;
  onReconnectFromList: (name: string) => void;
  onDisableServer: (name: string) => void;
  rows: number;
  columns: number;
}): React.ReactElement {
  const [scrollOffset, setScrollOffset] = useState(0);
  const [pendingDisable, setPendingDisable] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const serverCount = statuses.length;

  const maxVisible = useMemo(() => {
    const reservedLines = 8;
    const availableLines = Math.max(0, Math.min(rows, 30) - reservedLines);
    return Math.max(1, Math.floor(availableLines / 3));
  }, [rows]);

  const labelColumnWidth = useMemo(() => {
    if (serverCount === 0) return 0;
    const longestName = Math.max(...statuses.map((s) => s.name.length + 15)); // +15 for scope label
    const contentWidth = longestName + 5;
    const maxAllowed = Math.max(20, Math.floor((columns - 6) * 0.45));
    return Math.min(contentWidth, maxAllowed);
  }, [statuses, serverCount, columns]);

  const safeIndex = useMemo(() => {
    if (serverCount === 0) return 0;
    return Math.max(0, Math.min(selectedIndex, serverCount - 1));
  }, [selectedIndex, serverCount]);

  React.useEffect(() => {
    if (safeIndex < scrollOffset) {
      setScrollOffset(safeIndex);
    } else if (safeIndex >= scrollOffset + maxVisible) {
      setScrollOffset(safeIndex - maxVisible + 1);
    }
  }, [safeIndex, scrollOffset, maxVisible]);

  const visibleServers = useMemo(() => {
    return statuses.slice(scrollOffset, scrollOffset + maxVisible);
  }, [statuses, scrollOffset, maxVisible]);

  // Clear pendingDisable on navigation
  React.useEffect(() => {
    setPendingDisable(null);
    setStatusMessage("");
  }, [selectedIndex]);

  // Auto-dismiss status message
  React.useEffect(() => {
    if (!statusMessage) return;
    const timer = setTimeout(() => setStatusMessage(""), 3000);
    return () => clearTimeout(timer);
  }, [statusMessage]);

  useInput((input, key) => {
    if (key.escape || (key.ctrl && (input === "c" || input === "C"))) {
      onCancel();
      return;
    }
    if (serverCount === 0) return;

    if (key.upArrow) {
      onSelect(Math.max(0, selectedIndex - 1));
      return;
    }
    if (key.downArrow) {
      onSelect(Math.min(serverCount - 1, selectedIndex + 1));
      return;
    }
    if (key.pageUp) {
      onSelect(Math.max(0, selectedIndex - maxVisible));
      return;
    }
    if (key.pageDown) {
      onSelect(Math.min(serverCount - 1, selectedIndex + maxVisible));
      return;
    }
    if (key.home) {
      onSelect(0);
      return;
    }
    if (key.end) {
      onSelect(serverCount - 1);
      return;
    }
    if (key.return) {
      onEnter();
      return;
    }
    // r key: reconnect from list view (only on failed servers)
    if (input === "r" && safeIndex >= 0) {
      const server = statuses[safeIndex];
      if (server && server.status === "failed") {
        onReconnectFromList(server.name);
      }
      return;
    }
    // d key: disable server with confirmation
    if (input === "d" && safeIndex >= 0) {
      const server = statuses[safeIndex];
      if (!server) return;
      if (server.disabled) {
        setStatusMessage("Server is already disabled.");
        setPendingDisable(null);
        return;
      }
      const scope = server.scope?.kind;
      if (scope === "session" || scope === "skill") {
        setStatusMessage("Session-scoped servers cannot be disabled from TUI.");
        setPendingDisable(null);
        return;
      }
      if (pendingDisable === server.name) {
        onDisableServer(server.name);
        setPendingDisable(null);
        setStatusMessage("");
        return;
      }
      setPendingDisable(server.name);
      setStatusMessage(`Press d again to disable '${server.name}'`);
      return;
    }
  });

  const readyCount = statuses.filter((s) => s.status === "ready" && !s.disabled).length;
  const startingCount = statuses.filter((s) => s.status === "starting").length;
  const reconnectingCount = statuses.filter((s) => s.status === "reconnecting").length;
  const failedCount = statuses.filter((s) => s.status === "failed" && !s.disabled).length;
  const disabledCount = statuses.filter((s) => s.disabled).length;

  return (
    <Box
      flexDirection="column"
      width={Math.max(20, columns - 6)}
      height={Math.max(5, Math.min(rows - 1, 30))}
      overflow="hidden"
      paddingX={1}
      marginTop={1}
    >
      <Box flexDirection="column" borderStyle="round" borderDimColor flexGrow={1} overflow="hidden">
        <Box paddingX={1} gap={1}>
          <Text bold color="#229ac3">
            Manage MCP servers
          </Text>
          <Box gap={1}>
            <Text dimColor>(</Text>
            <Text color="green">{readyCount} ready,</Text>
            <Text color="yellow">{startingCount} starting,</Text>
            {reconnectingCount > 0 && <Text color="#ff9900">{reconnectingCount} reconnecting,</Text>}
            <Text color="red">{failedCount} failed</Text>
            {disabledCount > 0 && <Text dimColor>, {disabledCount} disabled</Text>}
            <Text dimColor>)</Text>
          </Box>
        </Box>
        <Box
          borderTop={true}
          borderBottom={true}
          borderLeft={false}
          borderRight={false}
          borderStyle="round"
          borderDimColor
          flexDirection="column"
          flexGrow={1}
          paddingX={1}
          overflow="hidden"
        >
          {visibleServers.map((status, i) => {
            const actualIndex = scrollOffset + i;
            const isSelected = actualIndex === safeIndex;
            return (
              <ServerRow
                key={`server-${status.name}`}
                status={status}
                selected={isSelected}
                labelColumnWidth={labelColumnWidth}
              />
            );
          })}
          {scrollOffset > 0 || scrollOffset + maxVisible < serverCount ? (
            <Box marginTop={1}>
              {scrollOffset > 0 ? <Text dimColor>… {scrollOffset} servers above. </Text> : null}
              {scrollOffset + maxVisible < serverCount ? (
                <Text dimColor>… {serverCount - scrollOffset - maxVisible} servers below.</Text>
              ) : null}
            </Box>
          ) : null}
        </Box>
        {statusMessage ? (
          <Box paddingX={1}>
            <Text dimColor>{statusMessage}</Text>
          </Box>
        ) : null}
        <Box paddingX={1}>
          <Text dimColor>↑/↓ navigate · Enter details · r reconnect · d disable · Esc close</Text>
        </Box>
      </Box>
    </Box>
  );
}

function ServerRow({
  status,
  selected,
  labelColumnWidth,
}: {
  status: McpServerStatus;
  selected: boolean;
  labelColumnWidth: number;
}): React.ReactElement {
  const icon =
    status.status === "ready" ? "✓" : status.status === "failed" ? "✗" : status.status === "reconnecting" ? "↻" : "●";
  const steadyColor =
    status.status === "ready"
      ? "green"
      : status.status === "failed"
        ? "red"
        : status.status === "reconnecting"
          ? "#ff9900"
          : "yellow";

  const [flashFrame, setFlashFrame] = React.useState(-1);
  React.useEffect(() => {
    if (status.status !== "ready") {
      setFlashFrame(-1);
      return;
    }
    if (flashFrame !== -1) return;
    setFlashFrame(0);
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      if (elapsed >= 5000) {
        clearInterval(interval);
        setFlashFrame(-1);
        return;
      }
      setFlashFrame((f) => (f === -1 ? 0 : f + 1));
    }, 400);
    return () => clearInterval(interval);
  }, [status.status, flashFrame]);

  const flashing = flashFrame >= 0 && flashFrame < 13;
  const color = flashing ? (flashFrame % 2 === 0 ? "green" : "#e6b800") : steadyColor;

  const [dots, setDots] = React.useState(0);
  React.useEffect(() => {
    if (status.status !== "starting" && status.status !== "reconnecting") return;
    const interval = setInterval(() => {
      setDots((d) => (d + 1) % 4);
    }, 500);
    return () => clearInterval(interval);
  }, [status.status]);

  const scopeLabel = formatScopeLabel(status.scope);
  const scopeColor = status.scope ? getScopeColor(status.scope.kind) : undefined;
  const policyText = formatPolicyStats(status.policyStats);
  const policyColor = getPolicyStatsColor(status.policyStats);

  const detail = status.disabled
    ? "Disabled"
    : status.status === "ready"
      ? `Ready (${status.toolCount} tools, ${status.promptCount} prompts, ${status.resourceCount} resources)`
      : status.status === "failed"
        ? "Failed"
        : status.status === "reconnecting"
          ? `Reconnecting${dots > 0 ? ".".repeat(dots) : "   "}`
          : "Starting" + (dots > 0 ? ".".repeat(dots) : "   ");

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box gap={2}>
        <Box width={labelColumnWidth} flexShrink={0}>
          <Text color={selected ? "#229ac3" : undefined} dimColor={status.disabled}>
            {selected ? "> " : "  "}
            <Text color={color}>{icon} </Text>
            <Text bold>{status.name}</Text>
            {scopeLabel ? <Text color={scopeColor}> {scopeLabel}</Text> : null}
          </Text>
        </Box>
        <Box flexGrow={1}>
          <Text dimColor>
            {detail}
            {policyText ? <Text color={policyColor}> {policyText}</Text> : null}
          </Text>
        </Box>
        {status.disabled ? (
          <Box>
            <Text dimColor>[disabled]</Text>
          </Box>
        ) : null}
      </Box>

      {(status.status === "failed" || status.status === "reconnecting") && status.error ? (
        <ErrorRow error={status.error} />
      ) : null}
    </Box>
  );
}

// ── Server Detail View ───────────────────────────────────────────────────

function ServerDetailView({
  server,
  onBack,
  onCancel,
  onReconnect,
  onShowHistory,
  onShowErrors,
  onApproveTool,
  onDenyTool,
  onResetToolPolicy,
  policy,
  rows,
  columns,
}: {
  server: McpServerStatus;
  onBack: () => void;
  onCancel: () => void;
  onReconnect: (name: string) => void;
  onShowHistory: (name: string) => void;
  onShowErrors: (name: string) => void;
  onApproveTool: (serverName: string, toolName: string) => void;
  onDenyTool: (serverName: string, toolName: string) => void;
  onResetToolPolicy: (serverName: string, toolName: string) => void;
  policy?: McpPolicy;
  rows: number;
  columns: number;
}): React.ReactElement {
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [_showSchema, setShowSchema] = React.useState(false);
  const [statusMessage, setStatusMessage] = React.useState("");
  const hasReconnect = server.status === "failed";
  const canScroll = server.status === "ready";

  const allItems: DetailItem[] = useMemo(() => {
    const items: DetailItem[] = [];
    if (hasReconnect) {
      items.push({ type: "action", name: "Reconnect", namespacedName: "" });
    }
    for (const toolName of server.tools) {
      const action = policy?.evaluate(toolName) ?? "ask";
      const denyReason = action === "deny" ? (policy?.findDenyReason(toolName) ?? undefined) : undefined;
      const desc = "No description"; // descriptions populated from McpManager data if available
      items.push({
        type: "tool",
        name: toolName,
        namespacedName: toolName,
        description: desc,
        policyAction: action,
        denyReason,
      });
    }
    for (const prompt of server.prompts) {
      items.push({ type: "prompt", name: prompt, namespacedName: prompt, policyAction: "ask" });
    }
    for (const resource of server.resources) {
      items.push({ type: "resource", name: resource, namespacedName: resource, policyAction: "ask" });
    }
    return items;
  }, [server, hasReconnect, policy]);

  const totalItems = allItems.length;

  const maxVisible = useMemo(() => {
    const reservedLines = 14;
    const availableLines = Math.max(0, Math.min(rows, 30) - reservedLines);
    return Math.max(1, availableLines);
  }, [rows]);

  const visibleStartRef = React.useRef(0);

  const visibleStart = useMemo(() => {
    if (totalItems === 0) return 0;
    const currentStart = visibleStartRef.current;
    let newStart = currentStart;
    if (activeIndex < currentStart) {
      newStart = activeIndex;
    } else if (activeIndex >= currentStart + maxVisible) {
      newStart = activeIndex - maxVisible + 1;
    }
    newStart = Math.max(0, Math.min(newStart, Math.max(0, totalItems - maxVisible)));
    visibleStartRef.current = newStart;
    return newStart;
  }, [activeIndex, maxVisible, totalItems]);

  const visibleItems = allItems.slice(visibleStart, visibleStart + maxVisible);

  // Auto-dismiss status message
  React.useEffect(() => {
    if (!statusMessage) return;
    const timer = setTimeout(() => setStatusMessage(""), 2000);
    return () => clearTimeout(timer);
  }, [statusMessage]);

  useInput((input, key) => {
    if (key.ctrl && (input === "c" || input === "C")) {
      onCancel();
      return;
    }
    if (key.escape) {
      onBack();
      return;
    }
    // Tab: toggle schema
    if (key.tab) {
      setShowSchema((prev) => !prev);
      return;
    }
    // h: show history
    if (input === "h" && !key.tab) {
      onShowHistory(server.name);
      return;
    }
    // e: show errors
    if (input === "e") {
      onShowErrors(server.name);
      return;
    }
    // a: approve tool
    if (input === "a" && activeIndex >= 0 && activeIndex < allItems.length) {
      const item = allItems[activeIndex];
      if (item.type !== "tool") {
        setStatusMessage("Policy rules only apply to tools.");
        return;
      }
      onApproveTool(server.name, item.namespacedName);
      setStatusMessage(`MCP policy updated: allow ${item.namespacedName}`);
      return;
    }
    // d: deny tool
    if (input === "d" && activeIndex >= 0 && activeIndex < allItems.length) {
      const item = allItems[activeIndex];
      if (item.type !== "tool") {
        setStatusMessage("Policy rules only apply to tools.");
        return;
      }
      onDenyTool(server.name, item.namespacedName);
      setStatusMessage(`MCP policy updated: deny ${item.namespacedName}`);
      return;
    }
    // Backspace: reset tool policy
    if (key.backspace && activeIndex >= 0 && activeIndex < allItems.length) {
      const item = allItems[activeIndex];
      if (item.type !== "tool") {
        setStatusMessage("Policy rules only apply to tools.");
        return;
      }
      onResetToolPolicy(server.name, item.namespacedName);
      setStatusMessage(`MCP policy reset: ${item.namespacedName}`);
      return;
    }
    if (key.return || input === " ") {
      if (activeIndex === 0 && hasReconnect) {
        onReconnect(server.name);
        onBack();
        return;
      }
      onBack();
      return;
    }
    if (!canScroll && !hasReconnect) return;
    if (key.upArrow) {
      setActiveIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setActiveIndex((prev) => Math.min(totalItems - 1, prev + 1));
      return;
    }
    if (key.pageUp && canScroll) {
      setActiveIndex((prev) => Math.max(0, prev - maxVisible));
      return;
    }
    if (key.pageDown && canScroll) {
      setActiveIndex((prev) => Math.min(totalItems - 1, prev + maxVisible));
      return;
    }
    if (key.home && canScroll) {
      setActiveIndex(0);
      return;
    }
    if (key.end && canScroll) {
      setActiveIndex(totalItems - 1);
    }
  });

  const statusIcon =
    server.status === "ready" ? "✓" : server.status === "failed" ? "✗" : server.status === "reconnecting" ? "↻" : "●";
  const statusColor =
    server.status === "ready"
      ? "green"
      : server.status === "failed"
        ? "red"
        : server.status === "reconnecting"
          ? "#ff9900"
          : "yellow";

  const scopeLabel = server.scope ? `${server.scope.label}` : "";
  const scopeKind = server.scope?.kind ?? "";

  return (
    <Box
      flexDirection="column"
      width={Math.max(20, columns - 6)}
      height={Math.max(5, Math.min(rows - 1, 30))}
      overflow="hidden"
      paddingX={1}
      marginTop={1}
    >
      <Box flexDirection="column" borderStyle="round" borderDimColor flexGrow={1} overflow="hidden">
        <Box paddingX={1} gap={1}>
          <Text color={statusColor}>{statusIcon} </Text>
          <Text bold color="#229ac3" wrap="truncate-end">
            {server.name}
          </Text>
          <Text dimColor>— {server.status === "ready" ? "Details" : "Status"}</Text>
        </Box>
        <Box paddingX={1} marginLeft={3} flexDirection="column">
          <Text wrap="truncate-end">
            {server.status === "ready"
              ? `${server.toolCount} tools, ${server.promptCount} prompts, ${server.resourceCount} resources`
              : `Status: ${server.status}`}
          </Text>
          {scopeLabel ? (
            <Text dimColor>Source: {scopeKind === "skill" || scopeKind === "spec" ? scopeLabel : scopeLabel}</Text>
          ) : null}
        </Box>
        {server.error && (server.status === "failed" || server.status === "reconnecting") ? (
          <Box paddingX={1} marginLeft={3}>
            <ErrorRow error={server.error} />
          </Box>
        ) : null}
        <Box
          borderTop={true}
          borderBottom={true}
          borderLeft={false}
          borderRight={false}
          borderStyle="round"
          borderDimColor
          flexDirection="column"
          flexGrow={1}
          paddingX={1}
          overflow="hidden"
        >
          {visibleStart > 0 ? (
            <Box>
              <Text dimColor>▲</Text>
            </Box>
          ) : (
            <Text> </Text>
          )}
          <Box paddingX={1} flexDirection="column">
            {visibleItems.length === 0 ? (
              <Box paddingY={1}>
                <Text dimColor>No items available</Text>
              </Box>
            ) : (
              visibleItems.map((item, idx) => {
                const actualIndex = visibleStart + idx;
                const isSelected = actualIndex === activeIndex;
                return <ItemRow key={`${item.type}-${item.name}-${actualIndex}`} item={item} selected={isSelected} />;
              })
            )}
          </Box>
          {visibleStart > 0 || visibleStart + maxVisible < totalItems ? (
            <Box marginTop={1} gap={1}>
              {totalItems - visibleStart - maxVisible > 0 ? <Text dimColor>▼</Text> : <Text> </Text>}
              {visibleStart > 0 ? <Text dimColor>… {visibleStart} items above. </Text> : null}
              {totalItems - visibleStart - maxVisible > 0 ? (
                <Text dimColor>… {totalItems - visibleStart - maxVisible} items below.</Text>
              ) : null}
            </Box>
          ) : null}
        </Box>
        {statusMessage ? (
          <Box paddingX={1}>
            <Text dimColor>{statusMessage}</Text>
          </Box>
        ) : null}
        <Box paddingX={1}>
          <Text dimColor>
            {hasReconnect
              ? "Enter to reconnect · Esc back · Ctrl+C close"
              : `↑/↓ nav · Tab schema · a approve · d deny · Backspace reset · h history · e errors · Esc back`}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

function ItemRow({ item, selected }: { item: DetailItem; selected: boolean }): React.ReactElement {
  const isAction = item.type === "action";
  const icon = isAction ? "↻" : item.type === "tool" ? "🔧" : item.type === "prompt" ? "📝" : "📦";
  const highlightColor = isAction && selected ? "#ff9900" : selected ? "#229ac3" : undefined;

  const policyColor = item.policyAction === "allow" ? "green" : item.policyAction === "deny" ? "red" : "yellow";

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text color={highlightColor}>{selected ? "> " : "  "}</Text>
        <Text dimColor>{icon} </Text>
        <Box flexDirection="column" flexGrow={1}>
          <Box flexDirection="row" gap={1}>
            <Text color={highlightColor} dimColor={!selected} bold={isAction} wrap="truncate-end">
              {isAction ? `[${item.name}]` : item.name}
            </Text>
            {item.policyAction && item.type !== "action" ? (
              <Text color={policyColor}>[{item.policyAction}]</Text>
            ) : null}
          </Box>
          {item.description && item.type !== "action" ? (
            <Box marginLeft={1}>
              <Text dimColor wrap="truncate-end">
                {truncateToolDescription(item.description, 80)}
              </Text>
            </Box>
          ) : null}
        </Box>
      </Box>
      {item.policyAction === "deny" && item.denyReason ? (
        <Box marginLeft={4}>
          <Text color="red" dimColor>
            denied by: {item.denyReason}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

// ── Execution History View ───────────────────────────────────────────────

function ExecutionHistoryView({
  serverName,
  records,
  onBack,
  rows,
  columns,
}: {
  serverName: string;
  records: McpExecutionRecord[];
  onBack: () => void;
  rows: number;
  columns: number;
}): React.ReactElement {
  const [scrollOffset, setScrollOffset] = useState(0);
  const itemCount = records.length;

  const maxVisible = useMemo(() => {
    const reservedLines = 8;
    const availableLines = Math.max(0, Math.min(rows, 30) - reservedLines);
    return Math.max(1, availableLines);
  }, [rows]);

  const visibleItems = records.slice(scrollOffset, scrollOffset + maxVisible);
  const now = Date.now();

  useInput((input, key) => {
    if (key.escape || input === "h") {
      onBack();
      return;
    }
    if (key.upArrow) {
      setScrollOffset((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setScrollOffset((prev) => Math.min(Math.max(0, itemCount - maxVisible), prev + 1));
      return;
    }
    if (key.pageUp) {
      setScrollOffset((prev) => Math.max(0, prev - maxVisible));
      return;
    }
    if (key.pageDown) {
      setScrollOffset((prev) => Math.min(Math.max(0, itemCount - maxVisible), prev + maxVisible));
    }
  });

  return (
    <Box
      flexDirection="column"
      width={Math.max(20, columns - 6)}
      height={Math.max(5, Math.min(rows - 1, 30))}
      overflow="hidden"
      paddingX={1}
      marginTop={1}
    >
      <Box flexDirection="column" borderStyle="round" borderDimColor flexGrow={1} overflow="hidden">
        <Box paddingX={1} gap={1}>
          <Text bold color="#229ac3" wrap="truncate-end">
            {serverName}
          </Text>
          <Text dimColor>— Execution History</Text>
        </Box>
        <Box
          borderTop={true}
          borderBottom={true}
          borderLeft={false}
          borderRight={false}
          borderStyle="round"
          borderDimColor
          flexDirection="column"
          flexGrow={1}
          paddingX={1}
          overflow="hidden"
        >
          {visibleItems.length === 0 ? (
            <Box paddingY={1}>
              <Text dimColor>No execution history</Text>
            </Box>
          ) : (
            visibleItems.map((rec, i) => (
              <Box key={`${rec.timestamp}-${i}`} flexDirection="row" gap={1} height={1}>
                <Text color={rec.ok ? "green" : "red"}>{rec.ok ? "✓" : "✗"} </Text>
                <Text wrap="truncate-end">{rec.originalName}</Text>
                <Text dimColor>{formatRelativeTime(rec.timestamp, now)}</Text>
                <Text dimColor>{rec.durationMs}ms</Text>
                <Text dimColor wrap="truncate-end">
                  {rec.ok ? rec.outputSnippet || "(empty)" : rec.error || "error"}
                </Text>
              </Box>
            ))
          )}
        </Box>
        <Box paddingX={1}>
          <Text dimColor>↑/↓ scroll · h/Esc back</Text>
        </Box>
      </Box>
    </Box>
  );
}

// ── Error Log View ───────────────────────────────────────────────────────

function ErrorLogView({
  serverName,
  errors,
  onBack,
  rows,
  columns,
}: {
  serverName: string;
  errors: McpErrorRecord[];
  onBack: () => void;
  rows: number;
  columns: number;
}): React.ReactElement {
  const [scrollOffset, setScrollOffset] = useState(0);
  const itemCount = errors.length;

  const maxVisible = useMemo(() => {
    const reservedLines = 8;
    const availableLines = Math.max(0, Math.min(rows, 30) - reservedLines);
    return Math.max(1, availableLines);
  }, [rows]);

  const visibleItems = errors.slice(scrollOffset, scrollOffset + maxVisible);
  const now = Date.now();

  useInput((input, key) => {
    if (key.escape || input === "e") {
      onBack();
      return;
    }
    if (key.upArrow) {
      setScrollOffset((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setScrollOffset((prev) => Math.min(Math.max(0, itemCount - maxVisible), prev + 1));
      return;
    }
    if (key.pageUp) {
      setScrollOffset((prev) => Math.max(0, prev - maxVisible));
      return;
    }
    if (key.pageDown) {
      setScrollOffset((prev) => Math.min(Math.max(0, itemCount - maxVisible), prev + maxVisible));
    }
  });

  return (
    <Box
      flexDirection="column"
      width={Math.max(20, columns - 6)}
      height={Math.max(5, Math.min(rows - 1, 30))}
      overflow="hidden"
      paddingX={1}
      marginTop={1}
    >
      <Box flexDirection="column" borderStyle="round" borderDimColor flexGrow={1} overflow="hidden">
        <Box paddingX={1} gap={1}>
          <Text bold color="#229ac3" wrap="truncate-end">
            {serverName}
          </Text>
          <Text dimColor>— Error Log</Text>
        </Box>
        <Box
          borderTop={true}
          borderBottom={true}
          borderLeft={false}
          borderRight={false}
          borderStyle="round"
          borderDimColor
          flexDirection="column"
          flexGrow={1}
          paddingX={1}
          overflow="hidden"
        >
          {visibleItems.length === 0 ? (
            <Box paddingY={1}>
              <Text dimColor>No errors recorded</Text>
            </Box>
          ) : (
            visibleItems.map((rec, i) => (
              <Box key={`${rec.timestamp}-${i}`} flexDirection="row" gap={2} height={1}>
                <Text dimColor>{formatRelativeTime(rec.timestamp, now)}</Text>
                <Text wrap="truncate-end">{rec.message}</Text>
              </Box>
            ))
          )}
        </Box>
        <Box paddingX={1}>
          <Text dimColor>↑/↓ scroll · e/Esc back</Text>
        </Box>
      </Box>
    </Box>
  );
}

// ── Error Row ────────────────────────────────────────────────────────────

function ErrorRow({ error }: { error: string }): React.ReactElement {
  const lines = error.split("\n").filter((line) => line.trim().length > 0);

  return (
    <Box
      flexDirection="column"
      marginLeft={4}
      marginTop={0}
      marginBottom={0}
      borderStyle="round"
      borderColor="red"
      borderDimColor
    >
      {lines.map((line, index) => (
        <Box key={index}>
          <Text color="red" dimColor>
            {line}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
