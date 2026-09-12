"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

const PREFERRED_DEFAULT = "gpt-oss:20b";

export default function Home() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState("");

  const scrollRef = useRef(null);
  const textareaRef = useRef(null);
  const abortRef = useRef(null);

  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    setModelsError("");
    try {
      const res = await fetch("/api/models");
      const data = await res.json();

      if (!res.ok || data.error) {
        setModelsError(data.error || "خطا در دریافت لیست مدل‌ها.");
        setModels([]);
        return;
      }

      const list = data.models || [];
      setModels(list);
      setSelectedModel((prev) => {
        if (prev && list.includes(prev)) return prev;
        if (list.includes(PREFERRED_DEFAULT)) return PREFERRED_DEFAULT;
        return list[0] || "";
      });
    } catch (err) {
      setModelsError("اتصال به سرور برقرار نشد.");
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  function autoGrow(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading || !selectedModel) return;

    const userMessage = { role: "user", content: text };
    const nextMessages = [...messages, userMessage];

    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, model: selectedModel }),
        signal: controller.signal,
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data || data.error) {
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = {
            role: "assistant",
            content: (data && data.error) || "خطایی رخ داد.",
            isError: true,
          };
          return copy;
        });
        return;
      }

      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = {
          role: "assistant",
          content: data.content,
          toolLog: data.toolLog,
        };
        return copy;
      });
    } catch (err) {
      if (err.name === "AbortError") {
        // درخواست لغو شد؛ چون دیگه استریم نیست، محتوای نصفه‌ای برای نگه‌داشتن نداریم
        setMessages((prev) => prev.slice(0, -1));
      } else {
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = {
            role: "assistant",
            content: "ارتباط با سرور برقرار نشد.",
            isError: true,
          };
          return copy;
        });
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }

  function cancelGeneration() {
    if (abortRef.current) {
      abortRef.current.abort();
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="page">
      <div className="chat-box">
        <div className="header">
          <div className="header-top">
            <h1>چت با مدل‌های محلی Ollama</h1>
            <span
              className={`status-dot ${loading ? "busy" : "idle"}`}
              title={loading ? "در حال پاسخ" : "آماده"}
            />
          </div>

          <div className="model-row">
            <label htmlFor="model-select">مدل:</label>

            {modelsLoading ? (
              <span className="model-hint">در حال دریافت لیست مدل‌ها...</span>
            ) : modelsError ? (
              <span className="model-hint error">
                {modelsError}{" "}
                <button className="link-btn" onClick={loadModels}>
                  تلاش دوباره
                </button>
              </span>
            ) : models.length === 0 ? (
              <span className="model-hint error">
                هیچ مدلی روی Ollama نصب نیست.{" "}
                <button className="link-btn" onClick={loadModels}>
                  بررسی مجدد
                </button>
              </span>
            ) : (
              <select
                id="model-select"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={loading}
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className="messages" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="empty-state">
              پیامی ارسال نشده.
              <br />
              یک سوال بنویسید تا مدل انتخاب‌شده به آن پاسخ دهد.
            </div>
          )}

          {messages.map((m, i) => {
            const isEmptyLoading =
              !m.content && loading && i === messages.length - 1;
            return (
              <div key={i} className={`msg-row ${m.role}`}>
                <div className={`bubble ${m.isError ? "error-bubble" : ""}`}>
                  {isEmptyLoading ? (
                    <span className="typing">
                      <span></span>
                      <span></span>
                      <span></span>
                    </span>
                  ) : m.role === "assistant" && !m.isError ? (
                    <>
                      {m.toolLog && m.toolLog.length > 0 && (
                        <div className="tool-log">
                          {m.toolLog.map((t, idx) => (
                            <div className="tool-log-item" key={idx}>
                              <code>
                                {t.name}({JSON.stringify(t.args)})
                              </code>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="markdown">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[rehypeRaw]}
                          components={{
                            table: ({ node, ...props }) => (
                              <div className="table-wrap">
                                <table {...props} />
                              </div>
                            ),
                          }}
                        >
                          {m.content}
                        </ReactMarkdown>
                      </div>
                    </>
                  ) : (
                    m.content
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="composer">
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder="پیام خود را بنویسید..."
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autoGrow(e.target);
            }}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
          {loading ? (
            <button className="btn-cancel" onClick={cancelGeneration}>
              لغو
            </button>
          ) : (
            <button
              className="btn-send"
              onClick={sendMessage}
              disabled={!input.trim() || !selectedModel}
            >
              ارسال
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
