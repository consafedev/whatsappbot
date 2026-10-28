CREATE TYPE "appointment_booking_outbound_purpose" AS ENUM ('PROMPT', 'ACK');

ALTER TABLE "appointment_booking_turns"
  ADD COLUMN "outbound_purpose" "appointment_booking_outbound_purpose",
  ADD COLUMN "outbound_flow_phase" "appointment_booking_flow_phase",
  ADD COLUMN "outbound_flow_version" INTEGER;

ALTER TABLE "appointment_booking_turns"
  ADD CONSTRAINT "appointment_booking_turns_outbound_effect_check" CHECK (
    ("outbound_purpose" IS NULL AND "outbound_flow_phase" IS NULL AND "outbound_flow_version" IS NULL)
    OR (
      "outbound_message_id" IS NOT NULL
      AND "flow_id" IS NOT NULL
      AND "outbound_purpose" IS NOT NULL
      AND "outbound_flow_phase" IS NOT NULL
      AND "outbound_flow_version" IS NOT NULL
      AND "outbound_flow_version" >= 1
      AND (
        (
          "outbound_purpose" = 'PROMPT'
          AND "outbound_flow_phase" IN (
            'SELECT_SERVICE', 'SELECT_RESOURCE', 'SELECT_SLOT', 'SELECT_APPOINTMENT',
            'CONFIRM_BOOKING', 'CONFIRM_CANCELLATION', 'CONFIRM_REBOOKING'
          )
        )
        OR (
          "outbound_purpose" = 'ACK'
          AND (
            ("outbound_flow_phase" = 'COMPLETED' AND "appointment_id" IS NOT NULL)
            OR ("outbound_flow_phase" = 'CANCELLED' AND "appointment_id" IS NULL)
          )
        )
      )
    )
  );
