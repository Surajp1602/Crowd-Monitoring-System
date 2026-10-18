// Section 7 · Alert lifecycle, shown as the product's own sequence of events.
import { links } from '../links.js';

const TABS = [
  {
    tab: 'Raised',
    title: 'Detected, evidenced, on screen.',
    body: 'The detector that fired writes a snapshot with the people involved boxed, places the alert on the floor plan and pushes it to every open dashboard.',
    steps: [
      ['00.0 s', 'Fourteen of thirty people in the ticket hall pass 3.5 m/s'],
      ['01.0 s', 'Sustained for a second: possible panic, confidence 0.94'],
      ['01.1 s', 'Evidence snapshot saved, runners boxed in red'],
      ['01.2 s', 'Alert pinned on the floor plan and the 3D map'],
      ['01.3 s', 'Critical toast on every operator screen'],
    ],
    points: ['Twelve detectors, one alert per incident', 'Snapshots behind signed, expiring links', 'Confidence floor you control'],
  },
  {
    tab: 'Notified',
    title: 'The right people, by role and distance.',
    body: 'A worker routes each alert once: staff by role and severity, subscribers within their chosen radius of the camera, and the public-address system for the zone.',
    steps: [
      ['Staff', 'Security officers on shift receive email and SMS'],
      ['Public', 'Subscribers within 300 m get a safety notice'],
      ['Announce', 'The PA webhook fires for the ticket hall'],
      ['Throttle', 'Nobody gets the same alert type twice in five minutes'],
      ['Record', 'Every attempt logged; public contacts masked'],
    ],
    points: ['Email, SMS, WhatsApp, push, public address', 'Retries with backoff, exactly once per alert', 'Unsubscribe link in every public notice'],
  },
  {
    tab: 'Closed',
    title: 'Acknowledged, resolved, remembered.',
    body: 'An officer claims the alert, resolves it or marks a false positive. Analytics keep the history: busy hours, zones nearest capacity, alerts per day.',
    steps: [
      ['Claim', 'Acknowledged by the nearest officer'],
      ['Resolve', 'Closed with the crowd dispersed'],
      ['Learn', 'False positives counted per alert type'],
      ['Tune', 'Thresholds adjusted live, no redeploy'],
      ['Review', 'Typical-week occupancy and zone history'],
    ],
    points: ['Bulk actions for busy shifts', 'Minute-level history per zone and floor', 'CSV export for incident reports'],
  },
];

export default function Flows() {
  return (
    <section aria-labelledby="flows-title" className="flows" id="alerts">
      <div className="wrap">
        <div className="flows__head">
          <div>
            <p className="eyebrow eyebrow--ink"><span>07</span> An alert, start to finish</p>
            <h2 data-split="" id="flows-title">One incident, one alert, every step on record.</h2>
          </div>
          <p>An example panic in a station ticket hall, as the platform handles it.</p>
        </div>
        <div className="flows__body" data-flows="" data-tabs="">
          <div aria-label="Alert stages" className="flows__tabs" role="tablist">
            {TABS.map((t, i) => (
              <button aria-controls={`wf-${i}`} aria-selected={i === 0 ? 'true' : 'false'} id={`wf-t${i}`} key={t.tab} role="tab" tabIndex={i === 0 ? undefined : -1}>{t.tab}</button>
            ))}
          </div>
          <div className="flows__panels">
            {TABS.map((t, i) => (
              <article aria-labelledby={`wf-t${i}`} className="flow" hidden={i !== 0} id={`wf-${i}`} key={t.tab} role="tabpanel">
                <ol className="flow__demo flow__demo--steps" data-demo="flow">
                  {t.steps.map(([b, rest]) => <li key={b + rest}><b>{b}</b> {rest}</li>)}
                </ol>
                <div className="flow__copy">
                  <h3>{t.title}</h3>
                  <p>{t.body}</p>
                  <ul>{t.points.map((p) => <li key={p}>{p}</li>)}</ul>
                  {i === 1 && (
                    <p className="flow__watch">Members of the public can sign up at <a href={links.subscribe}>the safety notices page</a>.</p>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
