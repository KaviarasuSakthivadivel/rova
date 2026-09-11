CREATE TABLE "job_rankings" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"job_id" text NOT NULL,
	"job_content_hash" text NOT NULL,
	"score" integer NOT NULL,
	"strong_matches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_rankings_profile_id_job_id_unique" UNIQUE("profile_id","job_id")
);
--> statement-breakpoint
ALTER TABLE "job_rankings" ADD CONSTRAINT "job_rankings_profile_id_candidate_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."candidate_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_rankings" ADD CONSTRAINT "job_rankings_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;