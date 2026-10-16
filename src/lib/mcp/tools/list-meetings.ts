import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_meetings",
  title: "List meetings",
  description: "List upcoming LUCK meetings and appointments within the next N days.",
  inputSchema: {
    days: z.number().int().min(1).max(60).optional().describe("Days ahead (default 7)."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ days }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const now = new Date();
    const end = new Date(now.getTime() + (days ?? 7) * 86400000);
    const { data, error } = await supabaseForUser(ctx)
      .from("meetings")
      .select("id, title, source, starts_at, ends_at, location, external_url, is_meeting")
      .eq("hidden", false)
      .gte("starts_at", now.toISOString())
      .lte("starts_at", end.toISOString())
      .order("starts_at")
      .limit(100);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const meetings = (data ?? []).map((m) => ({ ...m }));
    return { content: [{ type: "text", text: JSON.stringify(meetings) }], structuredContent: { meetings } };
  },
});
