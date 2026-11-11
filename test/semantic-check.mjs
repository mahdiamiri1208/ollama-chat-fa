// بررسی کیفیت جست‌وجوی معنایی: چند سؤال نمونه را اجرا می‌کند و نزدیک‌ترین
// محصولات را با امتیاز شباهت نشان می‌دهد. برای گزارش/ارزیابی پروژه:
//   node test/semantic-check.mjs
import { semanticSearch } from "../lib/semantic.mjs";

const QUERIES = [
  "برای بازی و گیمینگ چی خوبه؟",
  "هدفون بی‌سیم",
  "چیزی برای شارژ گوشی",
  "صندلی راحت برای کار",
  "لپ تاپ",
  "سفالگری سنتی اصفهان",
];

for (const q of QUERIES) {
  const { map, text } = await semanticSearch(q);
  if (!map) {
    console.log(`\n«${q}» → ${text}`);
    continue;
  }
  console.log(`\n«${q}»`);
  for (const p of map.points.slice(0, 5)) {
    const mark = map.matchIds.includes(p.id) ? "✓" : " ";
    console.log(`  ${mark} ${p.sim.toFixed(3)}  ${p.name}`);
  }
}