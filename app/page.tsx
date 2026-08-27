"use client";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  function login(e: FormEvent) {
    e.preventDefault();
    const expected = process.env.NEXT_PUBLIC_ACCESS_CODE || "examiner";
    if (code.trim().toLowerCase() === expected.toLowerCase()) {
      sessionStorage.setItem("cybridtech-examiner-ok", "1");
      router.push("/examine");
    } else setError("Access code not recognized.");
  }

  return (
    <div className="wrap">
      <header className="nav">
        <div className="brand"><Mark /><span className="word">CybridTech</span></div>
        <nav className="nav-links">
          <a href="#manifesto">Manifesto</a>
          <Link href="/examine">Examine</Link>
          <Link href="/examine" className="pill">Open examiner</Link>
        </nav>
      </header>
      <section className="hero">
        <div>
          <p className="kicker">Title examination, structured</p>
          <h1>Read the packet. Fill Vera. Argue with the first pass.</h1>
          <p className="lede">Law firms and title desks upload a report or a batch. An extractor maps every required Vera field. A critic stamps Pass or Fail.</p>
          <div className="hero-actions">
            <Link className="pill" href="/examine">Open examiner</Link>
            <a className="ghost" href="#manifesto">How it works</a>
          </div>
        </div>
        <Constellation />
      </section>
      <section className="section" id="manifesto">
        <p className="kicker">Operating law</p>
        <h2>One action. One structure. One verdict.</h2>
        <p className="muted">Hick: upload is the only primary control. Tesler: the Vera questionnaire stays in the machine. Peak-end: Pass/Fail is the last line on the page.</p>
      </section>
      <section className="gate" id="access">
        <p className="kicker">Firm desk</p>
        <h2>Enter the bench</h2>
        <p className="muted">Default access code for this bones build is examiner.</p>
        <form onSubmit={login}>
          <input type="password" placeholder="Access code" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="pill" type="submit">Continue</button>
        </form>
        {error ? <p className="muted" style={{ marginTop: 16, color: "#ffb829" }}>{error}</p> : null}
      </section>
    </div>
  );
}

function Mark() {
  return (
    <svg width="28" height="28" viewBox="0 0 64 64" aria-hidden>
      <circle cx="32" cy="32" r="10" fill="none" stroke="#8052ff" strokeWidth="2" />
      <path d="M10 34c12-22 32-22 44 0" fill="none" stroke="#8052ff" strokeWidth="2" />
      <path d="M12 28c14 20 26 20 40-2" fill="none" stroke="#15846e" strokeWidth="2" />
    </svg>
  );
}

function Constellation() {
  const pts = Array.from({ length: 90 }, (_, i) => {
    const a = (i / 90) * Math.PI * 6.2;
    const r = 18 + (i % 7) * 9;
    return { x: 200 + Math.cos(a) * r * 1.4, y: 210 + Math.sin(a) * r, c: ["#8052ff", "#ffb829", "#15846e", "#c084fc", "#38bdf8"][i % 5] };
  });
  return (
    <svg className="constellation" viewBox="0 0 400 420" aria-label="Particle field">
      {pts.map((p, i) => (
        <polygon key={i} points={`${p.x},${p.y - 3} ${p.x + 3},${p.y + 2} ${p.x - 3},${p.y + 2}`} fill="none" stroke={p.c} strokeWidth="1" />
      ))}
    </svg>
  );
}
