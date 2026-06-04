CREATE TYPE "public"."action_ref_kind" AS ENUM('sha', 'tag', 'branch', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."diagnostic_severity" AS ENUM('critical', 'error', 'warning', 'info');--> statement-breakpoint
CREATE TYPE "public"."diagnostic_source" AS ENUM('parser', 'actionlint', 'semantic', 'policy', 'security');--> statement-breakpoint
CREATE TYPE "public"."execution_status" AS ENUM('queued', 'running', 'passed', 'failed', 'cancelled', 'skipped', 'timed_out');--> statement-breakpoint
CREATE TYPE "public"."oauth_provider" AS ENUM('github', 'gitlab', 'google');--> statement-breakpoint
CREATE TYPE "public"."run_mode" AS ENUM('static', 'local', 'github');--> statement-breakpoint
CREATE TYPE "public"."runner_status" AS ENUM('online', 'offline', 'busy', 'draining');--> statement-breakpoint
CREATE TYPE "public"."workspace_member_role" AS ENUM('owner', 'admin', 'editor', 'viewer');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "oauth_provider" NOT NULL,
	"provider_account_id" varchar(255) NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp with time zone,
	"scope" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" varchar(255) NOT NULL,
	"repo" varchar(255) NOT NULL,
	"subpath" varchar(1024),
	"description" text,
	"usage_count" integer,
	"is_verified" boolean DEFAULT false NOT NULL,
	"meta_json" jsonb,
	"last_indexed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"tag" varchar(255) NOT NULL,
	"sha" varchar(40) NOT NULL,
	"ref_kind" "action_ref_kind" DEFAULT 'tag' NOT NULL,
	"release_notes" text,
	"released_at" timestamp with time zone,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diagnostics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"finding_id" varchar(255) NOT NULL,
	"code" varchar(64) NOT NULL,
	"severity" "diagnostic_severity" NOT NULL,
	"source" "diagnostic_source" NOT NULL,
	"title" varchar(512) NOT NULL,
	"message" text NOT NULL,
	"path" varchar(1024) NOT NULL,
	"span_start_line" integer,
	"span_start_col" integer,
	"span_start_offset" integer,
	"span_end_line" integer,
	"span_end_col" integer,
	"span_end_offset" integer,
	"fix_json" jsonb,
	"docs_url" text
);
--> statement-breakpoint
CREATE TABLE "execution_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"job_key" varchar(255) NOT NULL,
	"name" varchar(512),
	"status" "execution_status" DEFAULT 'queued' NOT NULL,
	"runs_on_json" jsonb,
	"matrix_json" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"step_execution_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"stream" varchar(16) DEFAULT 'stdout' NOT NULL,
	"text" text NOT NULL,
	"logged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "execution_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"revision_id" uuid,
	"initiated_by" uuid,
	"runner_id" uuid,
	"mode" "run_mode" NOT NULL,
	"status" "execution_status" DEFAULT 'queued' NOT NULL,
	"github_run_id" integer,
	"trigger_event" varchar(128),
	"inputs_json" jsonb,
	"conclusion_json" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_execution_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"step_id" varchar(255),
	"name" varchar(512),
	"uses" varchar(512),
	"status" "execution_status" DEFAULT 'queued' NOT NULL,
	"exit_code" integer,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"github_installation_id" integer NOT NULL,
	"account_type" varchar(32) NOT NULL,
	"account_login" varchar(255) NOT NULL,
	"account_id" integer NOT NULL,
	"raw_json" jsonb,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"suspended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "policy_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"slug" varchar(128) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_id" uuid NOT NULL,
	"code" varchar(64) NOT NULL,
	"title" varchar(512) NOT NULL,
	"description" text,
	"severity" "diagnostic_severity" NOT NULL,
	"source" "diagnostic_source" NOT NULL,
	"applies_to" varchar(32) NOT NULL,
	"docs_url" text,
	"example_bad" text,
	"example_good" text,
	"evaluate_fn_source" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"github_repo_id" integer NOT NULL,
	"full_name" varchar(510) NOT NULL,
	"default_branch" varchar(255) DEFAULT 'main' NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"raw_json" jsonb,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repository_policy_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"pack_id" uuid NOT NULL,
	"block_merge_on_failure" boolean DEFAULT false NOT NULL,
	"blocking_severity" "diagnostic_severity" DEFAULT 'error',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runner_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"repository_id" uuid,
	"name" varchar(255) NOT NULL,
	"registration_token" varchar(255) NOT NULL,
	"status" "runner_status" DEFAULT 'offline' NOT NULL,
	"labels_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"agent_version" varchar(64),
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320),
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" varchar(255),
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"revision_id" uuid,
	"triggered_by" uuid,
	"count_error" integer DEFAULT 0 NOT NULL,
	"count_warning" integer DEFAULT 0 NOT NULL,
	"count_info" integer DEFAULT 0 NOT NULL,
	"security_score" integer,
	"security_grade" varchar(1),
	"security_factors_json" jsonb,
	"complexity_json" jsonb,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"yaml_source" text NOT NULL,
	"base_commit_sha" varchar(40),
	"is_dirty" boolean DEFAULT true NOT NULL,
	"history_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"path" varchar(1024) NOT NULL,
	"display_name" varchar(255),
	"tag" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_layouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"nodes_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"viewport_json" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"commit_sha" varchar(40) NOT NULL,
	"ref" varchar(255),
	"yaml_source" text NOT NULL,
	"ir_json" jsonb,
	"graph_json" jsonb,
	"author_login" varchar(255),
	"committed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"slug" varchar(128) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"category" varchar(128),
	"yaml_template" text NOT NULL,
	"variables_json" jsonb,
	"tags_json" jsonb,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "workspace_member_role" DEFAULT 'viewer' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"avatar_url" text,
	"billing_customer_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_versions" ADD CONSTRAINT "action_versions_source_id_action_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."action_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostics" ADD CONSTRAINT "diagnostics_run_id_validation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."validation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD CONSTRAINT "execution_jobs_run_id_execution_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."execution_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_logs" ADD CONSTRAINT "execution_logs_step_execution_id_execution_steps_id_fk" FOREIGN KEY ("step_execution_id") REFERENCES "public"."execution_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_runs" ADD CONSTRAINT "execution_runs_file_id_workflow_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."workflow_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_runs" ADD CONSTRAINT "execution_runs_revision_id_workflow_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."workflow_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_runs" ADD CONSTRAINT "execution_runs_initiated_by_users_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_runs" ADD CONSTRAINT "execution_runs_runner_id_runner_connections_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runner_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_steps" ADD CONSTRAINT "execution_steps_job_execution_id_execution_jobs_id_fk" FOREIGN KEY ("job_execution_id") REFERENCES "public"."execution_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_packs" ADD CONSTRAINT "policy_packs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_rules" ADD CONSTRAINT "policy_rules_pack_id_policy_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."policy_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_installation_id_github_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."github_installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_policy_settings" ADD CONSTRAINT "repository_policy_settings_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_policy_settings" ADD CONSTRAINT "repository_policy_settings_pack_id_policy_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."policy_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_connections" ADD CONSTRAINT "runner_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_connections" ADD CONSTRAINT "runner_connections_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_runs" ADD CONSTRAINT "validation_runs_file_id_workflow_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."workflow_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_runs" ADD CONSTRAINT "validation_runs_revision_id_workflow_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."workflow_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_runs" ADD CONSTRAINT "validation_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_drafts" ADD CONSTRAINT "workflow_drafts_file_id_workflow_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."workflow_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_drafts" ADD CONSTRAINT "workflow_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_files" ADD CONSTRAINT "workflow_files_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_layouts" ADD CONSTRAINT "workflow_layouts_file_id_workflow_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."workflow_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_layouts" ADD CONSTRAINT "workflow_layouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_revisions" ADD CONSTRAINT "workflow_revisions_file_id_workflow_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."workflow_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_idx" ON "accounts" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_sources_owner_repo_subpath_idx" ON "action_sources" USING btree ("owner","repo","subpath");--> statement-breakpoint
CREATE UNIQUE INDEX "action_versions_source_tag_idx" ON "action_versions" USING btree ("source_id","tag");--> statement-breakpoint
CREATE INDEX "action_versions_source_idx" ON "action_versions" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "diagnostics_run_idx" ON "diagnostics" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "diagnostics_code_idx" ON "diagnostics" USING btree ("code");--> statement-breakpoint
CREATE INDEX "diagnostics_severity_idx" ON "diagnostics" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "execution_jobs_run_idx" ON "execution_jobs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "execution_jobs_status_idx" ON "execution_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "execution_logs_step_idx" ON "execution_logs" USING btree ("step_execution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_logs_step_line_idx" ON "execution_logs" USING btree ("step_execution_id","line_number");--> statement-breakpoint
CREATE INDEX "execution_runs_file_idx" ON "execution_runs" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "execution_runs_status_idx" ON "execution_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "execution_steps_job_idx" ON "execution_steps" USING btree ("job_execution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_steps_job_index_idx" ON "execution_steps" USING btree ("job_execution_id","step_index");--> statement-breakpoint
CREATE UNIQUE INDEX "github_installations_github_id_idx" ON "github_installations" USING btree ("github_installation_id");--> statement-breakpoint
CREATE INDEX "github_installations_workspace_idx" ON "github_installations" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_packs_workspace_slug_idx" ON "policy_packs" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_rules_pack_code_idx" ON "policy_rules" USING btree ("pack_id","code");--> statement-breakpoint
CREATE INDEX "policy_rules_pack_idx" ON "policy_rules" USING btree ("pack_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repositories_github_repo_id_idx" ON "repositories" USING btree ("github_repo_id");--> statement-breakpoint
CREATE INDEX "repositories_workspace_idx" ON "repositories" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repo_policy_settings_repo_pack_idx" ON "repository_policy_settings" USING btree ("repository_id","pack_id");--> statement-breakpoint
CREATE INDEX "repo_policy_settings_repo_idx" ON "repository_policy_settings" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runner_connections_token_idx" ON "runner_connections" USING btree ("registration_token");--> statement-breakpoint
CREATE INDEX "runner_connections_workspace_idx" ON "runner_connections" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "validation_runs_file_idx" ON "validation_runs" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "validation_runs_revision_idx" ON "validation_runs" USING btree ("revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_drafts_file_user_idx" ON "workflow_drafts" USING btree ("file_id","user_id");--> statement-breakpoint
CREATE INDEX "workflow_drafts_user_idx" ON "workflow_drafts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_files_repo_path_idx" ON "workflow_files" USING btree ("repository_id","path");--> statement-breakpoint
CREATE INDEX "workflow_files_repo_idx" ON "workflow_files" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_layouts_file_user_idx" ON "workflow_layouts" USING btree ("file_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_revisions_file_commit_idx" ON "workflow_revisions" USING btree ("file_id","commit_sha");--> statement-breakpoint
CREATE INDEX "workflow_revisions_file_idx" ON "workflow_revisions" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_templates_workspace_slug_idx" ON "workflow_templates" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX "workflow_templates_category_idx" ON "workflow_templates" USING btree ("category");--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_slug_idx" ON "workspaces" USING btree ("slug");