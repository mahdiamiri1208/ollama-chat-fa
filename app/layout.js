import { Vazirmatn, JetBrains_Mono } from "next/font/google";

// Fonts are downloaded at build/dev time and served from your own server,
// so the page makes no runtime requests to Google.
const vazirmatn = Vazirmatn({
  subsets: ["arabic", "latin"],
  variable: "--font-vazir",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata = {
  title: "چت با gpt-oss:20b",
  description: "رابط چت فارسی برای مدل محلی gpt-oss:20b روی Ollama",
};

// Applies the saved theme before first paint to avoid a light/dark flash.
const themeScript = `(function () {
  try {
    var saved = JSON.parse(localStorage.getItem("ollama-chat/v1") || "null");
    var theme = saved && saved.theme;
    if (theme === "light" || theme === "dark") {
      document.documentElement.setAttribute("data-theme", theme);
    }
  } catch (e) {}
})();`;

export default function RootLayout({ children }) {
  return (
    <html
      lang="fa"
      dir="rtl"
      className={`${vazirmatn.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
