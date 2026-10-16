import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listTasks from "./tools/list-tasks";
import createTask from "./tools/create-task";
import updateTaskStatus from "./tools/update-task-status";
import listMeetings from "./tools/list-meetings";

const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "luck",
  title: "luck",
  version: "0.1.0",
  instructions:
    "Tools for LUCK, a task and agenda hub for the companies Angi, Devore, Bruna (Brand.Pe) and Pessoal. List/create tasks, update task status, and list upcoming meetings.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listTasks, createTask, updateTaskStatus, listMeetings],
});
