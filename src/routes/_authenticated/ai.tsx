import { useMemo, useRef, useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, ListTodo, Mail, Mic, MicOff, Send, Sparkles, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { aiAction, getDailyBriefing, getImportantEmails, transcribeAudio, type ImportantEmail } from "@/lib/ai.functions";
import { useMeetings, useTasks } from "@/lib/queries";
import { isOverdue, SOURCE_DOT } from "@/lib/sources";

export const Route = createFileRoute("/_authenticated/ai")({
  head: () => ({
    meta: [
      { title: "IA · Anora" },
      {
        name: "description",
        content: "Resumo do dia, atrasos, reuniões e sugestões práticas geradas por IA.",
      },
      { property: "og:title", content: "IA · Anora" },
      { property: "og:description", content: "Resumo do dia e sugestões práticas." },
    ],
  }),
  component: AIPage,
});

type Msg = { role: "user" | "assistant"; content: string };

function AIPage() {
  const { data: tasks = [] } = useTasks();
  const { data: meetings = [] } = useMeetings();
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const summary = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const in7 = new Date(today);
    in7.setDate(in7.getDate() + 7);

    const overdue = tasks.filter((t) => isOverdue(t));
    const todayTasks = tasks.filter(
      (t) =>
        t.due_date &&
        t.status !== "done" &&
        new Date(`${t.due_date}T12:00:00`).toDateString() === today.toDateString(),
    );
    const meetingsToday = meetings.filter((m) => {
      const d = new Date(m.starts_at);
      return d >= today && d < tomorrow;
    });
    const meetingsWeek = meetings.filter((m) => {
      const d = new Date(m.starts_at);
      return d >= today && d <= in7;
    });
    const stuck = tasks.filter((t) => {
      if (t.status === "done") return false;
      const days = (Date.now() - new Date(t.updated_at).getTime()) / 86400000;
      return days > 7;
    });

    return { overdue, todayTasks, meetingsToday, meetingsWeek, stuck };
  }, [tasks, meetings]);

  const queryClient = useQueryClient();

  const emailsQuery = useQuery({
    queryKey: ["important-emails"],
    queryFn: () => getImportantEmails(),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const ask = useMutation({
    mutationFn: async (q?: string) => {
      // Sem texto → resumo do dia. Com texto → interpreta (pode criar tarefa/reunião).
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

  async function toggleListening() {
    // Se está gravando → para, transcreve e envia
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
        // Blob → base64
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
        // Envia direto pra IA agir
        ask.mutate(text);
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setTranscribing(false);
      }
      return;
    }

    // Inicia gravação
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Microfone não disponível neste dispositivo.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Prefere webm/opus; Safari cai em mp4
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

  const suggestions = [
    "Resumo do dia",
    "O que priorizar hoje?",
    "Apagar tarefa teste 4",
    "Como está a semana na Angi?",
  ];


  return (
    <div className="flex min-h-[calc(100dvh-14rem)] flex-col gap-4 pb-6 md:min-h-[calc(100vh-6rem)]">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Espaço IA</h1>
        <p className="text-sm text-muted-foreground">
          Converse, peça resumo, adicione tarefas ou apague o que não precisa mais.
        </p>
      </header>


      {/* Alert cards */}
      <div className="grid gap-2 sm:grid-cols-3">
        <SummaryCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Atrasadas"
          value={summary.overdue.length}
          tone={summary.overdue.length > 0 ? "danger" : "muted"}
        />
        <SummaryCard
          icon={<ListTodo className="h-4 w-4" />}
          label="Para hoje"
          value={summary.todayTasks.length}
          tone="default"
        />
        <SummaryCard
          icon={<CalendarClock className="h-4 w-4" />}
          label="Reuniões hoje"
          value={summary.meetingsToday.length}
          tone="default"
        />
      </div>

      {(summary.overdue.length > 0 || summary.stuck.length > 0) && (
        <div className="rounded-xl border border-reuniao/30 bg-reuniao/5 p-3 text-sm">
          <p className="mb-2 font-medium text-reuniao">Precisam da sua atenção</p>
          <ul className="space-y-1">
            {summary.overdue.slice(0, 3).map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-xs">
                <span className={`h-2 w-2 rounded-full ${SOURCE_DOT[t.source]}`} />
                <span className="truncate">{t.title}</span>
                <span className="ml-auto text-muted-foreground">
                  venceu {new Date(`${t.due_date}T12:00:00`).toLocaleDateString("pt-BR")}
                </span>
              </li>
            ))}
            {summary.stuck.slice(0, 2).map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-xs">
                <span className={`h-2 w-2 rounded-full ${SOURCE_DOT[t.source]}`} />
                <span className="truncate">{t.title}</span>
                <span className="ml-auto text-muted-foreground">arrastando há dias</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* E-mails importantes filtrados pela IA */}
      <ImportantEmailsCard
        loading={emailsQuery.isLoading}
        emails={emailsQuery.data?.emails ?? []}
        error={emailsQuery.data?.error}
      />



      {/* Composer FIRST (perto do teclado no mobile) */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex items-end gap-2"
      >
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          maxLength={2000}
          rows={3}
          placeholder={
            listening
              ? "🔴 Gravando… toque no microfone para parar e enviar"
              : transcribing
                ? "Transcrevendo áudio…"
                : 'Fale ou escreva. Ex.: "adiciona tarefa angi entrega branding pessoal 27/07"'
          }
          disabled={transcribing}
          className="flex-1 resize-none rounded-2xl border bg-card px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
        />
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={toggleListening}
            disabled={transcribing || ask.isPending}
            className={`flex h-12 w-12 items-center justify-center rounded-full border transition-colors disabled:opacity-60 ${
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
            className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-60"
            aria-label="Enviar"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>

      {/* Chat area */}
      <div
        ref={scrollRef}
        className="min-h-[40vh] flex-1 space-y-3 overflow-y-auto rounded-xl border bg-card p-4"
      >
        {messages.length === 0 && !ask.isPending && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <p className="text-sm text-muted-foreground">
              Peça resumo, adicione ou apague tarefas/reuniões por texto ou voz.
            </p>
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s === "Resumo do dia" ? undefined : s)}
                  className="rounded-full border px-3 py-1 text-xs hover:bg-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
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
  );
}


function SummaryCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "default" | "danger" | "muted";
}) {
  const toneClass =
    tone === "danger"
      ? "border-reuniao/40 bg-reuniao/5 text-reuniao"
      : tone === "muted"
        ? "border-border bg-card text-muted-foreground"
        : "border-border bg-card text-foreground";
  return (
    <div className={`flex items-center gap-3 rounded-xl border p-3 ${toneClass}`}>
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-background/60">
        {icon}
      </div>
      <div>
        <p className="text-xs opacity-80">{label}</p>
        <p className="text-lg font-semibold">{value}</p>
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
      {!loading && !error && emails.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nada urgente na caixa de entrada — só ruído (promoções, newsletters).
        </p>
      )}
      {emails.length > 0 && (
        <ul className="space-y-2">
          {emails.slice(0, 8).map((e) => (
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
                  className="shrink-0 text-muted-foreground hover:text-primary"
                  aria-label="Abrir no Gmail"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
