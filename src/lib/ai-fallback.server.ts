/**
 * Motor de IA da LUCK.
 * 1º usa a conta paga do ChatGPT (OPENAI_API_KEY) da Ana.
 * Só se ela faltar ou falhar (limite/erro) usa o gateway Lovable como reserva.
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

  if (openaiKey) {
    try {
      const res = await fetch(`${OPENAI_URL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({ ...body, model: openaiModel(String(body.model ?? "")) }),
      });
      if (res.ok || !lovableKey || !shouldFallback(res.status)) return res;
    } catch (err) {
      if (!lovableKey) throw err;
    }
  }

  if (!lovableKey) throw new Error("IA indisponível no momento.");

  return fetch(`${LOVABLE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableKey}` },
    body: JSON.stringify(body),
  });
}

export async function aiTranscribe(build: () => FormData): Promise<Response> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (openaiKey) {
    try {
      const form = build();
      form.set("model", "whisper-1");
      const res = await fetch(`${OPENAI_URL}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}` },
        body: form,
      });
      if (res.ok || !lovableKey || !shouldFallback(res.status)) return res;
    } catch (err) {
      if (!lovableKey) throw err;
    }
  }

  if (!lovableKey) throw new Error("IA indisponível no momento.");

  return fetch(`${LOVABLE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${lovableKey}` },
    body: build(),
  });
}
