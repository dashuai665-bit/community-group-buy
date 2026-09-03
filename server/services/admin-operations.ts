import { ApiError } from '../api-error.ts';
import { Repositories } from '../repositories/index.ts';
import { requireActiveUser } from './index.ts';
import {
  addOperationsMetrics,
  emptyOperationsMetrics,
} from '../../domain/admin-operations.ts';

export class AdminOperationsService {
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

  private async requireCommunity(userId: string | null, communityId: string) {
    const { actor, platform } = await this.actor(userId);
    const community = await this.repositories.communities.findById(communityId);
    if (!community)
      throw new ApiError(404, 'COMMUNITY_NOT_FOUND', '找不到此社區');
    if (!platform) {
      const membership = await this.repositories.members.find(
        actor.id,
        communityId,
      );
      if (
        !membership ||
        membership.status !== 'active' ||
        membership.role !== 'community_admin'
      )
        throw new ApiError(
          403,
          'COMMUNITY_ADMIN_REQUIRED',
          '需要該社區管理員權限',
        );
    }
    return community;
  }

  async dashboard(userId: string | null) {
    const { actor, platform } = await this.actor(userId);
    const all = platform
      ? await this.repositories.communities.listAll()
      : (
          (await this.repositories.members.listManagedForUser(
            actor.id,
          )) as Array<Record<string, unknown>>
        ).map((row) => ({
          id: String(row.community_id),
          name: String(row.name),
          slug: String(row.slug),
          status: row.community_status,
          join_policy: row.join_policy,
        }));
    if (!platform && !all.length)
      throw new ApiError(403, 'COMMUNITY_ADMIN_REQUIRED', '需要社區管理員權限');
    const row = platform
      ? await this.repositories.operations.summaryGlobal()
      : await this.repositories.operations.summaryForCommunities(
          all.map((community) => community.id),
        );
    const totals = addOperationsMetrics(emptyOperationsMetrics(), row);
    return {
      isPlatformAdmin: platform,
      manageableCommunities: all.length,
      communities: all,
      ...totals,
    };
  }

  async community(userId: string | null, communityId: string) {
    const community = await this.requireCommunity(userId, communityId);
    const row = await this.repositories.operations.summary(communityId);
    const recent = await this.repositories.operations.recentOrders(communityId);
    return {
      community: {
        id: community.id,
        name: community.name,
        status: community.status,
        joinPolicy: community.join_policy,
      },
      summary: {
        collecting: Number(row?.collecting ?? 0),
        groupedReady: Number(row?.grouped_ready ?? 0),
        pendingPurchase: Number(row?.pending_purchase ?? 0),
        pendingPickup: Number(row?.pending_pickup ?? 0),
        unfinishedOrders: Number(row?.unfinished_orders ?? 0),
      },
      recentOrderIds: recent.map((order) => order.id),
    };
  }
}
