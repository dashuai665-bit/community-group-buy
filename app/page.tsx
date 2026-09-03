export default function Home() {
  return (
    <main className="home-shell">
      <section className="brand-card" aria-labelledby="brand-title">
        <div className="brand-mark" aria-hidden="true">
          鄰
        </div>
        <p className="eyebrow">社區共同採購平台</p>
        <h1 id="brand-title">鄰里湊湊</h1>
        <p className="tagline">一起湊，更划算</p>
        <p className="intro">
          和熟悉的鄰居一起揪團，讓每一次採購都更省心、更有溫度。
        </p>
        <span className="status-badge">正式版籌備中</span>
      </section>
    </main>
  );
}
