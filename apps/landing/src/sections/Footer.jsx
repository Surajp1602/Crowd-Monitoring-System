// Footer: product links and section index.
import { links } from '../links.js';
import Mark from './Mark.jsx';

export default function Footer() {
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot__top">
          <a aria-label="CCD crowd density platform, back to top" className="foot__logo" href="#top">
            <Mark size={36} />
            <span className="wordmark">CCD<small>Crowd density</small></span>
          </a>
        </div>
        <div className="foot__cols">
          <nav aria-label="Platform">
            <h3>Platform</h3>
            <a href="#how">How it works</a>
            <a href="#detectors">Detectors</a>
            <a href="#alerts">Alerts and notifications</a>
          </nav>
          <nav aria-label="Deploy">
            <h3>Deploy</h3>
            <a href="#deploy">Infrastructure and privacy</a>
            <a href="#faq">Questions</a>
            <a href={links.docs}>Documentation</a>
          </nav>
          <nav aria-label="Access">
            <h3>Access</h3>
            <a href={links.dashboard}>Operator sign-in</a>
            <a href={links.dashboard}>Guest view</a>
            <a href={links.subscribe}>Public safety notices</a>
          </nav>
        </div>
        <div className="foot__base">
          <p>CCD crowd density mapping and anomaly detection platform.</p>
          <p className="foot__mono">No face recognition · Your infrastructure · Every alert with evidence</p>
        </div>
      </div>
    </footer>
  );
}
