// Section 9 · Closing call to action: the field again, flat and calm, one amber contour.
import { links } from '../links.js';

export default function Cta() {
  return (
    <section aria-labelledby="cta-title" className="cta" data-terrain-root="">
      <canvas aria-hidden="true" className="cta__canvas" data-terrain-cta=""></canvas>
      <div aria-hidden="true" className="cta__shade"></div>
      <div className="wrap cta__inner">
        <p className="eyebrow"><span>09</span> Start</p>
        <h2 data-split="" id="cta-title">See your floor as terrain.</h2>
        <p>The demo station runs on simulated cameras, so you can watch density, alerts and notifications end to end before connecting a single stream.</p>
        <div className="cta__actions">
          <a className="btn btn--accent btn--lg" data-magnetic="" href={links.dashboard}>Open the control center</a>
          <a className="link-arrow" href={links.subscribe}>Sign up for public safety notices</a>
        </div>
      </div>
    </section>
  );
}
