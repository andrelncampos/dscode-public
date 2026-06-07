import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { RuntimeReasoningEffortManager, type TurnInput } from "../common/reasoning-effort-manager";

function mkExec(ok: boolean, name = "bash"): TurnInput["toolExecutions"][number] {
  return { ok, name, output: ok ? "success" : undefined, error: ok ? undefined : "fail" };
}

function mkCall(name: string, args: string): TurnInput["toolCalls"][number] {
  return { id: "call-1", type: "function", function: { name, arguments: args } };
}

describe("RuntimeReasoningEffortManager", () => {
  test("starts at max", () => {
    const m = new RuntimeReasoningEffortManager();
    assert.equal(m.getCurrentEffort(), "max");
  });

  test("escalates on 2 consecutive failures (from high)", () => {
    const m = new RuntimeReasoningEffortManager();
    // Force to "high" so we can test escalation behaviour
    (m as any).state.currentEffort = "high";
    assert.equal(m.getCurrentEffort(), "high");
    assert.equal(
      m.evaluate({
        toolCalls: [mkCall("bash", '{"cmd":"x"}')],
        toolExecutions: [mkExec(false)],
      }),
      null
    );
    assert.equal(m.getCurrentEffort(), "high");
    assert.equal(
      m.evaluate({
        toolCalls: [mkCall("bash", '{"cmd":"y"}')],
        toolExecutions: [mkExec(false)],
      }),
      "max"
    );
    assert.equal(m.getCurrentEffort(), "max");
  });

  test("resets failure counter on success (from high)", () => {
    const m = new RuntimeReasoningEffortManager();
    (m as any).state.currentEffort = "high";
    m.evaluate({ toolCalls: [mkCall("bash", "{}")], toolExecutions: [mkExec(false)] });
    m.evaluate({ toolCalls: [mkCall("bash", "{}")], toolExecutions: [mkExec(true)] });
    m.evaluate({ toolCalls: [mkCall("bash", "{}")], toolExecutions: [mkExec(false)] });
    assert.equal(m.getCurrentEffort(), "high"); // success resets failure counter
  });

  test("escalates on 3 identical tool calls (from high)", () => {
    const m = new RuntimeReasoningEffortManager();
    (m as any).state.currentEffort = "high";
    const call = mkCall("read", '{"file_path":"/x"}');
    assert.equal(m.evaluate({ toolCalls: [call], toolExecutions: [mkExec(true)] }), null);
    assert.equal(m.evaluate({ toolCalls: [call], toolExecutions: [mkExec(true)] }), null);
    assert.equal(m.evaluate({ toolCalls: [call], toolExecutions: [mkExec(true)] }), "max");
  });

  test("downgrade from max is disabled (always returns null)", () => {
    const m = new RuntimeReasoningEffortManager();
    assert.equal(m.getCurrentEffort(), "max");
    // Even after many clean turns with different fingerprints, stays at max
    for (let i = 0; i < 20; i++) {
      const call = mkCall("bash", `{"cmd":"unique${i}"}`);
      assert.equal(m.evaluate({ toolCalls: [call], toolExecutions: [mkExec(true)] }), null);
    }
    assert.equal(m.getCurrentEffort(), "max");
  });

  test("fingerprint is independent of argument whitespace", () => {
    const fp1 = RuntimeReasoningEffortManager.computeFingerprint([
      { id: "a", type: "function", function: { name: "bash", arguments: '{"cmd":  "x"}' } },
    ]);
    const fp2 = RuntimeReasoningEffortManager.computeFingerprint([
      { id: "b", type: "function", function: { name: "bash", arguments: '{"cmd":"x"}' } },
    ]);
    assert.equal(fp1, fp2);
  });

  test("reset clears all state back to max", () => {
    const m = new RuntimeReasoningEffortManager();
    assert.equal(m.getCurrentEffort(), "max");
    // Force to "high" then reset
    (m as any).state.currentEffort = "high";
    assert.equal(m.getCurrentEffort(), "high");
    m.reset();
    assert.equal(m.getCurrentEffort(), "max");
    assert.equal(m.getState().consecutiveFailures, 0);
    assert.equal(m.getState().cleanTurnStreak, 0);
  });

  test("no escalation from max (already at maximum)", () => {
    const m = new RuntimeReasoningEffortManager();
    assert.equal(m.getCurrentEffort(), "max");
    // Failures at max should NOT escalate further (already at max)
    assert.equal(m.evaluate({ toolCalls: [mkCall("bash", "{}")], toolExecutions: [mkExec(false)] }), null);
    assert.equal(m.evaluate({ toolCalls: [mkCall("bash", "{}")], toolExecutions: [mkExec(false)] }), null);
    assert.equal(m.getCurrentEffort(), "max");
  });
});
