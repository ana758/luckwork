/**
 * Motor de IA da LUCK.
 * 1º usa o Claude (ANTHROPIC_API_KEY), pela API compatível com OpenAI da Anthropic.
 * Se a chave não existir ou o Claude falhar, cai para os créditos Lovable
 * (LOVABLE_API_KEY) e, por último, para a OpenAI (OPENAI_API_KEY).
 * Voz → texto (transcrição) continua nos provedores de áudio: o Claude não transcreve áudio.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1";
/** Troque o modelo sem mexer no código: variável ANTHROPIC_MODEL. */
const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-5-5";

/** Há pelo menos um motor de IA configurado? */
export function hasAiProvider() {
  return Boolean(
    process.env.ANTHROPIC_API_KEY || process.env.LOVABLE_API_KEY || process.env.OPENAI_API_KEY,
  );
}

/** O Claude responde JSON às vezes dentro de ```json … ```; tira a cerca. */
function stripFence(text: string) {
  const m = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1] : text;
}

async function claudeChat(body: Record<string, unknown>): Promise<Response | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const wantsJson = (body.response_format as { type?: string } | undefined)?.type === "json_object";
  const { response_format: _ignored, model: _model, ...rest } = body;
  void _ignored;
  void _model;
  try {
    const res = await fetch(`${ANTHROPIC_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        ...rest,
        model: process.env.ANTHROPIC_MODEL || ANTHROPIC_DEFAULT_MODEL,
        max_tokens: (rest.max_tokens as number | undefined) ?? 4096,
      }),
    });
    if (!res.ok) return null; // cai para o próximo motor
    if (!wantsJson) return res;
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const msg = json.choices?.[0]?.message;
    if (msg?.content) msg.content = stripFence(msg.content);
    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return null;
  }
}

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
  const claude = await claudeChat(body);
  if (claude) return claude;

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
