import { AdminLanding } from '@/components/storefront/admin-landing';
export default function AdminPage() {
  return (
    <section className="content-section page-top">
      <p className="eyebrow">營運總覽</p>
      <h1 className="page-title">管理工作台</h1>
      <p className="page-lead">掌握社區集單、成團與面交進度。</p>
      <AdminLanding />
    </section>
  );
}
