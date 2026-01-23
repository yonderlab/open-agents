import { tool } from "ai";
import { z } from "zod";
import * as path from "path";
import { getSandbox } from "./utils";

// TODO: if anthropic bug still exists, add empty item here
const enterPlanModeInputSchema = z.object({});

export const enterPlanModeTool = () =>
  tool({
    needsApproval: true,
    description: `Enter plan mode to explore and design an implementation approach before making changes.

WHEN TO USE:
- Before starting non-trivial implementation tasks
- When you need to understand the codebase structure first
- When the user requests a plan or design before implementation
- When multiple approaches are possible and you need to explore options

WHAT HAPPENS:
- Tools are restricted to read-only operations (read, grep, glob, bash read-only commands)
- You can write ONLY to a plan file (.plan.md in the working directory)
- You can delegate to explorer subagents only (not executor)
- System prompt is updated with plan mode instructions

HOW TO EXIT:
- Call exit_plan_mode when your plan is complete
- User will review and approve the plan before you can proceed with implementation`,
    inputSchema: enterPlanModeInputSchema,
    execute: async (_args, { experimental_context }) => {
      const sandbox = getSandbox(experimental_context, "enter_plan_mode");
      const planFilePath = path.join(sandbox.workingDirectory, ".plan.md");

      return {
        success: true,
        message:
          "Entered plan mode. You can now explore the codebase and write your plan.",
        planFilePath,
      };
    },
  });

// TODO: replace with AI SDK type helper to derive type from tool definition
export type EnterPlanModeOutput = {
  success: boolean;
  message: string;
  planFilePath: string;
};
