/**
 * Server-only Jira API client. Autentica com JIRA_EMAIL + JIRA_API_TOKEN
 * (Atlassian API token) e conversa com https://angisaude.atlassian.net.
 *
 * Escopo: apenas o projeto "Angi | Commercial & Marketing" (key = TASK),
 * apenas issues atribuídas ao usuário autenticado (currentUser()).
 */

const BASE = "https://angisaude.atlassian.net";
const PROJECT_KEY = "TASK";

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
  const transitions = await getTransitions(issueKey);
  const done =
    transitions.find((t) => t.toCategory === "done") ??
    transitions.find((t) => /done|conclu|resolv|finaliz/i.test(t.name));
  if (!done) return false;
  await jiraFetch(`/rest/api/3/issue/${issueKey}/transitions`, {
    method: "POST",
    body: JSON.stringify({ transition: { id: done.id } }),
  });
  return true;
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

