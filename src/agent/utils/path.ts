import * as path from "path";
import type { AgentContext, AgentMode } from "../types";
import type { Sandbox } from "../sandbox";

/**
 * Check if a file path is within a given directory.
 * Used as a security boundary to prevent path traversal attacks.
 *
 * @param filePath - The path to check
 * @param directory - The directory that should contain the path
 * @returns true if filePath is within or equal to directory
 */
export function isPathWithinDirectory(
  filePath: string,
  directory: string
): boolean {
  const resolvedPath = path.resolve(filePath);
  const resolvedDir = path.resolve(directory);
  return (
    resolvedPath.startsWith(resolvedDir + path.sep) ||
    resolvedPath === resolvedDir
  );
}

/**
 * Get sandbox from experimental context with null safety.
 * Throws a descriptive error if sandbox is not initialized.
 *
 * @param experimental_context - The context passed to tool execute functions
 * @returns The sandbox instance
 * @throws Error if sandbox is not available in context
 */
export function getSandbox(experimental_context: unknown): Sandbox {
  const context = experimental_context as AgentContext | undefined;
  if (!context?.sandbox) {
    throw new Error(
      "Sandbox not initialized in context. Ensure the agent is configured with a sandbox."
    );
  }
  return context.sandbox;
}

/**
 * Get agent mode from experimental context.
 * Defaults to 'interactive' if not set (backward compatibility).
 *
 * @param experimental_context - The context passed to tool execute functions
 * @returns The agent mode ('interactive' or 'background')
 */
export function getMode(experimental_context: unknown): AgentMode {
  const context = experimental_context as AgentContext | undefined;
  return context?.mode ?? "interactive";
}

/**
 * Check if the agent is running in background mode.
 * Useful for conditional logic in tools.
 *
 * @param experimental_context - The context passed to tool execute functions
 * @returns true if running in background mode
 */
export function isBackgroundMode(experimental_context: unknown): boolean {
  return getMode(experimental_context) === "background";
}
