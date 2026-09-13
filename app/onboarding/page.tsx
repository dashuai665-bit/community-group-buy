import { OnboardingView } from '@/components/storefront/onboarding-view';

export default function OnboardingPage() {
  return (
    <section className="content-section page-top onboarding-page">
      <p className="eyebrow">歡迎加入鄰里湊湊</p>
      <h1 className="page-title">完成會員資料</h1>
      <p className="page-lead">補上取貨姓名與聯絡電話，就能開始參與社區湊單。</p>
      <OnboardingView />
    </section>
  );
}
