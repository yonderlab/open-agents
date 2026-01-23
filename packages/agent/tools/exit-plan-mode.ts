import { tool } from "ai";
import { z } from "zod";
import { getAgentContext } from "./utils";

const exitPlanModeInputSchema = z.object({
  allowedPrompts: z
    .array(
      z.object({
        tool: z.literal("bash"),
        prompt: z
          .string()
          .describe(
            'Semantic description of the action, e.g. "run tests", "install dependencies"',
          ),
      }),
    )
    .optional()
    .describe("Prompt-based permissions needed to implement the plan"),
});

export type ExitPlanModeInput = z.infer<typeof exitPlanModeInputSchema>;

export const exitPlanModeTool = () =>
  tool({
    needsApproval: true,
    description: `Exit plan mode and request user approval to proceed with implementation.

WHEN TO USE:
- When your plan is complete and ready for user review
- After you have explored the codebase and documented your approach in the plan file

WHAT HAPPENS:
- The plan file content is returned for user review
- User must approve before you can proceed
- After approval, tools are restored to full access
- The allowedPrompts parameter can pre-authorize certain bash commands

IMPORTANT:
- Make sure your plan is complete before calling this tool
- The user will see your plan and decide whether to proceed
- If the user rejects the plan, you will remain in plan mode to revise it`,
    inputSchema: exitPlanModeInputSchema,
    execute: async ({ allowedPrompts }, { experimental_context }) => {
      const { sandbox, planFilePath } = getAgentContext(
        experimental_context,
        "exit_plan_mode",
      );

      if (!planFilePath) {
        return {
          success: false,
          error: "No plan file path found. Are you in plan mode?",
          plan: null,
          planFilePath: null,
        };
      }

      // Try to read the plan file
      let plan: string | null = null;
      try {
        plan = await sandbox.readFile(planFilePath, "utf-8");
      } catch {
        // Plan file may not exist yet
        plan = null;
      }

      return {
        success: true,
        message: "Requesting approval to exit plan mode and proceed.",
        plan,
        planFilePath,
        allowedPrompts: allowedPrompts ?? [],
      };
    },
  });

// TODO: use ai sdk type helpers to derive from tool definition
export type ExitPlanModeOutput = {
  success: boolean;
  message?: string;
  error?: string;
  plan: string | null;
  planFilePath: string | null;
  allowedPrompts?: ExitPlanModeInput["allowedPrompts"];
};
