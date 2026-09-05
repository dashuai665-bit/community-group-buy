import { auditDisplayEvent, projectAuditMetadata } from '../../domain/audit-log.ts';
import { ApiError } from '../api-error.ts';
import { Repositories } from '../repositories/index.ts';
import { requireActiveUser } from './index.ts';

export type AuditQuery = { page: number; limit: number; event?: string };

export class AuditLogService {
  private readonly repositories: Repositories;
  constructor(repositories: Repositories) {
    this.repositories = repositories;
  }

  private async actor(userId: string | null) {
    const actor = await requireActiveUser(this.repositories, userId);
    return {
      actor,
      platform: await this.repositories.platformRoles.isPlatformAdmin(actor.id),
    };
  }

  async community(userId: string | null, communityId: string, query: AuditQuery) {
    const { actor, platform } = await this.actor(userId);
    const community = await this.repositories.communities.findById(communityId);
    if (!community) throw new ApiError(404, 'COMMUNITY_NOT_FOUND', '找不到此社區');
    if (!platform) {
      const membership = await this.repositories.members.find(actor.id, communityId);
      if (!membership || membership.status !== 'active' || membership.role !== 'community_admin')
        throw new ApiError(403, 'COMMUNITY_ADMIN_REQUIRED', '需要該社區管理員權限');
    }
    return this.list({ ...query, communityId });
  }

  async platform(userId: string | null, query: AuditQuery & { communityId?: string }) {
    const { platform } = await this.actor(userId);
    if (!platform) throw new ApiError(403, 'PLATFORM_ADMIN_REQUIRED', '需要平台管理員權限');
    if (query.communityId && !(await this.repositories.communities.findById(query.communityId)))
      throw new ApiError(404, 'COMMUNITY_NOT_FOUND', '找不到此社區');
    return this.list(query);
  }

  private async list(query: AuditQuery & { communityId?: string }) {
    const result = await this.repositories.audits.listPage({
      communityId: query.communityId,
      event: query.event,
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
    });
    return {
      page: query.page,
      limit: query.limit,
      total: result.total,
      auditLogs: result.rows.map((row) => {
        const metadata = projectAuditMetadata(row.metadata);
        return {
          id: row.id,
          timestamp: row.created_at,
          event: auditDisplayEvent(row.action_type, metadata),
          actionType: row.action_type,
          actor: { displayName: row.actor_display_name ?? '系統／未知使用者' },
          community: row.community_id ? { id: row.community_id, name: row.community_name ?? '未知社區' } : null,
          target: { type: row.target_type, id: row.target_id },
          metadata,
        };
      }),
    };
  }
}
