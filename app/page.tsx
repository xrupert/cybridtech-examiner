import Link from "next/link";
import { Logo } from "./components/Logo";
import { Constellation } from "./components/Constellation";

export default function HomePage() {
  return (
    <main className="site-shell">
      <header className="site-nav">
        <Link href="/" className="site-brand" aria-label="Cybrid Title home" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Logo height={40} />
          <strong style={{ color: "#fff", letterSpacing: ".08em", fontSize: 15 }}>CYBRID TITLE</strong>
        </Link>
        <nav className="site-nav-links" aria-label="Primary navigation">
          <a href="#workflow">Workflow</a>
          <a href="#review">Review standard</a>
          <Link className="primary-pill" href="/examine">Open Cybrid Title</Link>
        </nav>
      </header>

      <section className="marketing-hero">
        <div className="hero-copy">
          <p className="eyebrow">Title examination, structured</p>
          <h1>The packet is the evidence. The review should make that obvious.</h1>
          <p className="hero-lede">
            Cybrid Title reviews an existing title-report packet against VERA v3 and the loaded RCS rules, or builds a verified Run Sheet from the recorded title documents themselves.
          </p>
          <div className="hero-actions">
            <Link className="primary-pill" href="/examine">Open the workbench</Link>
            <a className="text-action" href="#workflow">See the workflow</a>
          </div>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <Constellation />
          <div className="hero-orbit-copy">
            <span>READ</span>
            <span>VERIFY</span>
            <span>DELIVER</span>
          </div>
        </div>
      </section>

      <section className="statement-section" id="workflow">
        <p className="eyebrow">The workflow</p>
        <div className="statement-grid">
          <h2>One packet in. One defensible review out.</h2>
          <div className="statement-copy">
            <p>
              Upload a complete title-report packet, select the state and order type, review the exceptions first, approve or override findings, and export the finished VERA document.
            </p>
            <div className="step-list" aria-label="Workflow steps">
              <span><b>01</b> Upload the packet</span>
              <span><b>02</b> Read and verify the complete evidence</span>
              <span><b>03</b> Resolve exceptions</span>
              <span><b>04</b> Export VERA v3</span>
            </div>
          </div>
        </div>
      </section>

      <section className="statement-section" id="review">
        <p className="eyebrow">The review standard</p>
        <div className="statement-grid reverse">
          <h2>No evidence, no supported answer.</h2>
          <div className="statement-copy">
            <p>
              Every supported conclusion carries source evidence and a physical PDF page. Missing or ambiguous proof becomes Cannot Confirm instead of an invented answer. The examiner can approve, override, or hold a finding for review without destroying the original AI result.
            </p>
            <p className="quiet-copy">
              During testing, Cybrid Title runs without the temporary access-code gate. User login and an admin usage dashboard will replace that test mode before customer access and pricing are enabled.
            </p>
          </div>
        </div>
      </section>

      <section className="closing-section">
        <p className="eyebrow">Cybrid Title</p>
        <h2>Upload the title report. Get the review.</h2>
        <Link className="primary-pill" href="/examine">Open workbench</Link>
      </section>
    </main>
  );
}
