import fs from "node:fs";
import path from "node:path";
import { embedTexts } from "./ollama.mjs";

const DATA_DIR = path.join(process.cwd(), "data");
const INDEX_PATH = path.join(DATA_DIR, "embeddings.json");
const STORE_PATH = path.join(DATA_DIR, "store-data.json");

const DEFAULT_TOP_K = 5;
const DEFAULT_THRESHOLD = 0.45;

let cache = { mtimeMs: 0, index: null };

function loadIndex() {
  let stat;
  try {
    stat = fs.statSync(INDEX_PATH);
  } catch {
    return null;
  }
  if (!cache.index || cache.mtimeMs !== stat.mtimeMs) {
    const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8"));
    for (const p of index.products) {
      p.norm = Math.sqrt(p.vector.reduce((s, x) => s + x * x, 0));
    }
    cache = { mtimeMs: stat.mtimeMs, index };
  }
  return cache.index;
}

export function cosineSimilarity(a, b, normA, normB) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  const na = normA ?? Math.sqrt(a.reduce((s, x) => s + x * x, 0));
  const nb = normB ?? Math.sqrt(b.reduce((s, x) => s + x * x, 0));
  if (na === 0 || nb === 0) return 0;
  return dot / (na * nb);
}

function projectQuery(vector, index) {
  const centered = vector.map((x, j) => x - index.mean[j]);
  return index.components.map((u) =>
    Number(centered.reduce((s, x, j) => s + x * u[j], 0).toFixed(4)),
  );
}

// خروجی: { text, map } — text برای مدل، map برای نقشه‌ی رابط کاربری.
export async function semanticSearch(query, { signal } = {}) {
  const index = loadIndex();
  if (!index) {
    return {
      text: "خطا: فایل بردارها (data/embeddings.json) ساخته نشده است. ابتدا دستور npm run embed اجرا شود.",
    };
  }

  let store = null;
  try {
    store = JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
  } catch {
    // قیمت/موجودی فقط برای متن نتیجه است؛ بدون آن هم جست‌وجو کار می‌کند.
  }
  const byId = new Map((store?.products || []).map((p) => [p.id, p]));

  const [queryVector] = await embedTexts([query], signal);
  const queryNorm = Math.sqrt(queryVector.reduce((s, x) => s + x * x, 0));

  const points = index.products.map((p) => {
    const sim = cosineSimilarity(queryVector, p.vector, queryNorm, p.norm);
    const full = byId.get(p.id);
    return {
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      sim: Number(sim.toFixed(4)),
      price: full?.price ?? null,
      stock: full?.stock ?? null,
    };
  });
  points.sort((a, b) => b.sim - a.sim);

  const matches = points
    .filter((p) => p.sim >= DEFAULT_THRESHOLD)
    .slice(0, DEFAULT_TOP_K);

  const [qx, qy] = projectQuery(queryVector, index);

  const map = {
    query,
    threshold: DEFAULT_THRESHOLD,
    topK: DEFAULT_TOP_K,
    dim: index.dim,
    varianceExplained: index.varianceExplained,
    queryPoint: { x: qx, y: qy },
    matchIds: matches.map((p) => p.id),
    points,
  };

  if (matches.length === 0) {
    return {
      text: `هیچ محصولی با شباهت بالای ${DEFAULT_THRESHOLD} برای «${query}» پیدا نشد. نزدیک‌ترین مورد ${points[0].name} با شباهت ${points[0].sim} بود. اگر سؤال کلی است، از list_products بدون فیلتر استفاده کن.`,
      map,
    };
  }

  const lines = matches.map((p) => {
    const price =
      typeof p.price === "number"
        ? `${p.price.toLocaleString("fa-IR")} تومان`
        : "قیمت نامشخص";
    const stock =
      typeof p.stock === "number"
        ? p.stock > 0
          ? `${p.stock} عدد موجود`
          : "ناموجود"
        : "موجودی نامشخص";
    return `${p.name} — شباهت ${p.sim} — ${price} — ${stock}`;
  });

  return {
    text: `نتایج جست‌وجوی معنایی برای «${query}» (به‌ترتیب شباهت):\n${lines.join("\n")}`,
    map,
  };
}