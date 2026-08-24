/**
 * Motor de IA da LUCK.
 * 1º usa os créditos Lovable (LOVABLE_API_KEY) — sem custo extra.
 * Só usa a OpenAI (OPENAI_API_KEY) como reserva, se a chave existir.
 */

const LOVABLE_URL = "https://ai.gateway.lovable.dev/v1";
const OPENAI_URL = "https://api.openai.com/v1";

function openaiModel(model: string): string {
  if (model.startsWith("openai/")) return model.slice("openai/".length);
  if (model.includes("pro")) return "gpt-4o";
  return "gpt-4o-mini";
}

function shouldFallback(status: number) {
  return status === 401 || status === 402 || status === 429 || status >= 500;
}

export async function aiChat(body: Record<string, unknown>): Promise<Response> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (lovableKey) {
    try {
      const res = await fetch(`${LOVABLE_URL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableKey}` },
        body: JSON.stringify(body),
      });
      if (res.ok || !openaiKey || !shouldFallback(res.status)) return res;
    } catch (err) {
      if (!openaiKey) throw err;
    }
  }

  if (!openaiKey) throw new Error("IA indisponível no momento.");

  return fetch(`${OPENAI_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({ ...body, model: openaiModel(String(body.model ?? "")) }),
  });
}

export async function aiTranscribe(build: () => FormData): Promise<Response> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (lovableKey) {
    try {
      const res = await fetch(`${LOVABLE_URL}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${lovableKey}` },
        body: build(),
      });
      if (res.ok || !openaiKey || !shouldFallback(res.status)) return res;
    } catch (err) {
      if (!openaiKey) throw err;
    }
  }

  if (!openaiKey) throw new Error("IA indisponível no momento.");

  const form = build();
  form.set("model", "whisper-1");
  return fetch(`${OPENAI_URL}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}` },
    body: form,
  });
}
