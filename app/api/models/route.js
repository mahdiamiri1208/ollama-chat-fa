export const runtime = "nodejs";

const OLLAMA_TAGS_URL = "http://127.0.0.1:11434/api/tags";

export async function GET() {
  try {
    const res = await fetch(OLLAMA_TAGS_URL);

    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: `Ollama با کد ${res.status} پاسخ داد.` }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = await res.json();
    const models = (data.models || [])
      .map((m) => m.name || m.model)
      .filter(Boolean);

    return new Response(JSON.stringify({ models }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error:
          "اتصال به Ollama برقرار نشد. مطمئن شوید با دستور «ollama serve» در حال اجراست.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}