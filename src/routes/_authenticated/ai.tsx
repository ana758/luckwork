import { useMemo, useRef, useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, ListTodo, Mail, Mic, MicOff, Send, Sparkles, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { aiAction, getDailyBriefing, getImportantEmails, type ImportantEmail } from "@/lib/ai.functions";
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

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

  function toggleListening() {
    const SR =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast.error("Reconhecimento de voz não suportado neste navegador. Use Safari no iPhone.");
      return;
    }
    if (listening && recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      setListening(false);
      return;
    }
    const rec = new SR();
    rec.lang = "pt-BR";
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (ev: any) => {
      let text = "";
      for (let i = 0; i < ev.results.length; i++) {
        text += ev.results[i][0].transcript;
      }
      setQuestion(text);
    };
    rec.onerror = (ev: any) => {
      toast.error(`Voz: ${ev.error ?? "erro"}`);
      setListening(false);
    };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch (e) {
      toast.error(`Não consegui iniciar o microfone: ${(e as Error).message}`);
    }
  }

  const suggestions = [
    "Resumo do dia",
    "O que priorizar hoje?",
    "Tarefas travadas — como destravar?",
    "Como está a semana na Angi?",
  ];

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4 md:h-[calc(100vh-4rem)]">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Espaço IA</h1>
        <p className="text-sm text-muted-foreground">
          Converse com sua assistente. Resumo do dia, alertas e sugestões práticas.
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



      {/* Chat area */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto rounded-xl border bg-card p-4"
      >
        {messages.length === 0 && !ask.isPending && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <p className="text-sm text-muted-foreground">
              Peça um resumo do dia ou pergunte algo sobre suas tarefas e reuniões.
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

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex gap-2"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={400}
          placeholder='Ex.: "adiciona tarefa pessoal dia 28/07 falar com dr lazaro"'
          className="flex-1 rounded-full border bg-card px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          disabled={ask.isPending}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-60"
          aria-label="Enviar"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
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
