import { ApiError } from '../api-error.ts';
import { Repositories } from '../repositories/index.ts';
import { requireActiveUser } from './index.ts';

export class GroupingService {
  private readonly repositories: Repositories;
  constructor(repositories: Repositories) {
    this.repositories = repositories;
  }

  private async requireManager(userId: string | null, communityId: string) {
    const actor = await requireActiveUser(this.repositories, userId);
    if (!(await this.repositories.communities.findById(communityId)))
      throw new ApiError(404, 'COMMUNITY_NOT_FOUND', '找不到此社區');
    if (await this.repositories.platformRoles.isPlatformAdmin(actor.id))
      return actor;
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
    return actor;
  }

  async list(userId: string | null, communityId: string) {
    await this.requireManager(userId, communityId);
    return this.repositories.batches.listForCommunity(communityId);
  }

  async get(userId: string | null, communityId: string, groupingId: string) {
    await this.requireManager(userId, communityId);
    const grouping = await this.repositories.batches.findGrouping(
      communityId,
      groupingId,
    );
    if (!grouping)
      throw new ApiError(404, 'GROUPING_NOT_FOUND', '找不到此集單');
    return {
      ...grouping,
      demand: await this.repositories.batches.listDemand(groupingId),
    };
  }

  async form(
    userId: string | null,
    communityId: string,
    groupingId: string,
    reason: string,
  ) {
    const actor = await this.requireManager(userId, communityId);
    const grouping = await this.repositories.batches.findGrouping(
      communityId,
      groupingId,
    );
    if (!grouping)
      throw new ApiError(404, 'GROUPING_NOT_FOUND', '找不到此集單');
    if (grouping.status !== 'open')
      throw new ApiError(
        409,
        'GROUPING_ALREADY_FORMED',
        '此集單已不是開放狀態',
      );
    if (Number(grouping.committed_quantity) <= 0)
      throw new ApiError(409, 'EMPTY_GROUPING', '無需求的集單不可成團');
    const results = await this.repositories.batch([
      this.repositories.batches.manualFormStatement(groupingId),
      this.repositories.batches.manualFormationAuditStatement({
        groupingId,
        actorUserId: actor.id,
        communityId,
        reason,
        quantity: grouping.committed_quantity,
        threshold: grouping.threshold_quantity,
      }),
      this.repositories.orders.deriveStatusesForBatchStatement(groupingId),
    ]);
    const transitionChanges = Number(
      (results[0]?.meta as { changes?: unknown } | undefined)?.changes,
    );
    if (transitionChanges !== 1)
      throw new ApiError(
        409,
        'FORMATION_CONFLICT',
        '集單狀態已變更，請重新載入',
      );
    return this.get(userId, communityId, groupingId);
  }
}
