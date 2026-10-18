// Section 5 · Foundation: what operators need to trust before they deploy.
import { links } from '../links.js';

const PILLARS = [
  ['On your hardware', 'Runs where your cameras are.', 'Postgres, Redis and four services in Docker Compose or Kubernetes. Streams never leave your network; credentials are encrypted at rest.'],
  ['Privacy', 'Bodies, not faces.', 'People are detected and tracked to estimate position and motion. There is no face recognition, raw frames are not stored, and snapshots exist only for alerts, behind signed expiring links.'],
  ['Any camera', 'RTSP, ONVIF, HTTP, USB, files.', 'Place each camera on the plan with heading, field of view and range. A built-in simulator runs the whole platform without a single camera or GPU.'],
  ['Operations', 'Health you can see.', 'Every service reports liveness; GPU, CPU and the notification queue are on one page. Workers reconnect on their own and alert when a stream fails.'],
];

export default function Found() {
  return (
    <section aria-labelledby="found-title" className="found" id="deploy">
      <div className="wrap">
        <div className="found__head">
          <div>
            <p className="eyebrow"><span>05</span> Foundation</p>
            <h2 data-split="" id="found-title">Infrastructure you own, rules you set.</h2>
          </div>
          <p>Every threshold is a live setting and every alert keeps its evidence. Nothing is a black box to the people responsible for the crowd.</p>
        </div>
        <div className="found__grid">
          {PILLARS.map(([label, title, body]) => (
            <article data-reveal="" key={label}>
              <p className="found__label">{label}</p>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
        <div className="certs" data-reveal="">
          <p>Role-based access for administrators, supervisors, security officers and viewers, plus a read-only guest view.</p>
          <a className="btn btn--accent" data-magnetic="" href={links.dashboard}>Try the guest view</a>
        </div>
      </div>
    </section>
  );
}
