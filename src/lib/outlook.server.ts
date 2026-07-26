/**
 * Server-only Outlook/Hotmail access through Lovable connector gateway.
 * Uses the MICROSOFT_OUTLOOK connector linked to the workspace.
 */

const GATEWAY = "https://connector-gateway.lovable.dev/microsoft_outlook";

function headers() {
  const apiKey = process.env.LOVABLE_API_KEY;
  const connKey = process.env.MICROSOFT_OUTLOOK_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY não configurada.");
  if (!connKey) throw new Error("Conector Outlook não ligado.");
  return {
    Authorization: `Bearer ${apiKey}`,
    "X-Connection-Api-Key": connKey,
    "Content-Type": "application/json",
  };
}

export type OutlookPreview = {
  id: string;
  from: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
  link: string;
};

export async function fetchRecentOutlookInbox(limit = 40): Promise<OutlookPreview[]> {
  // Last 3 days, inbox, newest first
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const filter = encodeURIComponent(`receivedDateTime ge ${since}`);
  const select = encodeURIComponent(
    "id,subject,bodyPreview,from,receivedDateTime,isRead,webLink",
  );
  const url =
    `${GATEWAY}/me/mailFolders/inbox/messages` +
    `?$top=${limit}&$orderby=receivedDateTime desc&$filter=${filter}&$select=${select}`;

  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Outlook list falhou [${res.status}]: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    value?: Array<{
      id: string;
      subject?: string;
      bodyPreview?: string;
      from?: { emailAddress?: { name?: string; address?: string } };
      receivedDateTime?: string;
      isRead?: boolean;
      webLink?: string;
    }>;
  };
  return (json.value ?? []).map((m) => {
    const name = m.from?.emailAddress?.name?.trim() || "";
    const email = (m.from?.emailAddress?.address ?? "").toLowerCase();
    return {
      id: m.id,
      from: name || email,
      fromEmail: email,
      subject: m.subject || "(sem assunto)",
      snippet: (m.bodyPreview ?? "").slice(0, 240),
      date: m.receivedDateTime ?? "",
      unread: m.isRead === false,
      link: m.webLink || "https://outlook.live.com/mail/0/inbox",
    } satisfies OutlookPreview;
  });
}
