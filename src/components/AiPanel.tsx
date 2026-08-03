import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mic, MicOff, Send, Sparkles, Volume2, VolumeX, X } from "lucide-react";
import { toast } from "sonner";
import {
  aiAction,
  dismissAiSuggestion,
  getDailyBriefing,
  listAiSuggestions,
  transcribeAudio,
} from "@/lib/ai.functions";


type Msg = { role: "user" | "assistant"; content: string };

function speak(text: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text.slice(0, 900));
    u.lang = "pt-BR";
    const v = synth.getVoices().find((x) => x.lang?.toLowerCase().startsWith("pt"));
    if (v) u.voice = v;
    synth.speak(u);
  } catch {
    /* ignore */
  }
}

export function AiPanel() {
  const [open, setOpen] = useState(false);
  const [voice, setVoice] = useState(true);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const queryClient = useQueryClient();

  const suggestionsQuery = useQuery({
    queryKey: ["ai-suggestions"],
    queryFn: () => listAiSuggestions(),
    refetchInterval: 60_000,
  });

  const dismissSuggestion = useMutation({
    mutationFn: (id: string) => dismissAiSuggestion({ data: { id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ai-suggestions"] }),
  });


  const ask = useMutation({
    mutationFn: async (q?: string) => {
      if (!q) {
        const res = await getDailyBriefing({ data: {} });
        return { reply: res.text, created: undefined as undefined | { kind: string; title: string } };
      }
      const res = await aiAction({ data: { text: q } });
      return { reply: res.reply, created: res.created };
    },
    onSuccess: (res, variables) => {
      setMessages((m) => [
        ...m,
        ...(variables ? [{ role: "user" as const, content: variables }] : []),
        { role: "assistant" as const, content: res.reply },
      ]);
      setQuestion("");
      if (voice) speak(res.reply);
      if (res.created) {
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
        queryClient.invalidateQueries({ queryKey: ["meetings"] });
        toast.success(
          res.created.kind === "task"
            ? `Tarefa adicionada: ${res.created.title}`
            : `Compromisso adicionado: ${res.created.title}`,
        );
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, ask.isPending]);

  useEffect(() => {
    if (!open) window.speechSynthesis?.cancel();
  }, [open]);

  async function toggleListening() {
    if (listening && recorderRef.current) {
      const rec = recorderRef.current;
      const stream = streamRef.current;
      setListening(false);
      try {
        await new Promise<void>((resolve) => {
          rec.addEventListener("stop", () => resolve(), { once: true });
          rec.stop();
        });
      } catch {
        /* ignore */
      }
      stream?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;

      const blob = new Blob(chunksRef.current, {
        type: chunksRef.current[0]?.type || "audio/webm",
      });
      chunksRef.current = [];
      if (blob.size < 800) {
        toast.error("Áudio muito curto. Fale por 1 segundo ou mais.");
        return;
      }

      setTranscribing(true);
      try {
        const buf = await blob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = "";
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
        }
        const { text } = await transcribeAudio({
          data: { audioBase64: btoa(bin), mimeType: blob.type || "audio/webm" },
        });
        if (!text) {
          toast.error("Não entendi o áudio. Tente falar novamente.");
          return;
        }
        ask.mutate(text);
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setTranscribing(false);
      }
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Microfone não disponível neste dispositivo.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      rec.start();
      recorderRef.current = rec;
      streamRef.current = stream;
      setListening(true);
    } catch (e) {
      toast.error(`Não consegui acessar o microfone: ${(e as Error).message}`);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent"
        aria-label="Abrir LUCK AI"
      >
        <Sparkles className="h-4 w-4" /> LUCK AI
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-foreground/20"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="fixed inset-x-3 top-16 z-50 flex max-h-[75vh] flex-col overflow-hidden rounded-xl border bg-card shadow-lg sm:left-auto sm:right-6 sm:w-[400px]">
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <Sparkles className="h-4 w-4" />
              <p className="text-sm font-semibold">LUCK AI</p>
              <button
                onClick={() => setVoice((v) => !v)}
                className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-accent"
                aria-label={voice ? "Desligar resposta em áudio" : "Ligar resposta em áudio"}
              >
                {voice ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </button>
              <button
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div ref={scrollRef} className="min-h-32 flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {messages.length === 0 && !ask.isPending && (
                <p className="text-sm text-muted-foreground">
                  Escreva ou fale: "adiciona na Angi entregar roteiro dia 12/08" — eu faço pra você.
                </p>
              )}
              {messages.map((m, i) => (
                <div key={i} className={m.role === "user" ? "text-right" : ""}>
                  <div
                    className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {(ask.isPending || transcribing) && (
                <p className="text-sm text-muted-foreground">
                  {transcribing ? "Transcrevendo…" : "Pensando…"}
                </p>
              )}
            </div>

            <div className="border-t p-3">
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (question.trim()) ask.mutate(question.trim());
                  }
                }}
                rows={3}
                placeholder="Escreva o que precisa…"
                className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={toggleListening}
                  disabled={transcribing}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs ${
                    listening ? "border-destructive text-destructive" : "hover:bg-accent"
                  }`}
                >
                  {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  {listening ? "Parar" : "Falar"}
                </button>
                <button
                  onClick={() => ask.mutate(undefined)}
                  className="rounded-md border px-3 py-2 text-xs hover:bg-accent"
                >
                  Resumo do dia
                </button>
                <button
                  onClick={() => question.trim() && ask.mutate(question.trim())}
                  disabled={ask.isPending || !question.trim()}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  <Send className="h-4 w-4" /> Enviar
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
