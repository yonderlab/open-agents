ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "auto_commit_push" boolean;--> statement-breakpoint
ALTER TABLE "user_preferences" ALTER COLUMN "auto_commit_push" SET DEFAULT false;--> statement-breakpoint
UPDATE "user_preferences"
SET "auto_commit_push" = false
WHERE "auto_commit_push" IS NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ALTER COLUMN "auto_commit_push" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "default_diff_mode" text;--> statement-breakpoint
ALTER TABLE "user_preferences" ALTER COLUMN "default_diff_mode" SET DEFAULT 'unified';--> statement-breakpoint
UPDATE "user_preferences"
SET "default_diff_mode" = 'unified'
WHERE "default_diff_mode" IS NULL;