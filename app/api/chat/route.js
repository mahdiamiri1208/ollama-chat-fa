import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

const OLLAMA_URL = "http://127.0.0.1:11434/api/chat";
const DEFAULT_MODEL = "gpt-oss:20b";
const MAX_TOOL_ITERATIONS = 5;

const WORKSPACE_DIR = path.resolve("./agent-workspace");
if (!fs.existsSync(WORKSPACE_DIR)) {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "add_numbers",
      description: "Add two numbers together and return the sum.",
      parameters: {
        type: "object",
        required: ["a", "b"],
        properties: {
          a: { type: "number", description: "The first number" },
          b: { type: "number", description: "The second number" },
        },
      },
    },
  },
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
            description:
              "Relative filename inside the workspace, e.g. notes.txt",
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
            description:
              "Relative filename inside the workspace, e.g. notes.txt",
          },
          content: {
            type: "string",
            description: "The full text content to write into the file.",
          },
        },
      },
    },
  },
];

function isInsideWorkspace(requestedPath) {
  return (
    requestedPath === WORKSPACE_DIR ||
    requestedPath.startsWith(WORKSPACE_DIR + path.sep)
  );
}

const TOOL_IMPLEMENTATIONS = {
  add_numbers: (args) => args.a + args.b,

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
};

async function callOllama(messages, model, signal) {
  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, tools: TOOLS, stream: false }),
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

  const systemMessage = {
    role: "system",
    content:
      "You are a helpful assistant. Always answer in Persian (فارسی) unless the user explicitly asks for another language. You have tools available; use them when they genuinely help answer the question.",
  };

  const conversation = [systemMessage, ...messages];
  const toolLog = [];

  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const data = await callOllama(conversation, model, req.signal);
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