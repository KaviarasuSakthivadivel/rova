ALTER TABLE "jobs" ALTER COLUMN "embedding" SET DATA TYPE vector(768);--> statement-breakpoint
ALTER TABLE "candidate_profiles" ALTER COLUMN "embedding" SET DATA TYPE vector(768);