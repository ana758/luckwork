/**
 * Server-only Jira API client. Autentica com JIRA_EMAIL + JIRA_API_TOKEN
 * (Atlassian API token) e conversa com https://angisaude.atlassian.net.
 *
 * Escopo: apenas o projeto "Angi | Commercial & Marketing" (key = TASK),
 * apenas issues atribuídas ao usuário autenticado (currentUser()).
 */

const BASE = "https://angisaude.atlassian.net";
const PROJECT_KEY = "TASK";
const ASSIGNEE_EMAIL = "ana@devoresnacks.com";

let cachedAssigneeId: string | null = null;
async function getAssigneeAccountId(): Promise<string | null> {
  if (cachedAssigneeId) return cachedAssigneeId;
  try {
    const data: any = await jiraFetch(
      `/rest/api/3/user/search?query=${encodeURIComponent(ASSIGNEE_EMAIL)}`,
    );
    const match = (data ?? []).find(
      (u: any) => (u.emailAddress ?? "").toLowerCase() === ASSIGNEE_EMAIL,
    ) ?? data?.[0];
    cachedAssigneeId = match?.accountId ?? null;
  } catch {
    cachedAssigneeId = null;
  }
  return cachedAssigneeId;
}

function authHeader() {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) throw new Error("Credenciais Jira ausentes (JIRA_EMAIL / JIRA_API_TOKEN).");
  const b64 = Buffer.from(`${email}:${token}`).toString("base64");
  return `Basic ${b64}`;
}

async function jiraFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: authHeader(),
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jira ${res.status}: ${body.slice(0, 400)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export type JiraIssue = {
  key: string;
  summary: string;
  statusName: string;
  statusCategory: "done" | "indeterminate" | "new" | "undefined";
  dueDate: string | null;
  priorityName: string | null;
  updated: string;
  url: string;
};

/** Retorna todas as issues do projeto TASK atribuídas ao dono do token. */
export async function listMyIssues(): Promise<JiraIssue[]> {
  const jql = `project = ${PROJECT_KEY} AND assignee = currentUser() ORDER BY updated DESC`;
  const fields = "summary,status,duedate,priority,updated";
  const out: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  // paginação nova (search/jql) usa nextPageToken
  for (let i = 0; i < 20; i++) {
    const params = new URLSearchParams({ jql, fields, maxResults: "100" });
    if (nextPageToken) params.set("nextPageToken", nextPageToken);
    const data: any = await jiraFetch(`/rest/api/3/search/jql?${params}`);
    for (const iss of data.issues ?? []) {
      out.push({
        key: iss.key,
        summary: iss.fields?.summary ?? iss.key,
        statusName: iss.fields?.status?.name ?? "",
        statusCategory: iss.fields?.status?.statusCategory?.key ?? "undefined",
        dueDate: iss.fields?.duedate ?? null,
        priorityName: iss.fields?.priority?.name ?? null,
        updated: iss.fields?.updated ?? new Date().toISOString(),
        url: `${BASE}/browse/${iss.key}`,
      });
    }
    nextPageToken = data.nextPageToken;
    if (!nextPageToken) break;
  }
  return out;
}

export async function getTransitions(issueKey: string): Promise<{ id: string; name: string; toCategory: string }[]> {
  const data: any = await jiraFetch(`/rest/api/3/issue/${issueKey}/transitions`);
  return (data.transitions ?? []).map((t: any) => ({
    id: t.id,
    name: t.name,
    toCategory: t.to?.statusCategory?.key ?? "",
  }));
}

/** Move a issue para a primeira transição que leve a statusCategory=done. */
export async function transitionToDone(issueKey: string): Promise<boolean> {
  return transitionToStatus(issueKey, "done");
}

/**
 * Move a issue para uma coluna correspondente ao status do Anora.
 * todo → statusCategory "new" (To Do), doing → "indeterminate" c/ nome ~ progress,
 * onhold → nome ~ review/hold, done → statusCategory "done".
 */
export async function transitionToStatus(
  issueKey: string,
  target: "todo" | "doing" | "onhold" | "done",
): Promise<boolean> {
  const transitions = await getTransitions(issueKey);
  const pick = (): { id: string } | undefined => {
    if (target === "done") {
      return (
        transitions.find((t) => t.toCategory === "done") ??
        transitions.find((t) => /done|conclu|resolv|finaliz/i.test(t.name))
      );
    }
    if (target === "onhold") {
      return transitions.find((t) => /review|revis|hold|paus|aguard/i.test(t.name));
    }
    if (target === "doing") {
      return (
        transitions.find((t) => /progress|andamento|doing|working/i.test(t.name)) ??
        transitions.find((t) => t.toCategory === "indeterminate")
      );
    }
    // todo
    return (
      transitions.find((t) => /to.?do|a fazer|backlog|open|novo/i.test(t.name)) ??
      transitions.find((t) => t.toCategory === "new")
    );
  };
  const chosen = pick();
  if (!chosen) return false;
  await jiraFetch(`/rest/api/3/issue/${issueKey}/transitions`, {
    method: "POST",
    body: JSON.stringify({ transition: { id: chosen.id } }),
  });
  await ensureAssignee(issueKey);
  return true;
}

/** Cria uma nova issue no projeto Angi | Commercial & Marketing atribuída à Ana (ana@devoresnacks.com). */
export async function createIssue(input: {
  summary: string;
  dueDate?: string | null;
  priority?: "alta" | "media" | "baixa" | null;
}): Promise<{ key: string; url: string }> {
  const priorityName =
    input.priority === "alta" ? "High" : input.priority === "baixa" ? "Low" : "Medium";
  const accountId = (await getAssigneeAccountId()) ?? "-1";
  const fields: Record<string, unknown> = {
    project: { key: PROJECT_KEY },
    summary: input.summary,
    issuetype: { name: "Task" },
    assignee: { accountId },
    priority: { name: priorityName },
  };
  if (input.dueDate) fields.duedate = input.dueDate;
  const data: any = await jiraFetch(`/rest/api/3/issue`, {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
  // Garante o assignee mesmo que o create tenha ignorado (fluxos que exigem PUT).
  try {
    await jiraFetch(`/rest/api/3/issue/${data.key}/assignee`, {
      method: "PUT",
      body: JSON.stringify({ accountId }),
    });
  } catch {
    /* ignora — já pode estar atribuído */
  }
  return { key: data.key, url: `${BASE}/browse/${data.key}` };
}

/** Reatribui uma issue existente para Ana (usada quando updates saem do Anora). */
export async function ensureAssignee(issueKey: string): Promise<void> {
  const accountId = await getAssigneeAccountId();
  if (!accountId) return;
  try {
    await jiraFetch(`/rest/api/3/issue/${issueKey}/assignee`, {
      method: "PUT",
      body: JSON.stringify({ accountId }),
    });
  } catch {
    /* silencioso — não bloqueia o update principal */
  }
}

/** Atualiza summary/duedate de uma issue existente e garante Ana como assignee. */
export async function updateIssue(
  issueKey: string,
  patch: { summary?: string; dueDate?: string | null },
): Promise<void> {
  const fields: Record<string, unknown> = {};
  if (patch.summary !== undefined) fields.summary = patch.summary;
  if (patch.dueDate !== undefined) fields.duedate = patch.dueDate;
  if (Object.keys(fields).length > 0) {
    await jiraFetch(`/rest/api/3/issue/${issueKey}`, {
      method: "PUT",
      body: JSON.stringify({ fields }),
    });
  }
  await ensureAssignee(issueKey);
}


export function mapPriority(name: string | null): "alta" | "media" | "baixa" {
  const n = (name ?? "").toLowerCase();
  if (n.includes("highest") || n === "high" || n.includes("alta")) return "alta";
  if (n.includes("low") || n.includes("baixa")) return "baixa";
  return "media";
}

export function mapStatus(category: JiraIssue["statusCategory"], name: string): "todo" | "doing" | "done" | "onhold" {
  const n = (name ?? "").toLowerCase();
  if (category === "done" || /done|conclu|resolv|finaliz/.test(n)) return "done";
  if (/review|revis|hold|paus|aguard/.test(n)) return "onhold";
  if (/progress|andamento|doing|working/.test(n)) return "doing";
  if (category === "new" || /to.?do|a fazer|backlog|open|novo/.test(n)) return "todo";
  return category === "indeterminate" ? "doing" : "todo";
}

