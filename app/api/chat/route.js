
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const runtime = "nodejs";

const OLLAMA_URL = "http://127.0.0.1:11434/api/chat";
const DEFAULT_MODEL = "gpt-oss:20b";
const MAX_TOOL_ITERATIONS = 10;
const MAX_OUTPUT_CHARS = 4000;
const MAX_LIST_RESULTS = 15;

const WORKSPACE_DIR = path.resolve("C:/Users/mahdi/Desktop/ollama-chat-fa");

if (!fs.existsSync(WORKSPACE_DIR)) {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

const STORE_DATA_PATH = path.join(WORKSPACE_DIR, "data", "store-data.json");

function loadStoreData() {
  try {
    const raw = fs.readFileSync(STORE_DATA_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function normalizePersian(text) {
  return text
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u200c\u200f\u200e]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function scoreProducts(query, products) {
  const normalizedQuery = normalizePersian(query);
  const queryWords = normalizedQuery.split(" ").filter(Boolean);

  return products
    .map((product) => {
      const normalizedName = normalizePersian(product.name);
      let score = 0;
      for (const word of queryWords) {
        if (normalizedName.includes(word)) score++;
      }
      return { product, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
}

const ALLOWED_COMMANDS = {
  install: { cmd: process.platform === "win32" ? "npm.cmd" : "npm", args: ["install"] },
  build: { cmd: process.platform === "win32" ? "npm.cmd" : "npm", args: ["run", "build"] },
  lint: { cmd: process.platform === "win32" ? "npm.cmd" : "npm", args: ["run", "lint"] },
};

function truncateOutput(text) {
  if (!text) return "(بدون خروجی)";
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return "...(ابتدای خروجی حذف شد)...\n" + text.slice(-MAX_OUTPUT_CHARS);
}

const STATIC_TOOLS = [
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read the text content of a file from the project workspace folder.",
      parameters: {
        type: "object",
        required: ["filename"],
        properties: {
          filename: {
            type: "string",
            description: "Relative filename inside the workspace, e.g. notes.txt",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Create a new file or overwrite an existing one inside the project workspace folder with the given text content.",
      parameters: {
        type: "object",
        required: ["filename", "content"],
        properties: {
          filename: {
            type: "string",
            description: "Relative filename inside the workspace, e.g. notes.txt",
          },
          content: {
            type: "string",
            description: "The full text content to write into the file.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description:
        "Run a predefined project command (install dependencies, build, or lint) inside the workspace and return its output.",
      parameters: {
        type: "object",
        required: ["action"],
        properties: {
          action: {
            type: "string",
            description: "Which predefined command to run.",
            enum: ["install", "build", "lint"],
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_inventory",
      description:
        "Check the price and stock availability of ONE specific store product by its exact or partial name (in Persian). Only use this when the customer names a specific product. Never invent a product name from general knowledge (e.g. real-world brands like Samsung, Sony, Xiaomi) — this store only sells the products returned by list_products.",
      parameters: {
        type: "object",
        required: ["product_name"],
        properties: {
          product_name: {
            type: "string",
            description:
              "The product name or partial name the customer mentioned, in Persian, e.g. 'هدفون آریا'",
          },
        },
      },
    },
  },
];

// دسته‌بندی‌ها رو از خود داده می‌خونه، نه از یه لیست ثابت و دستی — تا محصول جدید با
// دسته‌بندی جدید هم خودکار توی schema شناخته بشه.
function buildListProductsTool(store) {
  const categories = store
    ? [...new Set(store.products.map((p) => p.category).filter(Boolean))]
    : ["audio", "power", "computing", "wearable"];

  return {
    type: "function",
    function: {
      name: "list_products",
      description:
        "Search and list store products. Use category and/or price range when they clearly match, AND/OR use keyword for anything else the customer mentions (a feature, use-case, or product type like 'gaming' or 'صندلی') to search product names and descriptions. When in doubt, prefer adding a keyword over guessing a category.",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description: "Optional exact category filter.",
            enum: categories,
          },
          min_price: {
            type: "number",
            description: "Optional minimum price in Toman.",
          },
          max_price: {
            type: "number",
            description: "Optional maximum price in Toman.",
          },
          keyword: {
            type: "string",
            description:
              "Optional free-text keyword (Persian) to search inside product names and descriptions, e.g. 'گیمینگ'.",
          },
        },
      },
    },
  };
}

function isInsideWorkspace(requestedPath) {
  return (
    requestedPath === WORKSPACE_DIR ||
    requestedPath.startsWith(WORKSPACE_DIR + path.sep)
  );
}

const TOOL_IMPLEMENTATIONS = {
  read_file: (args) => {
    const requestedPath = path.resolve(WORKSPACE_DIR, args.filename);
    if (!isInsideWorkspace(requestedPath)) {
      return "دسترسی غیرمجاز: این مسیر خارج از پوشه‌ی workspace است.";
    }
    try {
      return fs.readFileSync(requestedPath, "utf-8");
    } catch (err) {
      return `خطا در خواندن فایل: ${err.message}`;
    }
  },

  write_file: (args) => {
    const requestedPath = path.resolve(WORKSPACE_DIR, args.filename);
    if (!isInsideWorkspace(requestedPath)) {
      return "دسترسی غیرمجاز: این مسیر خارج از پوشه‌ی workspace است.";
    }
    try {
      fs.writeFileSync(requestedPath, args.content, "utf-8");
      return `فایل ${args.filename} با موفقیت نوشته شد.`;
    } catch (err) {
      return `خطا در نوشتن فایل: ${err.message}`;
    }
  },

  run_command: (args) => {
    const entry = ALLOWED_COMMANDS[args.action];
    if (!entry) {
      return `دستور "${args.action}" مجاز نیست. دستورهای مجاز: ${Object.keys(ALLOWED_COMMANDS).join(", ")}`;
    }
    try {
      const output = execFileSync(entry.cmd, entry.args, {
        cwd: WORKSPACE_DIR,
        timeout: 60000,
        encoding: "utf-8",
        windowsHide: true,
        shell: true,
      });
      return `اجرای موفق:\n${truncateOutput(output)}`;
    } catch (err) {
      const output = (err.stdout || "") + (err.stderr || "");
      return `خطا در اجرای دستور:\n${truncateOutput(output || err.message)}`;
    }
  },

  check_inventory: (args) => {
    const store = loadStoreData();
    if (!store) {
      return "خطا: فایل داده‌ی فروشگاه (data/store-data.json) پیدا نشد یا معتبر نیست.";
    }

    const scored = scoreProducts(args.product_name, store.products);

    if (scored.length === 0) {
      return "همچین محصولی در فروشگاه ما وجود ندارد. برای دیدن محصولات موجود از ابزار list_products استفاده کن.";
    }

    const topScore = scored[0].score;
    const tied = scored.filter((entry) => entry.score === topScore);

    if (tied.length > 1) {
      const options = tied
        .map(
          (entry) =>
            `${entry.product.name} (${entry.product.price.toLocaleString("fa-IR")} تومان)`
        )
        .join("، ");
      return `چند محصول با این توضیحات پیدا شد، اسم دقیق‌تری لازم است: ${options}`;
    }

    const match = tied[0].product;
    const stockText =
      match.stock > 0
        ? `${match.stock} عدد موجود است`
        : "متاسفانه در حال حاضر ناموجود است";

    return `${match.name} — قیمت: ${match.price.toLocaleString("fa-IR")} تومان — موجودی: ${stockText}`;
  },

  list_products: (args) => {
    const store = loadStoreData();
    if (!store) {
      return "خطا: فایل داده‌ی فروشگاه (data/store-data.json) پیدا نشد یا معتبر نیست.";
    }

    let results = store.products;

    if (args.category) {
      results = results.filter((p) => p.category === args.category);
    }
    if (typeof args.min_price === "number") {
      results = results.filter((p) => p.price >= args.min_price);
    }
    if (typeof args.max_price === "number") {
      results = results.filter((p) => p.price <= args.max_price);
    }
    if (args.keyword) {
      const nk = normalizePersian(args.keyword);
      results = results.filter((p) => {
        const haystack = normalizePersian(`${p.name} ${p.description || ""}`);
        return haystack.includes(nk);
      });
    }

    if (results.length === 0) {
      return "هیچ محصولی با این فیلترها پیدا نشد. برای دیدن همه‌ی محصولات، list_products را بدون هیچ فیلتری صدا بزن.";
    }

    const totalMatches = results.length;
    results = results
      .slice()
      .sort((a, b) => b.average_rating - a.average_rating)
      .slice(0, MAX_LIST_RESULTS);

    const lines = results.map(
      (p) =>
        `${p.name} — ${p.price.toLocaleString("fa-IR")} تومان — امتیاز ${p.average_rating}/۵ — موجودی: ${p.stock > 0 ? p.stock + " عدد" : "ناموجود"}`
    );

    if (totalMatches > results.length) {
      lines.push(`(و ${totalMatches - results.length} محصول دیگر که نشان داده نشد)`);
    }

    return lines.join("\n");
  },
};

async function callOllama(messages, model, tools, signal) {
  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, tools, stream: false }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama با کد ${res.status} پاسخ داد. ${text}`);
  }
  return res.json();
}

export async function POST(req) {
  let messages;
  let model;
  try {
    const body = await req.json();
    messages = body.messages || [];
    model = body.model || DEFAULT_MODEL;
  } catch (e) {
    return new Response(JSON.stringify({ error: "درخواست نامعتبر است." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const store = loadStoreData();
  const tools = [...STATIC_TOOLS, buildListProductsTool(store)];

  const systemMessage = {
    role: "system",
    content:
      "You are a helpful shop assistant. Always answer in Persian (فارسی) unless the user explicitly asks for another language. You only know about products through the check_inventory and list_products tools — never assume a real-world brand (Samsung, Sony, Xiaomi, etc.) is sold here. When a customer asks for a recommendation or wants to browse, use list_products: use category/price filters when they clearly fit, and use the keyword filter for anything else (features, use-cases, product types) instead of guessing a category or giving up. When a customer names a specific product, use check_inventory.",
  };

  const conversation = [systemMessage, ...messages];
  const toolLog = [];

  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const data = await callOllama(conversation, model, tools, req.signal);
      const message = data.message;

      if (!message.tool_calls || message.tool_calls.length === 0) {
        return new Response(
          JSON.stringify({ content: message.content, toolLog }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      conversation.push(message);

      for (const toolCall of message.tool_calls) {
        const fnName = toolCall.function.name;
        const fnArgs = toolCall.function.arguments;
        const fn = TOOL_IMPLEMENTATIONS[fnName];

        const result = fn ? fn(fnArgs) : `تابعی به اسم ${fnName} پیدا نشد.`;

        toolLog.push({ name: fnName, args: fnArgs, result: String(result) });

        conversation.push({
          role: "tool",
          content: String(result),
          tool_call_id: toolCall.id,
        });
      }
    }

    return new Response(
      JSON.stringify({
        content: "تعداد دفعات فراخوانی ابزار بیش از حد مجاز شد.",
        toolLog,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    if (err.name === "AbortError") {
      return new Response(null, { status: 204 });
    }
    return new Response(
      JSON.stringify({ error: err.message || "خطای ناشناخته." }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}