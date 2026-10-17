// Skip link and navigation (burger on small screens).
import { links } from '../links.js';
import Mark from './Mark.jsx';

const NAV = [
  ['How it works', '#how'],
  ['Detectors', '#detectors'],
  ['Alerts', '#alerts'],
  ['Deploy', '#deploy'],
  ['FAQ', '#faq'],
];

export default function Header() {
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="nav" data-nav="">
        <div className="nav__bar">
          <a aria-label="CCD crowd density platform, home" className="nav__logo" href="#top">
            <Mark />
            <span className="wordmark">CCD<small>Crowd density</small></span>
          </a>
          <nav aria-label="Primary" className="nav__menu">
            {NAV.map(([label, href]) => <a key={href} href={href}>{label}</a>)}
          </nav>
          <div className="nav__actions">
            <a className="nav__login" href={links.subscribe}>Public alerts</a>
            <a className="btn btn--accent btn--sm" data-magnetic="" href={links.dashboard}><span className="hide-sm">Open the control center</span><span className="show-sm">Control center</span></a>
            <button aria-expanded="false" aria-label="Open menu" className="nav__burger" data-burger=""><span></span><span></span></button>
          </div>
        </div>
      </header>
    </>
  );
}
