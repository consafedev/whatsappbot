import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
  applyDecorators,
} from "@nestjs/common";
import {
  type ChunkTextOptions,
  createEmbeddingProvider,
} from "@whatsapp-platform/ai-gateway";
import {
  KnowledgeDocumentNotFoundError,
  createKnowledgeDocument,
  deleteKnowledgeDocument,
  getKnowledgeDocumentDetail,
  indexKnowledgeDocument,
  listKnowledgeDocuments,
  type AiGatewayDatabase,
  type KnowledgeDocumentDetail,
  type KnowledgeDocumentSummary,
  type TenantContext,
} from "@whatsapp-platform/database";
import type { PermissionKey } from "@whatsapp-platform/rbac";
import { AI_GATEWAY_DATABASE } from "./ai-gateway";
import { TenantUserSessionGuard } from "./tenant-auth";
import { CurrentTenantContext, TenantContextGuard } from "./tenant-context";
import { RequireEntitlements, TenantEntitlementGuard } from "./tenant-entitlements";
import { RequirePermissions, TenantPermissionGuard } from "./tenant-rbac";

function kbAuthorized(...permissions: PermissionKey[]): MethodDecorator & ClassDecorator {
  return applyDecorators(
    RequirePermissions(...permissions),
    UseGuards(
      TenantUserSessionGuard,
      TenantContextGuard,
      TenantPermissionGuard,
      TenantEntitlementGuard,
    ),
  );
}

export interface CreateKnowledgeDocumentDto {
  readonly title: string;
  readonly sourceType: "text" | "markdown" | "faq" | "pdf_text" | string;
  readonly sourceUrl?: string | undefined;
  readonly rawContent: string;
  readonly metadata?: Record<string, unknown> | undefined;
  readonly chunkOptions?: ChunkTextOptions | undefined;
  readonly embeddingProviderType?: string | undefined;
  readonly embeddingApiKey?: string | undefined;
  readonly embeddingBaseUrl?: string | undefined;
}

export interface ListKnowledgeDocumentsQuery {
  readonly status?: string | undefined;
  readonly limit?: string | undefined;
  readonly offset?: string | undefined;
}

@Injectable()
export class KnowledgeBaseService {
  constructor(
    @Inject(AI_GATEWAY_DATABASE) private readonly database: AiGatewayDatabase,
  ) {}

  async createAndIndexDocument(
    context: TenantContext,
    dto: CreateKnowledgeDocumentDto,
  ): Promise<{
    id: string;
    title: string;
    status: string;
    charCount: number;
    chunksCount: number;
    totalTokens: number;
  }> {
    if (!dto.title?.trim()) {
      throw new BadRequestException("Document title is required");
    }
    if (!dto.rawContent?.trim()) {
      throw new BadRequestException("Document content cannot be empty");
    }

    const created = await createKnowledgeDocument(this.database, {
      tenantId: context.tenantId,
      title: dto.title,
      sourceType: dto.sourceType ?? "text",
      sourceUrl: dto.sourceUrl,
      rawContent: dto.rawContent,
      metadata: dto.metadata,
    });

    const embeddingProvider = createEmbeddingProvider(dto.embeddingProviderType ?? "mock");
    const credentials = {
      apiKey: dto.embeddingApiKey ?? "mock-key",
      baseUrl: dto.embeddingBaseUrl,
    };

    const indexResult = await indexKnowledgeDocument(this.database, {
      tenantId: context.tenantId,
      documentId: created.id,
      embeddingProvider,
      credentials,
      chunkOptions: dto.chunkOptions,
    });

    return {
      id: created.id,
      title: dto.title.trim(),
      status: indexResult.status,
      charCount: created.charCount,
      chunksCount: indexResult.chunksIndexed,
      totalTokens: indexResult.totalTokens,
    };
  }

  async listDocuments(
    context: TenantContext,
    query: ListKnowledgeDocumentsQuery,
  ): Promise<{
    documents: KnowledgeDocumentSummary[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const limit = query.limit ? Number.parseInt(query.limit, 10) : 20;
    const offset = query.offset ? Number.parseInt(query.offset, 10) : 0;

    const result = await listKnowledgeDocuments(this.database, {
      tenantId: context.tenantId,
      status: query.status,
      limit,
      offset,
    });

    return {
      ...result,
      limit,
      offset,
    };
  }

  async getDocumentDetail(
    context: TenantContext,
    documentId: string,
  ): Promise<KnowledgeDocumentDetail> {
    const detail = await getKnowledgeDocumentDetail(this.database, {
      tenantId: context.tenantId,
      documentId,
      includeChunks: true,
    });

    if (!detail) {
      throw new NotFoundException(`Knowledge document '${documentId}' not found`);
    }

    return detail;
  }

  async deleteDocument(
    context: TenantContext,
    documentId: string,
  ): Promise<{ deleted: true; documentId: string }> {
    try {
      return await deleteKnowledgeDocument(this.database, {
        tenantId: context.tenantId,
        documentId,
      });
    } catch (err: unknown) {
      if (err instanceof KnowledgeDocumentNotFoundError) {
        throw new NotFoundException(err.message);
      }
      throw err;
    }
  }
}

@Controller("api/v1/ai/knowledge/documents")
@RequireEntitlements("module.ai")
export class KnowledgeBaseController {
  constructor(private readonly service: KnowledgeBaseService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @kbAuthorized("ai.settings.manage")
  async createDocument(
    @CurrentTenantContext() context: TenantContext,
    @Body() dto: CreateKnowledgeDocumentDto,
  ): Promise<{
    id: string;
    title: string;
    status: string;
    charCount: number;
    chunksCount: number;
    totalTokens: number;
  }> {
    return this.service.createAndIndexDocument(context, dto);
  }

  @Get()
  @kbAuthorized("ai.settings.manage")
  async listDocuments(
    @CurrentTenantContext() context: TenantContext,
    @Query() query: ListKnowledgeDocumentsQuery,
  ): Promise<{
    documents: KnowledgeDocumentSummary[];
    total: number;
    limit: number;
    offset: number;
  }> {
    return this.service.listDocuments(context, query);
  }

  @Get(":documentId")
  @kbAuthorized("ai.settings.manage")
  async getDocumentDetail(
    @CurrentTenantContext() context: TenantContext,
    @Param("documentId") documentId: string,
  ): Promise<KnowledgeDocumentDetail> {
    return this.service.getDocumentDetail(context, documentId);
  }

  @Delete(":documentId")
  @HttpCode(HttpStatus.OK)
  @kbAuthorized("ai.settings.manage")
  async deleteDocument(
    @CurrentTenantContext() context: TenantContext,
    @Param("documentId") documentId: string,
  ): Promise<{ deleted: true; documentId: string }> {
    return this.service.deleteDocument(context, documentId);
  }
}
