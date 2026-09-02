import {
  AiResilientRouter,
  type AiMessage,
  type RagCitation,
  buildRagContextPrompt,
  createEmbeddingProvider,
  injectRagContextIntoMessages,
} from "@whatsapp-platform/ai-gateway";
import { getTenantAiAgentConfig } from "./ai-agent-config-manager";
import { recordAiUsage, resolveProviderAndKey } from "./ai-gateway-manager";
import { resolveRoutesForAlias } from "./ai-routing-manager";
import type { PrismaClient } from "./generated/prisma/client";
import { searchKnowledgeChunks } from "./knowledge-search-manager";
import { createOutboundConversationMessageManager } from "./outbound-conversation-message-manager";
import { createTenantContext } from "./tenant-context";
import { assertTenantModuleEntitled } from "./tenant-entitlements";
import { assertTenantOperational } from "./tenant-operational";

export type AiAgentDispatcherDatabase = PrismaClient;

export interface ProcessAiTurnParams {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly channelAccountId: string;
  readonly contactId: string;
  readonly inboundMessageId?: string | undefined;
  readonly inboundText: string;
  readonly encryptionSecret: string | Uint8Array;
}

export type AiTurnResult =
  | {
      readonly handled: false;
      readonly reason:
        | "disabled"
        | "rules_only"
        | "human_takeover"
        | "not_operational"
        | "missing_entitlement"
        | "empty_input";
    }
  | {
      readonly handled: true;
      readonly action: "human_handoff";
      readonly noticeSent: boolean;
    }
  | {
      readonly handled: true;
      readonly action: "ai_reply";
      readonly replyText: string;
      readonly citations: readonly RagCitation[];
      readonly modelUsed: string;
      readonly providerUsed: string;
      readonly totalTokens: number;
    };

/**
 * Autonomous WhatsApp AI Agent turn processor.
 * Evaluates inbound turn, checks human takeover coexistence, detects human handoff triggers,
 * retrieves relevant knowledge chunks via RAG, formats prompt with citations, and sends reply.
 */
export async function processInboundAiTurn(
  db: AiAgentDispatcherDatabase,
  params: ProcessAiTurnParams,
): Promise<AiTurnResult> {
  const tenantContext = createTenantContext(params.tenantId);

  // 1. Guard operational status and module entitlement
  try {
    await assertTenantOperational(tenantContext, db);
    await assertTenantModuleEntitled(tenantContext, "module.ai", db);
  } catch {
    return { handled: false, reason: "missing_entitlement" };
  }

  // 2. Fetch AI agent configuration
  const config = await getTenantAiAgentConfig(db, params.tenantId);
  if (!config.isEnabled) {
    return { handled: false, reason: "disabled" };
  }
  if (config.automationMode === "RULES_ONLY") {
    return { handled: false, reason: "rules_only" };
  }

  const trimmedInput = params.inboundText?.trim();
  if (!trimmedInput) {
    return { handled: false, reason: "empty_input" };
  }

  // 3. Verify conversation human takeover status
  const conversation = await db.conversation.findUnique({
    where: { tenantId_id: { tenantId: params.tenantId, id: params.conversationId } },
    select: {
      id: true,
      status: true,
      automationMode: true,
      humanTakeoverUntil: true,
      metadata: true,
    },
  });

  if (!conversation) {
    return { handled: false, reason: "disabled" };
  }

  const isTakeoverActive =
    conversation.status === "TAKEOVER" ||
    conversation.automationMode === "HUMAN" ||
    (conversation.humanTakeoverUntil !== null && conversation.humanTakeoverUntil > new Date());

  if (isTakeoverActive) {
    return { handled: false, reason: "human_takeover" };
  }

  // 4. Human Handoff Detection
  const lowerText = trimmedInput.toLowerCase();
  const isHandoff = config.humanHandoffKeywords.some((keyword) =>
    lowerText.includes(keyword.toLowerCase().trim()),
  );

  if (isHandoff) {
    const currentMeta =
      conversation.metadata &&
      typeof conversation.metadata === "object" &&
      !Array.isArray(conversation.metadata)
        ? (conversation.metadata as Record<string, unknown>)
        : {};

    await db.conversation.update({
      where: { tenantId_id: { tenantId: params.tenantId, id: params.conversationId } },
      data: {
        automationMode: "HUMAN",
        metadata: {
          ...currentMeta,
          automationPausedAt: new Date().toISOString(),
          automationPausedReason: "human_handoff_requested",
        },
        updatedAt: new Date(),
      },
    });

    await db.domainEventOutbox.create({
      data: {
        tenantId: params.tenantId,
        aggregateType: "conversation",
        aggregateId: params.conversationId,
        eventType: "conversation.takeover_requested",
        payload: {
          conversationId: params.conversationId,
          contactId: params.contactId,
          channelAccountId: params.channelAccountId,
          reason: "human_handoff_requested",
          requestedAt: new Date().toISOString(),
        },
      },
    });

    const handoffNotice =
      "Te transferiré con un asesor humano en un momento. Por favor espera en línea.";
    const outboundManager = createOutboundConversationMessageManager(db);
    const sentNotice = await outboundManager.sendConversationMessage(
      tenantContext,
      params.conversationId,
      {
        actorUserId: null,
        messageType: "text",
        content: { text: handoffNotice },
        idempotencyKey: `handoff-notice-${params.conversationId}-${Date.now()}`,
        requestId: `ai-handoff-${params.conversationId}`,
      },
    );

    await db.$transaction([
      db.message.update({
        where: { id: sentNotice.message.id },
        data: {
          actorType: "AI_BOT",
          metadata: { senderType: "AI_BOT", handoff: true },
        },
      }),
    ]);

    return { handled: true, action: "human_handoff", noticeSent: true };
  }

  // 5. RAG Retrieval — resolve embedding provider from tenant config
  const resolvedProvider = await resolveProviderAndKey(db, {
    tenantId: params.tenantId,
    encryptionSecret: params.encryptionSecret,
  });
  const embeddingType = resolvedProvider?.config.providerType ?? "mock";
  const embeddingApiKey = resolvedProvider?.decryptedApiKey ?? "mock-key";
  const embeddingProvider = createEmbeddingProvider(embeddingType);
  const embeddingRes = await embeddingProvider.generateEmbeddings(
    { input: trimmedInput },
    { apiKey: embeddingApiKey },
  );
  const queryEmbedding = embeddingRes.embeddings[0] ?? [];
  const embeddingTokens = embeddingRes.totalTokens;

  let citations: RagCitation[] = [];
  if (queryEmbedding.length > 0) {
    citations = await searchKnowledgeChunks(db, {
      tenantId: params.tenantId,
      queryEmbedding,
      topK: 3,
      minScore: config.minConfidenceScore,
    });
  }

  const ragContext = buildRagContextPrompt(citations);

  // 6. Assemble Conversation Messages
  const recentHistory = await db.message.findMany({
    where: { tenantId: params.tenantId, conversationId: params.conversationId },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: { direction: true, textBody: true },
  });

  const conversationHistory: AiMessage[] = recentHistory
    .reverse()
    .filter((m) => Boolean(m.textBody))
    .map((m) => ({
      role: m.direction === "inbound" ? ("user" as const) : ("assistant" as const),
      content: m.textBody ?? "",
    }));

  const baseDirectives = config.systemDirectives?.trim()
    ? config.systemDirectives.trim()
    : "Eres un asistente virtual de atención al cliente servicial, profesional y conciso.";

  const initialMessages: AiMessage[] = [
    { role: "system", content: baseDirectives },
    ...conversationHistory,
  ];

  const enrichedMessages = injectRagContextIntoMessages(initialMessages, ragContext);

  // 7. Route and Execute Completion
  const resolvedAlias = await resolveRoutesForAlias(db, {
    tenantId: params.tenantId,
    aliasKey: config.virtualAliasKey,
    encryptionSecret: params.encryptionSecret,
  });

  if (!resolvedAlias || resolvedAlias.routes.length === 0) {
    return { handled: false, reason: "disabled" };
  }

  const router = new AiResilientRouter();
  const routedCompletion = await router.routeCompletion({
    aliasKey: config.virtualAliasKey,
    messages: enrichedMessages,
    purpose: "autonomous_agent",
    routes: resolvedAlias.routes,
  });

  const replyText = routedCompletion.content?.trim();
  if (!replyText) {
    return { handled: false, reason: "empty_input" };
  }

  const totalTokens = embeddingTokens + routedCompletion.totalTokens;

  // 8. Enqueue Outbound Message with senderType: "AI_BOT" — atomic send + metadata
  const outboundManager = createOutboundConversationMessageManager(db);
  const sentReply = await outboundManager.sendConversationMessage(
    tenantContext,
    params.conversationId,
    {
      actorUserId: null,
      messageType: "text",
      content: { text: replyText },
      idempotencyKey: `ai-reply-${params.conversationId}-${Date.now()}`,
      requestId: `ai-agent-${params.conversationId}`,
    },
  );

  await db.$transaction([
    db.message.update({
      where: { id: sentReply.message.id },
      data: {
        actorType: "AI_BOT",
        metadata: {
          senderType: "AI_BOT",
          citations: citations.map((c) => ({
            documentId: c.documentId,
            documentTitle: c.documentTitle,
            chunkIndex: c.chunkIndex,
            score: c.score,
          })),
        },
      },
    }),
  ]);

  // 9. Record Token Usage
  await recordAiUsage(db, {
    tenantId: params.tenantId,
    providerType: routedCompletion.providerUsed,
    modelId: routedCompletion.modelUsed,
    promptTokens: routedCompletion.usage.promptTokens,
    completionTokens: routedCompletion.usage.completionTokens,
    totalTokens,
    costEstimatedUsd: 0.00001 * totalTokens,
    latencyMs: routedCompletion.latencyMs,
    purpose: "autonomous_agent",
    status: "success",
  });

  return {
    handled: true,
    action: "ai_reply",
    replyText,
    citations,
    modelUsed: routedCompletion.modelUsed,
    providerUsed: routedCompletion.providerUsed,
    totalTokens,
  };
}
