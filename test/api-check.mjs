// تست یکپارچه‌ی API: یک سؤال به /api/chat می‌فرستد و خلاصه‌ی پاسخ و
// داده‌ی نقشه را چاپ می‌کند. سرور dev باید در حال اجرا باشد:
//   node test/api-check.mjs "سؤال شما"
const question = process.argv[2] || "برای بازی و گیمینگ چی پیشنهاد می‌کنی؟";

const res = await fetch("http://localhost:3000/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    messages: [{ role: "user", content: question }],
    model: "gpt-oss:20b",
    think: false,
  }),
});

const j = await res.json();
console.log("STATUS:", res.status);
console.log("CONTENT:", (j.content || j.error || "").slice(0, 500));
console.log("TOOLS:", (j.toolLog || []).map((t) => t.name).join(", ") || "—");
const withMap = (j.toolLog || []).find((t) => t.map);
if (withMap) {
  console.log("MAP query:", withMap.map.query);
  console.log("MAP matches:", withMap.map.matchIds.join(", "));
  console.log(
    "MAP top3:",
    withMap.map.points.slice(0, 3).map((p) => `${p.name}=${p.sim}`).join(" | "),
  );
  console.log("MAP queryPoint:", JSON.stringify(withMap.map.queryPoint));
} else {
  console.log("NO MAP");
}