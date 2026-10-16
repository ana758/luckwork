import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "update_task_status",
  title: "Update task status",
  description: "Change the status of a LUCK task (e.g. mark it done).",
  inputSchema: {
    id: z.string().uuid().describe("Task id."),
    status: z.enum(["todo", "doing", "onhold", "done"]),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ id, status }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const now = new Date().toISOString();
    const { data, error } = await supabaseForUser(ctx)
      .from("tasks")
      .update({ status, status_changed_at: now, completed_at: status === "done" ? now : null })
      .eq("id", id)
      .select("id, title, status")
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) return { content: [{ type: "text", text: "Task not found" }], isError: true };
    return { content: [{ type: "text", text: `${data.title}: ${data.status}` }], structuredContent: { task: { ...data } } };
  },
});
