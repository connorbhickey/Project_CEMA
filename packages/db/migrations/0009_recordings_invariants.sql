DROP INDEX "recordings_communication_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "recordings_communication_id_uidx" ON "recordings" USING btree ("communication_id");--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_recording_bytes_nonneg" CHECK ("recordings"."recording_bytes" IS NULL OR "recordings"."recording_bytes" >= 0);--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_recording_duration_nonneg" CHECK ("recordings"."recording_duration_seconds" IS NULL OR "recordings"."recording_duration_seconds" >= 0);--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_transcript_words_nonneg" CHECK ("recordings"."transcript_words_count" IS NULL OR "recordings"."transcript_words_count" >= 0);