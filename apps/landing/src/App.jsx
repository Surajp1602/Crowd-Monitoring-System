import { useEffect } from 'react';
import Header from './sections/Header.jsx';
import Hero from './sections/Hero.jsx';
import Plan from './sections/Plan.jsx';
import Caps from './sections/Caps.jsx';
import Cases from './sections/Cases.jsx';
import Found from './sections/Found.jsx';
import Integ from './sections/Integ.jsx';
import Flows from './sections/Flows.jsx';
import Faq from './sections/Faq.jsx';
import Cta from './sections/Cta.jsx';
import Footer from './sections/Footer.jsx';
import { initPage } from './page.js';

// The page is React components; the cinematic layer (smooth scroll, WebGL terrain, tilt-to-plan chapter,
// pinned gallery) is framework-free code in src/page.js and src/recipes/, started once after React renders.
let started = false;

export default function App() {
  useEffect(() => {
    if (started) return; // run once, even under React's development double-invoke
    started = true;
    initPage();
  }, []);
  return (
    <>
      <Header />
      <main id="main">
        {/* 1 · Signature: live density terrain */}
        <Hero />
        {/* 2 · Terrain tilts into the operator's plan */}
        <Plan />
        {/* 3 · Detectors by what they watch */}
        <Caps />
        {/* 4 · Venues: pinned gallery of contour art */}
        <Cases />
        {/* 5 · Foundation: deployment, privacy, sources, operations */}
        <Found />
        {/* 6 · Camera sources and alert channels */}
        <Integ />
        {/* 7 · Alert lifecycle */}
        <Flows />
        {/* 8 · Questions */}
        <Faq />
        {/* 9 · Closing: the field, flat */}
        <Cta />
      </main>
      <Footer />
    </>
  );
}
