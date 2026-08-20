-- Keep the physical FK name aligned with Prisma's tenant-aware relation name.
ALTER TABLE "message"
  RENAME CONSTRAINT "message_tenant_outbound_message_fkey"
  TO "message_tenant_id_outbound_message_id_fkey";
