// یک‌بار اجرا می‌شود: متن هر محصول را با مدل embedding به بردار تبدیل می‌کند،
// مختصات دوبعدی (PCA) را برای نقشه‌ی رابط کاربری حساب می‌کند و همه را در
// data/embeddings.json ذخیره می‌کند. بعد از تغییر محصولات دوباره اجرا شود:
//   npm run embed
import fs from "node:fs";
import path from "node:path";
import { embedTexts, EMBED_MODEL } from "../lib/ollama.mjs";

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "store-data.json");
const OUT_PATH = path.join(DATA_DIR, "embeddings.json");
const BATCH_SIZE = 8;

function productText(p) {
  const specs = Object.entries(p.specs || {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("، ");
  return `${p.name}. ${p.description || ""}${specs ? ` مشخصات: ${specs}` : ""}`;
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function norm(a) {
  return Math.sqrt(dot(a, a));
}

// PCA با روش Gram: چون تعداد نمونه‌ها (۳۵) از تعداد ابعاد (۱۰۲۴) کمتر است،
// ماتریس کواریانس را در فضای نمونه‌ها می‌سازیم (۳۵×۳۵) و با power iteration
// دو مؤلفه‌ی اصلی را پیدا می‌کنیم — بدون هیچ وابستگی خارجی.
function pca2(vectors) {
  const n = vectors.length;
  const dim = vectors[0].length;

  const mean = new Array(dim).fill(0);
  for (const v of vectors) for (let j = 0; j < dim; j++) mean[j] += v[j];
  for (let j = 0; j < dim; j++) mean[j] /= n;

  const centered = vectors.map((v) => v.map((x, j) => x - mean[j]));

  const gram = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let k = i; k < n; k++) {
      const s = dot(centered[i], centered[k]);
      gram[i][k] = s;
      gram[k][i] = s;
    }
  }
  const totalVariance = gram.reduce((s, row, i) => s + row[i], 0);

  const components = [];
  const coords = Array.from({ length: n }, () => [0, 0]);
  const eigenvalues = [];
  let work = gram;

  for (let c = 0; c < 2; c++) {
    let v = Array.from({ length: n }, (_, i) => (i === c ? 1 : 0.01));
    v = v.map((x) => x / norm(v));

    for (let iter = 0; iter < 300; iter++) {
      const w = work.map((row) => dot(row, v));
      const wNorm = norm(w);
      if (wNorm < 1e-12) break;
      const next = w.map((x) => x / wNorm);
      const diff = 1 - Math.abs(dot(next, v));
      v = next;
      if (diff < 1e-12) break;
    }

    const eigenvalue = dot(v, work.map((row) => dot(row, v)));
    eigenvalues.push(eigenvalue);

    const u = new Array(dim).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < dim; j++) u[j] += v[i] * centered[i][j];
    }
    const uNorm = norm(u);
    for (let j = 0; j < dim; j++) u[j] /= uNorm;
    components.push(u);

    for (let i = 0; i < n; i++) coords[i][c] = dot(centered[i], u);

    work = work.map((row, i) =>
      row.map((x, k) => x - eigenvalue * v[i] * v[k]),
    );
  }

  const explained =
    totalVariance > 0
      ? eigenvalues.reduce((s, x) => s + x, 0) / totalVariance
      : 0;
  return { mean, components, coords, explained };
}

const round = (x, p) => Number(x.toFixed(p));

async function main() {
  const store = JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
  const products = store.products;
  console.log(`تعداد محصولات: ${products.length} — مدل: ${EMBED_MODEL}`);

  const vectors = [];
  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);
    const embeddings = await embedTexts(batch.map(productText));
    vectors.push(...embeddings);
    console.log(`  بردارسازی ${Math.min(i + BATCH_SIZE, products.length)}/${products.length}`);
  }

  const dim = vectors[0].length;
  console.log(`بعد بردارها: ${dim}`);

  const { mean, components, coords, explained } = pca2(vectors);
  console.log(`اطلاعات حفظ‌شده در نقشه‌ی دوبعدی: ${(explained * 100).toFixed(1)}٪`);

  const index = {
    model: EMBED_MODEL,
    dim,
    builtAt: new Date().toISOString(),
    varianceExplained: round(explained, 4),
    mean: mean.map((x) => round(x, 6)),
    components: components.map((u) => u.map((x) => round(x, 6))),
    products: products.map((p, i) => ({
      id: p.id,
      name: p.name,
      vector: vectors[i].map((x) => round(x, 6)),
      x: round(coords[i][0], 4),
      y: round(coords[i][1], 4),
    })),
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(index));
  const sizeKb = Math.round(fs.statSync(OUT_PATH).size / 1024);
  console.log(`ذخیره شد: ${OUT_PATH} (${sizeKb} KB)`);
}

main().catch((err) => {
  console.error("خطا:", err.message);
  process.exit(1);
});