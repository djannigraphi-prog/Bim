CREATE TABLE "incident_photos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"incident_id" uuid NOT NULL,
	"uploaded_by_type" varchar(10) NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"storage_key" varchar(200) NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_photos_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "incident_photos_by_ck" CHECK ("incident_photos"."uploaded_by_type" IN ('customer', 'shop', 'courier'))
);
--> statement-breakpoint
ALTER TABLE "incident_photos" ADD CONSTRAINT "incident_photos_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_photos" ADD CONSTRAINT "incident_photos_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "incident_photos_incident_idx" ON "incident_photos" USING btree ("incident_id","created_at");