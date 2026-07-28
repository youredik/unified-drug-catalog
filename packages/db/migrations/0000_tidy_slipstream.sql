CREATE SCHEMA "audit";
--> statement-breakpoint
CREATE SCHEMA "bronze";
--> statement-breakpoint
CREATE SCHEMA "gold";
--> statement-breakpoint
CREATE SCHEMA "silver";
--> statement-breakpoint
CREATE TABLE "gold"."catalog_item" (
	"run_id" text NOT NULL,
	"id" text NOT NULL,
	"doc" jsonb NOT NULL,
	"trade_name" text NOT NULL,
	"brand_core" text NOT NULL,
	"manufacturer" text NOT NULL,
	"gtin" text,
	"gtin_valid" boolean NOT NULL,
	CONSTRAINT "catalog_item_run_id_id_pk" PRIMARY KEY("run_id","id")
);
--> statement-breakpoint
CREATE TABLE "gold"."catalog_item_source" (
	"run_id" text NOT NULL,
	"item_id" text NOT NULL,
	"source_record_id" text NOT NULL,
	"source_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit"."match_decision" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit"."match_decision_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"run_id" text NOT NULL,
	"left_id" text NOT NULL,
	"right_id" text NOT NULL,
	"total_weight" double precision NOT NULL,
	"probability" double precision NOT NULL,
	"zone" text NOT NULL,
	"decided_by" text NOT NULL,
	"weights" jsonb NOT NULL,
	"adjudication" jsonb,
	"conflict" text
);
--> statement-breakpoint
CREATE TABLE "silver"."normalized_record" (
	"run_id" text NOT NULL,
	"id" text NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"doc" jsonb NOT NULL,
	"brand_key" text NOT NULL,
	"gtin" text,
	"gtin_valid" boolean NOT NULL,
	"ruleset_version" text NOT NULL,
	CONSTRAINT "normalized_record_run_id_id_pk" PRIMARY KEY("run_id","id")
);
--> statement-breakpoint
CREATE TABLE "bronze"."outbox" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bronze"."outbox_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"run_id" text NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bronze"."pipeline_run" (
	"id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"ruleset_version" text NOT NULL,
	"adjudicator" text NOT NULL,
	"summary" jsonb
);
--> statement-breakpoint
CREATE TABLE "silver"."quarantine" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "silver"."quarantine_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"run_id" text NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text,
	"reason" jsonb NOT NULL,
	"raw_excerpt" text NOT NULL,
	"quarantined_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bronze"."source" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contract_version" text NOT NULL,
	"format" text NOT NULL,
	"date_format" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bronze"."source_record" (
	"run_id" text NOT NULL,
	"id" text NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"ingested_at" timestamp with time zone NOT NULL,
	"source_contract_version" text NOT NULL,
	CONSTRAINT "source_record_run_id_id_pk" PRIMARY KEY("run_id","id")
);
--> statement-breakpoint
ALTER TABLE "gold"."catalog_item" ADD CONSTRAINT "catalog_item_run_id_pipeline_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "bronze"."pipeline_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold"."catalog_item_source" ADD CONSTRAINT "catalog_item_source_run_id_pipeline_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "bronze"."pipeline_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit"."match_decision" ADD CONSTRAINT "match_decision_run_id_pipeline_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "bronze"."pipeline_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "silver"."normalized_record" ADD CONSTRAINT "normalized_record_run_id_pipeline_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "bronze"."pipeline_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "silver"."quarantine" ADD CONSTRAINT "quarantine_run_id_pipeline_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "bronze"."pipeline_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bronze"."source_record" ADD CONSTRAINT "source_record_run_id_pipeline_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "bronze"."pipeline_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_item_brand_trgm_idx" ON "gold"."catalog_item" USING gin ("brand_core" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_item_source_uq" ON "gold"."catalog_item_source" USING btree ("run_id","item_id","source_record_id");--> statement-breakpoint
CREATE INDEX "catalog_item_source_record_idx" ON "gold"."catalog_item_source" USING btree ("run_id","source_record_id");--> statement-breakpoint
CREATE INDEX "match_decision_run_idx" ON "audit"."match_decision" USING btree ("run_id","zone");--> statement-breakpoint
CREATE INDEX "match_decision_left_idx" ON "audit"."match_decision" USING btree ("run_id","left_id");--> statement-breakpoint
CREATE INDEX "normalized_gtin_idx" ON "silver"."normalized_record" USING btree ("gtin");--> statement-breakpoint
CREATE INDEX "normalized_brand_trgm_idx" ON "silver"."normalized_record" USING gin ("brand_key" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "bronze"."outbox" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "source_record_hash_idx" ON "bronze"."source_record" USING btree ("content_hash");