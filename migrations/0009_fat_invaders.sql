CREATE TABLE "application_packets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"job_id" text NOT NULL,
	"stage" text DEFAULT 'added' NOT NULL,
	"generation_status" text DEFAULT 'not_started' NOT NULL,
	"generation_error" text,
	"tailored_resume_text" text,
	"cover_letter_text" text,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_hash" text DEFAULT '' NOT NULL,
	"generated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_packets_user_id_job_id_unique" UNIQUE("user_id","job_id")
);
--> statement-breakpoint
ALTER TABLE "candidate_profiles" ADD COLUMN "matches_last_viewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "application_packets" ADD CONSTRAINT "application_packets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_packets" ADD CONSTRAINT "application_packets_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_application_packets_user_stage" ON "application_packets" USING btree ("user_id","stage");