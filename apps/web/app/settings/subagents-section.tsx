"use client";

import { useMemo, useState } from "react";
import type { CustomSubagentProfile } from "@open-harness/agent/subagents/profiles";
import { useModelOptions } from "@/hooks/use-model-options";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import {
  getDefaultModelOptionId,
  withMissingModelOption,
} from "@/lib/model-options";
import { ModelCombobox } from "@/components/model-combobox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { SubagentProfilesSection } from "./subagent-profiles-section";

export function SubagentsSectionSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Subagents</CardTitle>
        <CardDescription>
          Configure the built-in Explore subagent and any custom delegated
          specialists.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-2">
          <Label htmlFor="subagent-model">Subagent Model</Label>
          <div className="w-full max-w-xs rounded-md border px-3 py-2">
            <Skeleton className="h-4 w-32" />
          </div>
          <p className="text-xs text-muted-foreground">
            The default model used for the built-in Explore subagent.
          </p>
        </div>

        <Separator />

        <div className="grid gap-3">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-10 w-36" />
        </div>
      </CardContent>
    </Card>
  );
}

export function SubagentsSection() {
  const { preferences, loading, updatePreferences } = useUserPreferences();
  const { modelOptions, loading: modelOptionsLoading } = useModelOptions();
  const [isSaving, setIsSaving] = useState(false);

  const selectedDefaultModelId =
    preferences?.defaultModelId ?? getDefaultModelOptionId(modelOptions);
  const selectedSubagentModelId = preferences?.defaultSubagentModelId ?? "auto";

  const subagentModelOptions = useMemo(
    () =>
      withMissingModelOption(modelOptions, preferences?.defaultSubagentModelId),
    [modelOptions, preferences?.defaultSubagentModelId],
  );

  const handleSubagentModelChange = async (value: string) => {
    setIsSaving(true);
    try {
      await updatePreferences({
        defaultSubagentModelId: value === "auto" ? null : value,
      });
    } catch (error) {
      console.error("Failed to update subagent model preference:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubagentProfilesSave = async (
    subagentProfiles: CustomSubagentProfile[],
  ) => {
    setIsSaving(true);
    try {
      await updatePreferences({ subagentProfiles });
    } catch (error) {
      console.error("Failed to update subagent profiles:", error);
      throw error;
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return <SubagentsSectionSkeleton />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Subagents</CardTitle>
        <CardDescription>
          Configure the built-in Explore subagent and define custom subagents
          for delegated tasks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-2.5">
          <Label htmlFor="subagent-model">Subagent Model</Label>
          <ModelCombobox
            value={selectedSubagentModelId}
            items={[
              { id: "auto", label: "Same as main model" },
              ...subagentModelOptions.map((option) => ({
                id: option.id,
                label: option.label,
                description: option.description,
                isVariant: option.isVariant,
              })),
            ]}
            placeholder="Select a model"
            searchPlaceholder="Search models..."
            emptyText={modelOptionsLoading ? "Loading..." : "No models found."}
            disabled={isSaving || modelOptionsLoading}
            onChange={handleSubagentModelChange}
          />
          <p className="text-xs text-muted-foreground">
            Controls Explore by default, and pre-fills the model for any newly
            created custom subagents.
          </p>
        </div>

        <Separator />

        <SubagentProfilesSection
          profiles={preferences?.subagentProfiles ?? []}
          modelItems={subagentModelOptions.map((option) => ({
            id: option.id,
            label: option.label,
            description: option.description,
            isVariant: option.isVariant,
          }))}
          defaultModelId={
            preferences?.defaultSubagentModelId ?? selectedDefaultModelId
          }
          disabled={isSaving || modelOptionsLoading}
          onSave={handleSubagentProfilesSave}
        />
      </CardContent>
    </Card>
  );
}
