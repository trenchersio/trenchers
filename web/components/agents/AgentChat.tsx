"use client";
import { useEffect, useRef, useState } from "react";
import { TextButton } from "@/components/TextButton";
import { DEFAULT_RULE, describe, parse, validate, type CustomRule } from "@/lib/custom-strategy";

import type { ChatMsg } from "@/lib/agents-store";

const EXAMPLES = [
  "Only new launches with more than 3 ETH liquidity. Take profit at 40%, stop loss 20%.",
  "Buy when volume crosses $100k, hold for 2 minutes.",
  "Only tokens launched in the last 10 minutes.",
];
const HELP = "I understand signals (new launches, graduations, volume or market-cap thresholds, dev sells, DexScreener updates), exits (after a set time, or take profit / stop loss) and filters (token age, minimum liquidity).";

/**
 * Talk to your agent. Each message is read into a typed rule (deterministic, no language model in
 * the trading path). The agent proposes the new rule; nothing changes until the holder applies it.
 */
export function AgentChat({ id, rule, chat, onChat, onApply, disabled }: {
  id: number; rule: CustomRule | null; chat: ChatMsg[];
  onChat: (c: ChatMsg[]) => void; onApply: (rule: CustomRule, c: ChatMsg[]) => void; disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const intro: ChatMsg = { role: "agent", t: 0, text: `I'm Trencher #${id}. Tell me how to trade, in plain English, and keep guiding me as the market changes. I'll turn every message into a rule you confirm. ${HELP}` };
  const msgs = chat.length ? chat : [intro];
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" }); }, [msgs.length]);

  const pending = [...msgs].reverse().find((m) => m.status === "proposed");
  const current = pending?.rule ?? rule ?? DEFAULT_RULE;

  function send(raw: string) {
    const said = raw.trim();
    if (!said) return;
    const base = msgs.map((m) => ({ ...m, status: m.status === "proposed" ? "discarded" as const : m.status }));
    const you: ChatMsg = { role: "you", text: said, t: Date.now() };
    const { rule: next, understood, missed } = parse(said, current);
    let reply: ChatMsg;
    if (missed) {
      reply = { role: "agent", t: Date.now() + 1, text: `I couldn't place that in a rule yet. ${HELP}` };
    } else {
      const problem = validate(next);
      reply = problem
        ? { role: "agent", t: Date.now() + 1, text: `Got: ${understood.join(", ")}. One thing missing: ${problem}` }
        : { role: "agent", t: Date.now() + 1, text: `Got it: ${understood.join(", ")}. Here's the rule I'd trade:`, rule: next, status: "proposed" };
    }
    onChat([...(chat.length ? base : [intro]), you, reply]);
    setText("");
  }

  function apply(m: ChatMsg) {
    const c = msgs.map((x) => (x === m ? { ...x, status: "applied" as const } : x.status === "proposed" ? { ...x, status: "discarded" as const } : x));
    const done: ChatMsg = { role: "agent", t: Date.now(), text: "Rule applied. I'll trade it around the clock, within your limits. Talk to me any time to change it." };
    onApply(m.rule!, [...c, done]);
  }
  function discard(m: ChatMsg) {
    onChat(msgs.map((x) => (x === m ? { ...x, status: "discarded" as const } : x)).concat({ role: "agent", t: Date.now(), text: "Discarded. Your current rule stays as it is." }));
  }

  return (
    <div className="chat">
      <div className="chat-log" ref={box}>
        {msgs.map((m, i) => (
          <div key={`${m.t}-${i}`} className={`msg msg-${m.role}`}>
            {m.role === "agent" && <img src={`nft/${id}.webp`} alt="" width={28} height={28} className="msg-av" />}
            <div className="msg-body">
              <p>{m.text}</p>
              {m.rule && (
                <div className={`msg-rule msg-${m.status}`}>
                  <span className="mono">{m.status === "applied" ? "Active rule" : m.status === "discarded" ? "Discarded" : "Proposed rule"}</span>
                  <b>{describe(m.rule)}</b>
                  {m.status === "proposed" && (
                    <div className="msg-actions">
                      <TextButton onClick={() => apply(m)} disabled={disabled}>Apply rule</TextButton>
                      <TextButton onClick={() => discard(m)} disabled={disabled}>Discard</TextButton>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {msgs.length <= 1 && (
        <div className="chat-ex">
          {EXAMPLES.map((e) => <button key={e} type="button" className="chat-chip" onClick={() => send(e)} disabled={disabled}>{e}</button>)}
        </div>
      )}
      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Tell your agent how to trade…" disabled={disabled} aria-label="Message your agent" />
        <TextButton onClick={() => send(text)} disabled={disabled || !text.trim()}>Send</TextButton>
      </form>
    </div>
  );
}
