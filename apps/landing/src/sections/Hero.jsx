// Section 1 · Signature moment: a live density field over a station floor.
import { links } from '../links.js';

export default function Hero() {
  return (
    <section aria-labelledby="hero-title" className="hero" data-hero="" data-terrain-root="" id="top">
      <canvas aria-hidden="true" className="hero__canvas" data-terrain=""></canvas>
      <div aria-hidden="true" className="hero__shade"></div>
      <div className="hero__inner">
        <p className="hero__kicker" data-reveal=""><span>01</span> Crowd density mapping &amp; anomaly detection</p>
        <h1 className="hero__title" data-split="" id="hero-title">Read the crowd before it moves.</h1>
        <div className="hero__copy" data-reveal="">
          <p>
            CCD turns the cameras you already have into a live map of people per square metre, floor by
            floor, and flags surges, counter-flow and restricted-area entry the moment they begin.
          </p>
          <p className="hero__proof">The hills are density. The amber line is where it starts to matter.</p>
        </div>
        <div className="hero__ctas" data-reveal="">
          <a className="btn btn--accent" data-magnetic="" href={links.dashboard}>Open the control center</a>
          <a className="link-arrow" href="#how">See how it reads a floor</a>
        </div>
      </div>
      <ul aria-label="What the platform does" className="hero__rail">
        <li><strong>12 detectors</strong> on trajectories, from running to abandoned bags</li>
        <li><strong>Every second</strong> a fresh density field per floor</li>
        <li><strong>5 channels</strong> to reach staff and the public nearby</li>
      </ul>
      <p aria-hidden="true" className="hero__scroll"><span></span>Scroll</p>
    </section>
  );
}
