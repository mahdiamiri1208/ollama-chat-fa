"use client";

import { useRef, useState, useEffect, useCallback, useId } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import "./chat.css";

const PREFERRED_DEFAULT = "gpt-oss:20b";
const STORAGE_KEY = "ollama-chat/v1";

const STARTERS = [
  "برای بازی و گیمینگ چی پیشنهاد می‌کنی؟",
  "ارزان‌ترین محصول فروشگاه چیه؟",
  "هدفون آریا X2 موجوده؟",
];

// Raw HTML from the model is rendered (rehype-raw), so block the elements that
// can load remote content or run code. Tool output such as file contents can
// contain prompt-injected HTML.
const BLOCKED_HTML = [
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "link",
  "meta",
  "base",
];

/* ---------------------------------------------------------------- helpers */

const uid = () => Math.random().toString(36).slice(2, 10);

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

// Convert Latin digits to Persian ones and use the Persian decimal separator.
function toPersianNumber(value) {
  return String(value)
    .replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)])
    .replace(".", "٫");
}

function formatSeconds(ms) {
  if (ms === null || ms === undefined) return "";
  return `${toPersianNumber((ms / 1000).toFixed(1))} ثانیه`;
}

function formatShortDuration(ms) {
  if (!ms && ms !== 0) return "";
  if (ms < 1000) return `${toPersianNumber(Math.round(ms))} میلی‌ثانیه`;
  return formatSeconds(ms);
}

function loadState() {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function saveState(patch) {
  if (typeof window === "undefined") return;
  try {
    const current = loadState() || {};
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {
    // Storage can be full or blocked; persistence is a convenience, not a requirement.
  }
}

// Patch that closes the thinking phase and freezes its final duration.
function endThinking(m) {
  if (!m.thinkingLive) return { thinkingLive: false };
  return {
    thinkingLive: false,
    thinkingMs: Date.now() - (m.thinkingStart || Date.now()),
  };
}

// Error notes and placeholders are UI-only; they must not be sent back to the
// model as if it had said them.
function toApiMessages(history) {
  return history
    .filter((m) => m.content && !m.isError && !m.synthetic)
    .map(({ role, content }) => ({ role, content }));
}

/* ------------------------------------------------------------------ icons */

const Icon = {
  Send: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  ),
  Stop: (p) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
      <rect x="7" y="7" width="10" height="10" rx="2" />
    </svg>
  ),
  Copy: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </svg>
  ),
  Refresh: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 5v6h-6" />
    </svg>
  ),
  Chevron: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  ),
  Plus: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      {...p}
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  Brain: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-1 5.8A3 3 0 0 0 7 18a3 3 0 0 0 5 1.2V4.8A3 3 0 0 0 9 4Z" />
      <path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 1 5.8A3 3 0 0 1 17 18a3 3 0 0 1-5 1.2" />
    </svg>
  ),
  Sun: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      {...p}
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" />
    </svg>
  ),
  Moon: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
    </svg>
  ),
  Down: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="M12 5v14M6 13l6 6 6-6" />
    </svg>
  ),
  Check: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  ),
  Map: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      {...p}
    >
      <path d="M4 4v16h16" strokeWidth="1.3" />
      <circle cx="9" cy="15" r="2" />
      <circle cx="13" cy="8" r="2" />
      <circle cx="18" cy="13" r="2" />
    </svg>
  ),
  X: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      {...p}
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
};

/* ------------------------------------------------------------- code block */

function CodeBlock({ language, code }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard permission denied.
    }
  }

  return (
    <div className="code-block">
      <div className="code-head">
        <span>{language}</span>
        <span className="spacer" />
        <button className="mini-btn" onClick={copy} type="button">
          {copied ? "کپی شد" : "کپی"}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

const markdownComponents = {
  table: (props) => (
    <div className="table-wrap">
      <table {...props} />
    </div>
  ),
  // Never auto-load remote images: the URL itself could leak data. Show the alt text only.
  img: ({ alt }) => (alt ? <span>{alt}</span> : null),
  pre: ({ children }) => <>{children}</>,
  code({ className, children, ...props }) {
    const text = String(children ?? "");
    const match = /language-([\w-]+)/.exec(className || "");
    const isBlock = Boolean(match) || text.includes("\n");
    if (!isBlock) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return (
      <CodeBlock
        language={match ? match[1] : "متن"}
        code={text.replace(/\n$/, "")}
      />
    );
  },
};

/* ----------------------------------------------------------- model picker */

// Splits "gpt-oss:20b" into a name and a small tag chip.
function ModelLabel({ id }) {
  const cut = id.lastIndexOf(":");
  const name = cut > 0 ? id.slice(0, cut) : id;
  const tag = cut > 0 ? id.slice(cut + 1) : "";
  return (
    <span className="model-label" dir="ltr" title={id}>
      <span className="model-name">{name}</span>
      {tag && <span className="model-tag">{tag}</span>}
    </span>
  );
}

// Custom listbox: the popup of a native <select> cannot be themed, so this
// renders its own menu that follows the design tokens and the RTL layout.
function ModelPicker({ models, value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();

  function openMenu() {
    setActive(Math.max(0, models.indexOf(value)));
    setOpen(true);
  }

  function closeMenu(refocus) {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  }

  function choose(model) {
    onChange(model);
    closeMenu(true);
  }

  // Move focus into the list when it opens.
  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(e) {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Never keep the menu open while a response is being generated.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  // Keep the highlighted option visible inside the scrollable list.
  useEffect(() => {
    const list = listRef.current;
    const item = list?.children[active];
    if (!list || !item) return;
    const top = item.offsetTop;
    const bottom = top + item.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight)
      list.scrollTop = bottom - list.clientHeight;
  }, [active, open]);

  function onButtonKeyDown(e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) openMenu();
    }
  }

  function onListKeyDown(e) {
    const last = models.length - 1;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => (i >= last ? 0 : i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => (i <= 0 ? last : i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(last);
        break;
      case "Enter":
        e.preventDefault();
        choose(models[active]);
        break;
      case "Escape":
        e.preventDefault();
        closeMenu(true);
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        break;
    }
  }

  return (
    <div className="model-picker" ref={rootRef}>
      <button
        ref={btnRef}
        className={`model-btn ${open ? "open" : ""}`}
        type="button"
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={onButtonKeyDown}
        disabled={disabled}
        aria-label="انتخاب مدل"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
      >
        <ModelLabel id={value} />
        <Icon.Chevron className="chev" />
      </button>

      {open && (
        <ul
          id={listId}
          ref={listRef}
          className="model-menu"
          role="listbox"
          tabIndex={-1}
          aria-label="مدل‌های موجود"
          aria-activedescendant={`${listId}-${active}`}
          onKeyDown={onListKeyDown}
        >
          {models.map((m, i) => (
            <li
              key={m}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={m === value}
              className={`model-option ${i === active ? "active" : ""} ${
                m === value ? "selected" : ""
              }`}
              onPointerMove={() => setActive(i)}
              onClick={() => choose(m)}
            >
              <ModelLabel id={m} />
              {m === value && <Icon.Check className="tick" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- thinking view */

function ThinkingPanel({ text, live, startedAt, elapsedMs }) {
  // Opens automatically while reasoning streams, collapses once the answer starts.
  const [manual, setManual] = useState(null);
  const open = manual === null ? live : manual;

  // While live, the parent re-renders every 200 ms, so the timer keeps moving
  // even when the model pauses between chunks.
  const shownMs = live && startedAt ? Date.now() - startedAt : elapsedMs;

  return (
    <div className={`thinking ${live ? "live" : ""} ${open ? "open" : ""}`}>
      {live && <span className="thinking-pulse" />}
      <button
        className="thinking-head"
        onClick={() => setManual(!open)}
        type="button"
      >
        <Icon.Brain style={{ width: 14, height: 14 }} />
        <span>{live ? "در حال فکر کردن" : "زنجیره‌ی فکر مدل"}</span>
        <span className="thinking-timer">{formatSeconds(shownMs)}</span>
        <Icon.Chevron className="chev" />
      </button>
      {open && (
        <div className="thinking-body">
          <div className="thinking-text">{text || "…"}</div>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- tool log */

function ToolTimeline({ tools }) {
  if (!tools || tools.length === 0) return null;

  const label = { running: "در حال اجرا", done: "انجام شد", error: "خطا" };

  return (
    <div className="tools">
      {tools.map((t) => (
        <details className="tool" key={t.id} open={t.status === "error"}>
          <summary>
            <span className="tool-name">
              {t.name}({JSON.stringify(t.args ?? {})})
            </span>
            <span className={`tool-status ${t.status}`}>
              {label[t.status] || t.status}
              {t.ms ? ` · ${formatShortDuration(t.ms)}` : ""}
            </span>
          </summary>
          <div className="tool-payload">
            <pre>{t.result ?? "بدون خروجی"}</pre>
          </div>
        </details>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- answer row */

function Answer({ message, isStreaming, onRegenerate, canRegenerate }) {
  const [copied, setCopied] = useState(false);
  const hasBody = Boolean(message.content);
  const responseMs =
    message.responseMs ??
    (isStreaming && message.responseStartedAt
      ? Date.now() - message.responseStartedAt
      : null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard permission denied.
    }
  }

  if (message.isError) {
    return (
      <div className="answer">
        <div className="error-note">
          {message.content}
          {canRegenerate && (
            <button className="link-btn" onClick={onRegenerate} type="button">
              تلاش دوباره
            </button>
          )}
        </div>
        {responseMs !== null && (
          <div className="response-duration">
            زمان پاسخ: {formatShortDuration(responseMs)}
          </div>
        )}
      </div>
    );
  }

  const waiting = isStreaming && !hasBody && !message.thinking;

  return (
    <div className="answer">
      {(message.thinking || (isStreaming && message.thinkingLive)) && (
        <ThinkingPanel
          text={message.thinking}
          live={Boolean(isStreaming && message.thinkingLive)}
          startedAt={message.thinkingStart}
          elapsedMs={message.thinkingMs}
        />
      )}

      <ToolTimeline tools={message.tools} />

      {waiting ? (
        <span className="typing">
          <span />
          <span />
          <span />
        </span>
      ) : (
        hasBody && (
          <div className="markdown">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              disallowedElements={BLOCKED_HTML}
              components={markdownComponents}
            >
              {message.content + (isStreaming ? " ▍" : "")}
            </ReactMarkdown>
          </div>
        )
      )}

      {isStreaming && responseMs !== null && (
        <div className="response-duration" aria-live="off">
          زمان پاسخ: {formatShortDuration(responseMs)}
        </div>
      )}

      {!isStreaming && hasBody && (
        <div className="answer-foot">
          {message.stats && (
            <div className="stats">
              {message.stats.tokens ? (
                <span>{toPersianNumber(message.stats.tokens)} توکن</span>
              ) : null}
              {message.stats.tps ? (
                <span>
                  {toPersianNumber(message.stats.tps.toFixed(1))} توکن بر ثانیه
                </span>
              ) : null}
              {message.stats.ms ? (
                <span>{formatSeconds(message.stats.ms)}</span>
              ) : null}
            </div>
          )}
          {message.stopped && <span className="stats">متوقف شد</span>}
          {responseMs !== null && (
            <span className="response-duration">
              زمان پاسخ: {formatShortDuration(responseMs)}
            </span>
          )}
          <span className="spacer" />
          <button className="mini-btn" onClick={copy} type="button">
            <Icon.Copy />
            {copied ? "کپی شد" : "کپی"}
          </button>
          {canRegenerate && (
            <button className="mini-btn" onClick={onRegenerate} type="button">
              <Icon.Refresh />
              دوباره بساز
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- semantic map */

const MAP_W = 320;
const MAP_H = 250;
const MAP_PAD = 26;

function MapView({ map }) {
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => setSelectedId(null), [map]);

  const xs = [...map.points.map((p) => p.x), map.queryPoint.x];
  const ys = [...map.points.map((p) => p.y), map.queryPoint.y];
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX || 1;
  const spanY = Math.max(...ys) - minY || 1;
  const sx = (x) => MAP_PAD + ((x - minX) / spanX) * (MAP_W - 2 * MAP_PAD);
  const sy = (y) => MAP_H - MAP_PAD - ((y - minY) / spanY) * (MAP_H - 2 * MAP_PAD);

  const qx = sx(map.queryPoint.x);
  const qy = sy(map.queryPoint.y);
  const matchSet = new Set(map.matchIds);
  const selected = map.points.find((p) => p.id === selectedId) || null;

  function pick(id) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  return (
    <div className="map-view">
      <div className="map-query">
        سؤال: <strong>{map.query}</strong>
      </div>

      <svg
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        className="map-svg"
        role="img"
        aria-label="نقشه دوبعدی بردار محصولات و سؤال کاربر"
      >
        {map.points
          .filter((p) => matchSet.has(p.id))
          .map((p) => (
            <line
              key={`link-${p.id}`}
              className="map-link"
              x1={qx}
              y1={qy}
              x2={sx(p.x)}
              y2={sy(p.y)}
            />
          ))}
        {map.points.map((p) => {
          const pct = Math.max(10, Math.min(100, Math.round(p.sim * 100)));
          const isMatch = matchSet.has(p.id);
          return (
            <circle
              key={p.id}
              className={`map-dot ${isMatch ? "match" : ""} ${p.id === selectedId ? "sel" : ""}`}
              cx={sx(p.x)}
              cy={sy(p.y)}
              r={isMatch ? 6 : 4.5}
              style={{
                fill: `color-mix(in srgb, var(--accent) ${pct}%, var(--text-faint))`,
              }}
              tabIndex={0}
              role="button"
              aria-label={`${p.name}، شباهت ${toPersianNumber(p.sim.toFixed(2))}`}
              onClick={() => pick(p.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  pick(p.id);
                }
              }}
            >
              <title>{`${p.name} — شباهت ${toPersianNumber(p.sim.toFixed(2))}`}</title>
            </circle>
          );
        })}
        <g className="map-query-point" transform={`translate(${qx},${qy})`}>
          <rect x={-6} y={-6} width={12} height={12} transform="rotate(45)" />
          <title>سؤال شما</title>
        </g>
      </svg>

      <div className="map-legend">
        <span>
          <span className="legend-dot" /> محصول
        </span>
        <span>
          <span className="legend-diamond" /> سؤال شما
        </span>
        <span>
          <span className="legend-line" /> نتیجه‌ی منطبق
        </span>
      </div>

      <div className="map-detail" aria-live="polite">
        {selected ? (
          <>
            <strong>{selected.name}</strong>
            <span>
              شباهت: {toPersianNumber(selected.sim.toFixed(2))}
              {typeof selected.price === "number" &&
                ` — ${toPersianNumber(selected.price.toLocaleString("fa-IR"))} تومان`}
              {typeof selected.stock === "number" &&
                (selected.stock > 0
                  ? ` — ${toPersianNumber(selected.stock)} عدد موجود`
                  : " — ناموجود")}
            </span>
          </>
        ) : (
          <span className="map-detail-hint">
            روی یک نقطه یا نوار بزن تا جزئیات محصول را ببینی.
          </span>
        )}
      </div>

      <div className="map-bars">
        {map.points.slice(0, 8).map((p) => (
          <button
            key={p.id}
            type="button"
            className={`bar-row ${matchSet.has(p.id) ? "match" : ""} ${p.id === selectedId ? "sel" : ""}`}
            onClick={() => pick(p.id)}
          >
            <span className="bar-name" title={p.name}>
              {p.name}
            </span>
            <span className="bar-track">
              <span
                className="bar-fill"
                style={{ width: `${Math.min(100, p.sim * 100)}%` }}
              />
              <span
                className="bar-threshold"
                style={{ insetInlineStart: `${map.threshold * 100}%` }}
              />
            </span>
            <span className="bar-num">
              {toPersianNumber(p.sim.toFixed(2))}
            </span>
          </button>
        ))}
      </div>

      <p className="map-note">
        این نقشه تصویر دوبعدیِ فضای {toPersianNumber(map.dim)}بعدی است (حدود{" "}
        {toPersianNumber(Math.round(map.varianceExplained * 100))}٪ از اطلاعات
        حفظ شده)؛ فاصله‌ی نقاط تقریبی است. عدد شباهت دقیق است و خط چینِ روی
        نوارها آستانه‌ی {toPersianNumber(map.threshold)} را نشان می‌دهد.
      </p>
    </div>
  );
}

/* =========================================================== main component */

export default function Home() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState("");

  const [thinkEnabled, setThinkEnabled] = useState(true);
  const [theme, setTheme] = useState("system");
  const [systemDark, setSystemDark] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [, forceTick] = useState(0); // drives the live thinking timer
  const [semanticMap, setSemanticMap] = useState(null);
  const [mapOpen, setMapOpen] = useState(false);

  const scrollRef = useRef(null);
  const textareaRef = useRef(null);
  const abortRef = useRef(null);

  /* ------------------------------------------------- restore saved session */

  useEffect(() => {
    const saved = loadState();
    if (saved) {
      if (Array.isArray(saved.messages)) {
        // A message that was mid-thinking when the page closed is not live anymore.
        setMessages(
          saved.messages.map((m) =>
            m.thinkingLive ? { ...m, thinkingLive: false } : m,
          ),
        );
      }
      if (typeof saved.think === "boolean") setThinkEnabled(saved.think);
      if (saved.theme) setTheme(saved.theme);
    }
    setHydrated(true);
  }, []);

  // Persist only after the saved session has been restored. Saving earlier
  // overwrites it with defaults, and React StrictMode runs effects twice in dev,
  // so the second run would then restore those defaults.
  // Messages are not saved while streaming to avoid a write per token.
  useEffect(() => {
    if (hydrated && !loading) saveState({ messages });
  }, [hydrated, loading, messages]);

  useEffect(() => {
    if (hydrated) saveState({ think: thinkEnabled });
  }, [hydrated, thinkEnabled]);

  useEffect(() => {
    if (!hydrated) return;
    saveState({ theme });
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [hydrated, theme]);

  // Track the OS color scheme so "system" resolves to a real value. Without
  // this, the first click on the theme button can pick the theme that is
  // already showing and appear to do nothing.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const isDark = theme === "dark" || (theme === "system" && systemDark);

  // روی صفحه‌ی عریض پنل نقشه از ابتدا باز باشد؛ روی موبایل بسته می‌ماند.
  useEffect(() => {
    setMapOpen(window.matchMedia("(min-width: 1100px)").matches);
  }, []);

  /* ------------------------------------------------------------ model list */

  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    setModelsError("");
    try {
      const res = await fetch("/api/models");
      const data = await res.json();

      if (!res.ok || data.error) {
        setModelsError(data.error || "لیست مدل‌ها دریافت نشد.");
        setModels([]);
        return;
      }

      const list = data.models || [];
      setModels(list);
      setSelectedModel((prev) => {
        const saved = loadState()?.model;
        if (prev && list.includes(prev)) return prev;
        if (saved && list.includes(saved)) return saved;
        if (list.includes(PREFERRED_DEFAULT)) return PREFERRED_DEFAULT;
        return list[0] || "";
      });
    } catch {
      setModelsError("اتصال به Ollama برقرار نشد.");
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  useEffect(() => {
    if (selectedModel) saveState({ model: selectedModel });
  }, [selectedModel]);

  /* --------------------------------------------------------- scroll anchor */

  const scrollToEnd = useCallback((behavior = "smooth") => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAtBottom(distance < 90);
  }

  // "instant", not "auto": the transcript has CSS scroll-behavior: smooth, which
  // "auto" would follow. A smooth animation chasing every streamed token lags
  // behind and makes handleScroll think the user scrolled away.
  useEffect(() => {
    if (atBottom) scrollToEnd("instant");
  }, [messages, atBottom, scrollToEnd]);

  /* ---------------------------------------------------- live thinking clock */

  useEffect(() => {
    if (!loading) return undefined;
    const id = setInterval(() => forceTick((n) => n + 1), 200);
    return () => clearInterval(id);
  }, [loading]);

  /* -------------------------------------------------------- streaming core */

  const patchLast = useCallback((updater) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const copy = [...prev];
      const last = copy[copy.length - 1];
      copy[copy.length - 1] = { ...last, ...updater(last) };
      return copy;
    });
  }, []);

  const handleEvent = useCallback(
    (evt) => {
      switch (evt.type) {
        case "thinking": {
          patchLast((m) => {
            const startedAt = m.thinkingStart || Date.now();
            return {
              thinking: (m.thinking || "") + (evt.delta || ""),
              thinkingLive: true,
              thinkingStart: startedAt,
              thinkingMs: Date.now() - startedAt,
            };
          });
          break;
        }
        case "content": {
          patchLast((m) => ({
            content: (m.content || "") + (evt.delta || ""),
            ...endThinking(m),
          }));
          break;
        }
        case "tool": {
          patchLast((m) => {
            const tools = [...(m.tools || [])];
            const idx = tools.findIndex((t) => t.id === evt.id);
            const next = {
              id: evt.id || uid(),
              name: evt.name,
              args: evt.args,
              status: evt.status || "running",
              result: evt.result,
              ms: evt.ms,
            };
            if (idx === -1) tools.push(next);
            else tools[idx] = { ...tools[idx], ...next };
            return { tools, ...endThinking(m) };
          });
          break;
        }
        case "stats": {
          patchLast(() => ({
            stats: {
              tokens: evt.tokens,
              ms: evt.durationMs,
              tps: evt.tokensPerSecond,
            },
          }));
          break;
        }
        case "error": {
          patchLast((m) => ({
            content: evt.message || "پاسخ ناتمام ماند.",
            isError: true,
            ...endThinking(m),
          }));
          break;
        }
        default:
          break;
      }
    },
    [patchLast],
  );

  const runCompletion = useCallback(
    async (history) => {
      setLoading(true);
      const startedAt = Date.now();
      patchLast(() => ({ responseStartedAt: startedAt }));

      const controller = new AbortController();
      abortRef.current = controller;
      // False once a newer request has replaced this one (e.g. "new chat" then send).
      const isCurrent = () => abortRef.current === controller;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: toApiMessages(history),
            model: selectedModel,
            think: thinkEnabled,
          }),
          signal: controller.signal,
        });

        const contentType = res.headers.get("content-type") || "";

        // Fallback path: a non-streaming route that returns one JSON payload.
        if (!res.body || contentType.includes("application/json")) {
          const data = await res.json().catch(() => null);
          if (!res.ok || !data || data.error) {
            patchLast((m) => ({
              content: (data && data.error) || "درخواست با خطا مواجه شد.",
              isError: true,
              ...endThinking(m),
            }));
            return;
          }
          patchLast((m) => ({
            content: data.content || "",
            thinking: data.thinking || "",
            ...endThinking(m),
            tools: (data.toolLog || []).map((t) => ({
              id: uid(),
              name: t.name,
              args: t.args,
              status: "done",
              result: t.result,
            })),
          }));
          const maps = (data.toolLog || []).filter((t) => t.map);
          if (maps.length > 0) setSemanticMap(maps[maps.length - 1].map);
          return;
        }

        if (!res.ok) {
          patchLast((m) => ({
            content: `سرور با کد ${toPersianNumber(res.status)} پاسخ داد.`,
            isError: true,
            ...endThinking(m),
          }));
          return;
        }

        // Streaming path: newline-delimited JSON events.
        const consumeLine = (rawLine) => {
          const line = rawLine.trim();
          if (!line) return;
          const payload = line.startsWith("data:")
            ? line.slice(5).trim()
            : line;
          if (!payload || payload === "[DONE]") return;
          try {
            handleEvent(JSON.parse(payload));
          } catch {
            // Ignore malformed lines instead of killing the stream.
          }
        };

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          let newlineIndex;

          while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
            consumeLine(buffer.slice(0, newlineIndex));
            buffer = buffer.slice(newlineIndex + 1);
          }
        }

        // Flush the tail: the final event (often "stats") may have no trailing newline.
        buffer += decoder.decode();
        consumeLine(buffer);
      } catch (err) {
        if (!isCurrent()) return;
        if (err.name === "AbortError") {
          patchLast((m) => ({
            ...endThinking(m),
            stopped: true,
            // "synthetic" keeps this placeholder out of the next request's history.
            ...(m.content
              ? {}
              : { content: "تولید پاسخ متوقف شد.", synthetic: true }),
          }));
        } else {
          patchLast((m) => ({
            content: "ارتباط با سرور قطع شد.",
            isError: true,
            ...endThinking(m),
          }));
        }
      } finally {
        if (isCurrent()) {
          patchLast((m) => ({
            ...endThinking(m),
            responseMs: Date.now() - (m.responseStartedAt || startedAt),
          }));
          setLoading(false);
          abortRef.current = null;
        }
      }
    },
    [selectedModel, thinkEnabled, handleEvent, patchLast],
  );

  /* ------------------------------------------------------------- actions */

  const resetTextarea = useCallback(() => {
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, []);

  const send = useCallback(
    async (rawText) => {
      const fromStarter = rawText !== undefined;
      const text = (fromStarter ? rawText : input).trim();
      if (!text || loading || !selectedModel) return;

      const history = [...messages, { id: uid(), role: "user", content: text }];

      setMessages([
        ...history,
        {
          id: uid(),
          role: "assistant",
          content: "",
          thinking: "",
          thinkingLive: false,
          tools: [],
        },
      ]);

      // A starter must not wipe a draft the person is typing.
      if (!fromStarter) {
        setInput("");
        resetTextarea();
      }
      setAtBottom(true);

      await runCompletion(history);
    },
    [input, loading, selectedModel, messages, runCompletion, resetTextarea],
  );

  const regenerate = useCallback(async () => {
    if (loading) return;
    const lastUserIndex = messages.map((m) => m.role).lastIndexOf("user");
    if (lastUserIndex === -1) return;

    const history = messages.slice(0, lastUserIndex + 1);
    setMessages([
      ...history,
      {
        id: uid(),
        role: "assistant",
        content: "",
        thinking: "",
        thinkingLive: false,
        tools: [],
      },
    ]);
    setAtBottom(true);
    await runCompletion(history);
  }, [loading, messages, runCompletion]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  function newChat() {
    if (loading) stop();
    setMessages([]);
    setInput("");
    setSemanticMap(null);
    resetTextarea();
    setAtBottom(true);
  }

  function autoGrow(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }

  function handleKeyDown(e) {
    // isComposing: Enter confirms an IME candidate and must not send.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  // Esc stops generation from anywhere on the page.
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape" && loading) stop();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loading, stop]);

  /* ---------------------------------------------------------------- render */

  const lastIndex = messages.length - 1;
  const modelReady = Boolean(selectedModel);

  return (
    <div className="viewport" dir="rtl" lang="fa">
      <div className="layout">
        <div className="app">
        <header className="topbar">
          <div className={`brand ${loading ? "busy" : ""}`}>
            <span className="brand-mark">چ</span>
            <div className="brand-text">
              <h1 className="brand-title">چت محلی</h1>
              <div className={`brand-state ${loading ? "busy" : ""}`}>
                {loading ? "در حال پاسخ دادن" : "آماده"}
              </div>
            </div>
          </div>

          <div className="model-slot">
            {modelsLoading ? (
              <span className="model-hint">در حال خواندن…</span>
            ) : modelsError || models.length === 0 ? (
              <button
                className="model-hint error link-btn"
                onClick={loadModels}
                title={modelsError || undefined}
                type="button"
              >
                {modelsError ? "تلاش دوباره" : "مدلی نیست"}
              </button>
            ) : (
              <ModelPicker
                models={models}
                value={selectedModel}
                onChange={setSelectedModel}
                disabled={loading}
              />
            )}
          </div>

          <span className="topbar-spacer" />

          <div className="topbar-tools">
            <button
              className={`icon-btn ${mapOpen ? "on" : ""}`}
              onClick={() => setMapOpen((v) => !v)}
              title="نقشه‌ی معنی (بردارها)"
              aria-label="نقشه‌ی معنی"
              aria-pressed={mapOpen}
              type="button"
            >
              <Icon.Map />
            </button>

            <button
              className={`icon-btn ${thinkEnabled ? "on" : ""}`}
              onClick={() => setThinkEnabled((v) => !v)}
              disabled={loading}
              title={
                thinkEnabled ? "نمایش تفکر مدل: روشن" : "نمایش تفکر مدل: خاموش"
              }
              aria-label="نمایش تفکر مدل"
              type="button"
            >
              <Icon.Brain />
            </button>

            <button
              className="icon-btn"
              onClick={() => setTheme(isDark ? "light" : "dark")}
              title={isDark ? "تم روشن" : "تم تاریک"}
              aria-label={isDark ? "تغییر به تم روشن" : "تغییر به تم تاریک"}
              type="button"
            >
              {isDark ? <Icon.Sun /> : <Icon.Moon />}
            </button>

            <button
              className="icon-btn"
              onClick={newChat}
              title="گفت‌وگوی تازه"
              aria-label="گفت‌وگوی تازه"
              type="button"
            >
              <Icon.Plus />
            </button>
          </div>
        </header>

        <main className="transcript" ref={scrollRef} onScroll={handleScroll}>
          {messages.length === 0 ? (
            <div className="welcome">
              <h2>روی سخت‌افزار خودت، بدون اینترنت</h2>
              <p>
                یک سوال بنویس تا مدل انتخاب‌شده جواب بدهد. اگر مدل قابلیت
                استدلال داشته باشد، مراحل فکر کردنش هم همین‌جا نمایش داده
                می‌شود.
              </p>
              <div className="starters">
                {STARTERS.map((s) => (
                  <button
                    className="starter"
                    key={s}
                    onClick={() => send(s)}
                    disabled={!modelReady || loading}
                    type="button"
                  >
                    <span>{s}</span>
                    <Icon.Send className="starter-arrow" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="thread">
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div className="turn user" key={m.id || i}>
                    <div className="user-bubble">{m.content}</div>
                  </div>
                ) : (
                  <div className="turn assistant" key={m.id || i}>
                    <Answer
                      message={m}
                      isStreaming={loading && i === lastIndex}
                      onRegenerate={regenerate}
                      canRegenerate={!loading && i === lastIndex}
                    />
                  </div>
                ),
              )}
            </div>
          )}
        </main>

        <div className="composer-zone">
          {!atBottom && messages.length > 0 && (
            <button
              className="jump-btn"
              onClick={() => scrollToEnd("smooth")}
              type="button"
            >
              <Icon.Down />
              آخرین پیام
            </button>
          )}

          <div className="composer">
            <textarea
              ref={textareaRef}
              rows={1}
              placeholder={
                modelReady ? "پیام خود را بنویسید…" : "ابتدا یک مدل انتخاب کنید"
              }
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                autoGrow(e.target);
              }}
              onKeyDown={handleKeyDown}
              disabled={!modelReady}
            />

            {loading ? (
              <button
                className="stop-btn"
                onClick={stop}
                title="توقف"
                aria-label="توقف"
                type="button"
              >
                <Icon.Stop />
              </button>
            ) : (
              <button
                className="send-btn"
                onClick={() => send()}
                disabled={!input.trim() || !modelReady}
                title="ارسال"
                aria-label="ارسال"
                type="button"
              >
                <Icon.Send />
              </button>
            )}
          </div>

          <div className="composer-foot">
            <kbd>Enter</kbd> ارسال ·{" "}
            <span className="keys">
              <kbd>Shift</kbd>+<kbd>Enter</kbd>
            </span>{" "}
            خط جدید · <kbd>Esc</kbd> توقف
          </div>
        </div>
        </div>

        <aside
          className={`map-panel ${mapOpen ? "open" : ""}`}
          aria-label="نقشه معنی محصولات"
        >
          <div className="map-head">
            <span className="map-title">نقشه‌ی معنی</span>
            <button
              className="icon-btn"
              onClick={() => setMapOpen(false)}
              title="بستن نقشه"
              aria-label="بستن نقشه"
              type="button"
            >
              <Icon.X />
            </button>
          </div>
          <div className="map-body">
            {semanticMap ? (
              <MapView map={semanticMap} />
            ) : (
              <div className="map-empty">
                <p>هنوز جست‌وجوی معنایی انجام نشده است.</p>
                <p>
                  سؤالی مثل «برای بازی چی خوبه؟» بپرس تا بردار سؤال و محصولات
                  اینجا رسم شود و ببینی کدام نزدیک‌تر است.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
