import { CommunityOperations } from '@/components/storefront/community-operations';
export default async function Page({
  params,
}: {
  params: Promise<{ communityId: string }>;
}) {
  const { communityId } = await params;
  return (
    <section className="content-section page-top">
      <CommunityOperations communityId={communityId} />
    </section>
  );
}
