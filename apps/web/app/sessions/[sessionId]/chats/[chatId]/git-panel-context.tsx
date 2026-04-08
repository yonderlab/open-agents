"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  useMemo,
  type ReactNode,
} from "react";

export type GitPanelTab = "code" | "diff" | "checks";
export type ActiveView = "chat" | "diff";

type GitPanelContextValue = {
  /** Whether the right git panel is open */
  gitPanelOpen: boolean;
  setGitPanelOpen: (open: boolean) => void;
  toggleGitPanel: () => void;

  /** Active tab within the git panel */
  gitPanelTab: GitPanelTab;
  setGitPanelTab: (tab: GitPanelTab) => void;

  /** Active view in the main content area (chat messages vs diff) */
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;

  /** File path to scroll to in the diff tab view */
  focusedDiffFile: string | null;
  setFocusedDiffFile: (file: string | null) => void;

  /** Open the diff tab in the main content area, optionally focused on a file */
  openDiffToFile: (filePath: string) => void;
};

const GitPanelContext = createContext<GitPanelContextValue | undefined>(
  undefined,
);

export function GitPanelProvider({ children }: { children: ReactNode }) {
  const [gitPanelOpen, setGitPanelOpen] = useState(false);
  const [gitPanelTab, setGitPanelTab] = useState<GitPanelTab>("code");
  const [activeView, setActiveView] = useState<ActiveView>("chat");
  const [focusedDiffFile, setFocusedDiffFile] = useState<string | null>(null);

  const toggleGitPanel = useCallback(() => {
    setGitPanelOpen((prev) => !prev);
  }, []);

  const openDiffToFile = useCallback((filePath: string) => {
    setFocusedDiffFile(filePath);
    setActiveView("diff");
  }, []);

  const value = useMemo(
    () => ({
      gitPanelOpen,
      setGitPanelOpen,
      toggleGitPanel,
      gitPanelTab,
      setGitPanelTab,
      activeView,
      setActiveView,
      focusedDiffFile,
      setFocusedDiffFile,
      openDiffToFile,
    }),
    [gitPanelOpen, toggleGitPanel, gitPanelTab, activeView, focusedDiffFile, openDiffToFile],
  );

  return (
    <GitPanelContext.Provider value={value}>
      {children}
    </GitPanelContext.Provider>
  );
}

export function useGitPanel() {
  const context = useContext(GitPanelContext);
  if (!context) {
    throw new Error("useGitPanel must be used within a GitPanelProvider");
  }
  return context;
}
