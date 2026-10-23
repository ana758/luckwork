import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ExternalLink,
  Mail,
  Mic,
  MicOff,
  Send,
  Sparkles,
  Volume2,
  VolumeX,
} from "lucide-react";
import { toast } from "sonner";
import {
  aiAction,
  dismissAiSuggestion,
  dismissEmail,
  getDailyBriefing,
  getImportantEmails,
  listAiSuggestions,
  transcribeAudio,
  type ImportantEmail,
} from "@/lib/ai.functions";

type Msg = { role: "user" | "assistant"; content: string };

function speak(text: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[#*_`>]/g, "").slice(0, 1200));
    u.lang = "pt-BR";
    const v = synth.getVoices().find((x) => x.lang?.toLowerCase().startsWith("pt"));
    if (v) u.voice = v;
    synth.speak(u);
  } catch {
    /* ignore */
  }
}

export function AiConsole({ compact = false }: { compact?: boolean }) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voice, setVoice] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const queryClient = useQueryClient();

  const emailsQuery = useQuery({
    queryKey: ["important-emails"],
    queryFn: () => getImportantEmails(),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

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
        { role: "assistant", content: res.reply },
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

  function send(q?: string) {
    const text = (q ?? question).trim();
    if (!text) {
      ask.mutate(undefined);
      return;
    }
    ask.mutate(text);
  }

  function answerSuggestion(
    s: { id: string; title: string; body: string | null },
    accept: boolean,
  ) {
    dismissSuggestion.mutate(s.id);
    const context = `${s.title.replace(/^🤖\s*/, "")}${s.body ? ` — ${s.body}` : ""}`;
    if (!accept) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: context },
        { role: "user", content: "Agora não." },
      ]);
      return;
    }
    setMessages((m) => [...m, { role: "assistant", content: context }]);
    ask.mutate(`Sobre sua sugestão "${context}": pode fazer, sim. Siga em frente.`);
  }


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
      } catch {}
      stream?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;

      const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || "audio/webm" });
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
        const base64 = btoa(bin);
        const { text } = await transcribeAudio({
          data: { audioBase64: base64, mimeType: blob.type || "audio/webm" },
        });
        if (!text) {
          toast.error("Não entendi o áudio. Tente falar novamente.");
          return;
        }
        setQuestion(text);
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
    <div className="space-y-4">
      <ImportantEmailsCard
        loading={emailsQuery.isLoading}
        emails={emailsQuery.data?.emails ?? []}
        error={emailsQuery.data?.error}
      />

      <div className={compact ? "flex flex-col overflow-hidden rounded-2xl border bg-card" : "space-y-4"}>
      {compact && (
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          <Sparkles className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">LUCK AI</p>
          <span className="text-xs text-muted-foreground">sugestões e comandos</span>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className={compact ? "order-2 flex items-end gap-2 border-t p-2" : "flex items-end gap-2"}
      >
        <textarea
          value={question}
          onChange={(e) => {
            setQuestion(e.target.value);
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.metaKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={compact ? 1 : 3}
          placeholder={
            listening
              ? "🔴 Gravando… toque no microfone para parar e enviar"
              : transcribing
                ? "Transcrevendo áudio…"
                : compact
                  ? "Pergunte ou peça algo ao LUCK AI…"
                  : 'Fale ou escreva à vontade (Shift+Enter quebra linha). Ex.: "adiciona tarefa angi entrega branding pessoal 27/07"'
          }
          disabled={transcribing}
          className={`${compact ? "min-h-[40px] resize-none rounded-xl bg-background px-3 py-2" : "min-h-[88px] resize-y rounded-2xl bg-card px-4 py-3"} max-h-80 flex-1 overflow-y-auto border text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60`}
        />

        <div className={compact ? "flex gap-1.5" : "flex flex-col gap-2"}>
          <button
            type="button"
            onClick={toggleListening}
            disabled={transcribing || ask.isPending}
            className={`flex ${compact ? "h-10 w-10" : "h-12 w-12"} items-center justify-center rounded-full border transition-colors disabled:opacity-60 ${
              listening
                ? "border-reuniao bg-reuniao text-white animate-pulse"
                : "bg-card text-foreground hover:bg-accent"
            }`}
            aria-label={listening ? "Parar e enviar" : "Falar"}
          >
            {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>
          <button
            type="submit"
            disabled={ask.isPending}
            className={`flex ${compact ? "h-10 w-10" : "h-12 w-12"} items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-60`}
            aria-label="Enviar"
          >
            <Send className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (voice) window.speechSynthesis?.cancel();
              setVoice((v) => !v);
            }}
            className={`flex ${compact ? "h-10 w-10" : "h-12 w-12"} items-center justify-center rounded-full border transition-colors ${
              voice ? "border-primary bg-primary/10 text-primary" : "bg-card hover:bg-accent"
            }`}
            aria-label={voice ? "Desligar resposta em voz" : "Ligar resposta em voz"}
            title={voice ? "Resposta em voz ligada" : "Resposta em voz desligada"}
          >
            {voice ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
          </button>
        </div>
      </form>

      <div
        ref={scrollRef}
        className={`${compact ? "order-1 grid max-h-96 gap-2 overflow-y-auto p-3 md:grid-cols-2" : "min-h-[40vh] flex-1 space-y-3 overflow-y-auto rounded-xl border bg-card p-4"}`}
      >
        {(suggestionsQuery.data ?? []).map((s) => (
          <div key={s.id} className="flex justify-start">
            <div className={`${compact ? "w-full" : "max-w-[90%]"} rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm`}>
              <p className="mb-1 flex items-center gap-1.5 font-medium">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                {s.title.replace(/^🤖\s*/, "")}
              </p>
              {s.body && <p className="text-muted-foreground">{s.body}</p>}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => answerSuggestion(s, true)}
                  className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
                >
                  Pode fazer
                </button>
                <button
                  type="button"
                  onClick={() => answerSuggestion(s, false)}
                  className="rounded-full border px-3 py-1 text-xs hover:bg-accent"
                >
                  Agora não
                </button>
              </div>
            </div>
          </div>
        ))}


        {messages.map((m, i) => (
          <div key={i} className={`flex ${compact ? "md:col-span-2" : ""} ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-foreground"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}

        {ask.isPending && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-secondary px-4 py-2 text-sm text-muted-foreground">
              Pensando…
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

const CATEGORY_LABEL: Record<string, string> = {
  juridico: "Jurídico",
  pessoal: "Pessoal",
  trabalho: "Trabalho",
  financeiro: "Financeiro",
  outro: "Importante",
};

function ImportantEmailsCard({
  loading,
  emails,
  error,
}: {
  loading: boolean;
  emails: ImportantEmail[];
  error?: string;
}) {
  const queryClient = useQueryClient();
  const [hidden, setHidden] = useState<string[]>([]);
  const dismiss = useMutation({
    mutationFn: (emailId: string) => dismissEmail({ data: { emailId } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["important-emails"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const visible = emails.filter((e) => !hidden.includes(e.id));

  function markSeen(id: string) {
    setHidden((h) => [...h, id]);
    dismiss.mutate(id);
  }

  return (
    <div className="rounded-xl border bg-card p-3 text-sm">
      <div className="mb-2 flex items-center gap-2">
        <Mail className="h-4 w-4 text-primary" />
        <p className="font-medium">E-mails importantes</p>
        {loading && <span className="text-xs text-muted-foreground">carregando…</span>}
      </div>
      {error && !loading && (
        <p className="text-xs text-muted-foreground">
          {error} A IA lê apenas a caixa conectada; spam e promoções são ignorados.
        </p>
      )}
      {!loading && !error && visible.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nada urgente na caixa de entrada — só ruído (promoções, newsletters).
        </p>
      )}
      {visible.length > 0 && (
        <ul className="space-y-2">
          {visible.slice(0, 8).map((e) => (
            <li key={e.id} className="rounded-lg border bg-background/40 p-2">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  {CATEGORY_LABEL[e.category] ?? "Importante"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{e.subject}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{e.from}</p>
                  {e.reason && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">↳ {e.reason}</p>
                  )}
                </div>
                <a
                  href={e.link}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => markSeen(e.id)}
                  className="shrink-0 text-muted-foreground hover:text-primary"
                  aria-label="Abrir no Gmail"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <button
                  type="button"
                  onClick={() => markSeen(e.id)}
                  className="shrink-0 text-muted-foreground hover:text-primary"
                  aria-label="Já vi este e-mail"
                  title="Já vi"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
