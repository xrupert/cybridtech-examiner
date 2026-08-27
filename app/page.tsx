import Link from "next/link";
import { Logo } from "./components/Logo";
import { Constellation } from "./components/Constellation";

export default function HomePage() {
  return (
    <main className="site-shell">
      <header className="site-nav">
        <Link href="/" className="site-brand" aria-label="CybridTech Examiner home">
          <Logo height={44} />
        </Link>
        <nav className="site-nav-links" aria-label="Primary navigation">
          <a href="#workflow">Workflow</a>
          <a href="#review">Review standard</a>
          <Link className="primary-pill" href="/examine">Open workbench</Link>
        </nav>
      </header>

      <section className="marketing-hero">
        <div className="hero-copy">
          <p className="eyebrow">Title examination, structured</p>
          <h1>Every title report has an answer. Find it without the scavenger hunt.</h1>
          <p className="hero-lede">
            Upload one report or a full packet. CybridTech Examiner extracts the review fields, runs a second-pass critic, and gives your team a clean Vera-style review that is ready to verify and deliver.
          </p>
          <div className="hero-actions">
            <Link className="primary-pill" href="/examine">Open the examiner</Link>
            <a className="text-action" href="#workflow">See how it moves</a>
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
          <h2>One upload. A complete review path.</h2>
          <div className="statement-copy">
            <p>
              The workbench keeps the source packet, the editable examiner answers, the critic verdict, and the finished client-facing review in one place. Bulk uploads become a queue instead of a pile of browser tabs.
            </p>
            <div className="step-list" aria-label="Workflow steps">
              <span><b>01</b> Upload PDF, text, or a batch</span>
              <span><b>02</b> Review every extracted response</span>
              <span><b>03</b> Re-run the critic after corrections</span>
              <span><b>04</b> Export branded PDF or Word output</span>
            </div>
          </div>
        </div>
      </section>

      <section className="statement-section" id="review">
        <p className="eyebrow">The review standard</p>
        <div className="statement-grid reverse">
          <h2>The machine proposes. The examiner owns the answer.</h2>
          <div className="statement-copy">
            <p>
              Extraction is a first pass, not a permission slip. Each field remains editable, missing information stays visible, and the final Pass or Fail can be re-evaluated after the human review is complete.
            </p>
            <p className="quiet-copy">
              The interface is intentionally sparse: black canvas, one saturated action color, oversized type, and a single procedural constellation. The document itself is the one place the screen becomes white paper.
            </p>
          </div>
        </div>
      </section>

      <section className="closing-section">
        <p className="eyebrow">CybridTech Examiner</p>
        <h2>Turn the packet into a professional review.</h2>
        <Link className="primary-pill" href="/examine">Open workbench</Link>
      </section>
    </main>
  );
}
