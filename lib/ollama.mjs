export const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL || "http://192.168.254.148:11434";

export const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "bge-m3";

export async function embedTexts(texts, signal) {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama embed با کد ${res.status} پاسخ داد. ${text}`);
  }

  const data = await res.json();
  if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length) {
    throw new Error("پاسخ نامعتبر از سرویس embed دریافت شد.");
  }
  return data.embeddings;
}