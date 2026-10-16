import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_tasks",
  title: "List tasks",
  description: "List LUCK tasks, optionally filtered by company and status.",
  inputSchema: {
    source: z.enum(["angi", "devore", "bruna", "pessoal"]).optional().describe("Company filter."),
    status: z.enum(["todo", "doing", "onhold", "done"]).optional().describe("Status filter."),
    limit: z.number().int().min(1).max(200).optional().describe("Max rows (default 50)."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ source, status, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    let q = supabaseForUser(ctx)
      .from("tasks")
      .select("id, title, source, status, priority, due_date, due_time, notes")
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(limit ?? 50);
    if (source) q = q.eq("source", source);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const tasks = (data ?? []).map((t) => ({ ...t }));
    return { content: [{ type: "text", text: JSON.stringify(tasks) }], structuredContent: { tasks } };
  },
});
