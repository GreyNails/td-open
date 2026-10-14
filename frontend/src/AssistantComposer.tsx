import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Ref } from "react";
import type { Project } from "./types";
import { mentionedNodes } from "./assistantContext";

export type AssistantComposerHandle = { pickNode: (id: string) => boolean };

export function AssistantComposer({
  ref,
  value,
  onChange,
  onSend,
  project,
  history,
}: {
  ref?: Ref<AssistantComposerHandle>;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  project: Project;
  history: string[];
}) {
  const input = useRef<HTMLTextAreaElement>(null),
    [caret, setCaret] = useState(0),
    [active, setActive] = useState(0),
    [dismissed, setDismissed] = useState(false),
    [historyIndex, setHistoryIndex] = useState<number | null>(null),
    draft = useRef("");
  useEffect(() => {
    setHistoryIndex(null);
    draft.current = "";
  }, [history.length, project.id]);
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
  const focusAt = (next: number) => {
    setCaret(next);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(next, next);
    });
  };
  const choose = (id: string) => {
    if (!match || dismissed || !project.nodes.some((n) => n.id === id))
      return false;
    const start = caret - match[0].length,
      text = value.slice(0, start) + "@" + id + " " + value.slice(caret),
      next = start + id.length + 2;
    onChange(text);
    setHistoryIndex(null);
    setDismissed(true);
    focusAt(next);
    return true;
  };
  useImperativeHandle(ref, () => ({ pickNode: choose }));
  const recall = (direction: -1 | 1) => {
    if (!history.length || (direction === 1 && historyIndex === null))
      return false;
    if (historyIndex === null) draft.current = value;
    const next = Math.max(
      0,
      Math.min(history.length, (historyIndex ?? history.length) + direction),
    );
    const text = next === history.length ? draft.current : history[next];
    setHistoryIndex(next === history.length ? null : next);
    setDismissed(true);
    onChange(text);
    focusAt(text.length);
    return true;
  };
  return (
    <div className="assistant-input">
      <div className="assistant-compose-hint" aria-live="polite">
        {match && !dismissed
          ? "点击画布中的节点完成引用 · Esc 取消"
          : "↑ 调取上一条输入 · ↓ 返回下一条 / 草稿"}
      </div>
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
          setHistoryIndex(null);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.ctrlKey || e.metaKey || e.altKey)
            return;
          if (e.key === "Escape" && match && !dismissed) {
            e.preventDefault();
            setDismissed(true);
            return;
          }
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
          } else if (
            !e.shiftKey &&
            (e.key === "ArrowUp" || e.key === "ArrowDown") &&
            !(match && !dismissed)
          ) {
            const { selectionStart: start, selectionEnd: end } =
              e.currentTarget;
            const direction = e.key === "ArrowUp" ? -1 : 1;
            // Preserve normal cursor movement inside multiline drafts. Once
            // browsing history, arrows walk messages regardless of line count.
            const boundary =
              direction === -1
                ? !value.slice(0, start).includes("\n")
                : !value.slice(end).includes("\n");
            if (
              start === end &&
              (historyIndex !== null || boundary) &&
              recall(direction)
            )
              e.preventDefault();
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
