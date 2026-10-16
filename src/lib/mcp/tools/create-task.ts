import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "create_task",
  title: "Create task",
  description: "Create a new LUCK task for a company.",
  inputSchema: {
    title: z.string().min(1).describe("Task title."),
    source: z.enum(["angi", "devore", "bruna", "pessoal"]).describe("Company."),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Due date YYYY-MM-DD."),
    due_time: z.string().regex(/^\d{2}:\d{2}$/).optional().describe("Due time HH:MM."),
    priority: z.enum(["alta", "media", "baixa"]).optional(),
    notes: z.string().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const { data, error } = await supabaseForUser(ctx)
      .from("tasks")
      .insert({
        title: input.title,
        source: input.source,
        due_date: input.due_date ?? null,
        start_date: input.due_date ?? null,
        due_time: input.due_time ?? null,
        priority: input.priority ?? "media",
        notes: input.notes ?? null,
        created_by: ctx.getUserId(),
        locally_managed: true,
      })
      .select("id, title, source, due_date, due_time")
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return { content: [{ type: "text", text: `Created task ${data.id}` }], structuredContent: { task: { ...data } } };
  },
});
