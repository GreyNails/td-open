import { useRef, useState } from "react";
import type { Project } from "./types";
import { mentionedNodes } from "./assistantContext";

export function AssistantComposer({
  value,
  onChange,
  onSend,
  project,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  project: Project;
}) {
  const input = useRef<HTMLTextAreaElement>(null),
    [caret, setCaret] = useState(0),
    [active, setActive] = useState(0),
    [dismissed, setDismissed] = useState(false);
  const match = value.slice(0, caret).match(/@([^\s@]*)$/),
    query = match?.[1].toLowerCase();
  const candidates =
    query !== undefined && !dismissed
      ? project.nodes
          .filter((n) =>
            `${n.id} ${n.data.label} ${n.type}`.toLowerCase().includes(query),
          )
          .slice(0, 12)
      : [];
  const refs = mentionedNodes(value, project);
  const choose = (id: string) => {
    if (!match) return;
    const start = caret - match[0].length,
      text = value.slice(0, start) + "@" + id + " " + value.slice(caret),
      next = start + id.length + 2;
    onChange(text);
    setCaret(next);
    setDismissed(true);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(next, next);
    });
  };
  return (
    <div className="assistant-input">
      {refs.length > 0 && (
        <div className="assistant-references" aria-label="引用的节点">
          {refs.map((id) => (
            <span key={id} title={id}>
              @{project.nodes.find((n) => n.id === id)?.data.label} · 参数 /
              输入 / 输出
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={input}
        aria-label="对话指令"
        placeholder="输入 @ 引用节点，描述你想做的修改…"
        rows={3}
        value={value}
        aria-controls={candidates.length ? "assistant-mentions" : undefined}
        aria-expanded={candidates.length > 0}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart);
          setActive(0);
          setDismissed(false);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (
            candidates.length &&
            !e.shiftKey &&
            ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)
          ) {
            e.preventDefault();
            if (e.key === "Escape") setDismissed(true);
            else if (e.key === "ArrowDown")
              setActive((active + 1) % candidates.length);
            else if (e.key === "ArrowUp")
              setActive((active + candidates.length - 1) % candidates.length);
            else choose(candidates[Math.min(active, candidates.length - 1)].id);
          } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
      />
      {candidates.length > 0 && (
        <div
          id="assistant-mentions"
          className="assistant-mentions"
          role="listbox"
          aria-label="选择引用节点"
        >
          {candidates.map((node, i) => (
            <button
              key={node.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(node.id)}
            >
              <strong>{node.data.label}</strong>
              <small>
                {node.id} · {node.type}
              </small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
