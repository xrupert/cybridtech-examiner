"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "./components/Logo";
import { Constellation } from "./components/Constellation";

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
        <Link href="/" className="brand">
          <Logo height={36} />
        </Link>
        <nav className="nav-links">
          <a href="#manifesto">Manifesto</a>
          <Link href="/examine">Examine</Link>
          <Link href="/examine" className="pill">Open examiner</Link>
        </nav>
      </header>
      <section className="hero">
        <div>
          <p className="kicker">Your packet has the answer</p>
          <h1>The workplace exam, written back in Vera.</h1>
          <p className="lede">
            CybridTech Examiner reads a title report the way a desk examiner does then a second pass argues with the first. One violet action. The rest is void.
          </p>
          <div className="hero-actions">
            <Link className="pill" href="/examine">Request the bench</Link>
            <a className="ghost" href="#manifesto">How it moves</a>
          </div>
        </div>
        <Constellation />
      </section>
      <section className="section" id="manifesto">
        <p className="kicker">Operating law</p>
        <h2>Black void. One iris spark. Knowledge as a field.</h2>
        <p className="muted">
          Hierarchy comes from scale, not weight. Particles drift because title is a constellation of recordings. The only filled control is the examiner pill.
        </p>
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
