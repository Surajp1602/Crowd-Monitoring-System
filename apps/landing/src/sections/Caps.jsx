// Section 3 · Detectors, grouped by what they watch, with the shipped default thresholds.
const GROUPS = [
  {
    id: 'density',
    tab: 'Density',
    title: 'How tight the crowd is, and where.',
    body: 'Local density around every person and occupancy of every zone against its capacity. Congestion is raised when density holds; a stampede risk when a dense crowd is also moving fast.',
    metrics: [['p/m² congestion default', 4], ['p/m² stampede default', 6]],
    chips: ['Crowd congestion', 'Stampede risk', 'Rapid density rise', 'Zone over capacity'],
  },
  {
    id: 'movement',
    tab: 'Movement',
    title: 'Running, panic and people against the flow.',
    body: 'Speeds and headings from every track. One runner is a note; a share of the crowd running at once is a possible panic. Anyone moving against a coherent flow is flagged as counter-flow.',
    metrics: [['m/s counts as running', 2.5], ['° against the flow', 135]],
    chips: ['Running', 'Panic', 'Counter-flow', 'Possible altercation'],
  },
  {
    id: 'presence',
    tab: 'Presence',
    title: 'Who is where they should not be, for how long.',
    body: 'Restricted zones drawn on the plan raise intrusion within a second. Long dwell, a person stopped alone in a moving crowd, a group standing together and a bag whose owner walked away each have their own rule.',
    metrics: [['s before loitering', 120], ['s before abnormal stop', 60]],
    chips: ['Restricted-area intrusion', 'Loitering', 'Abnormal stopping', 'Gathering', 'Abandoned bag'],
  },
];

export default function Caps() {
  return (
    <section aria-labelledby="caps-title" className="caps" id="detectors">
      <div className="wrap caps__head">
        <div>
          <p className="eyebrow eyebrow--ink"><span>03</span> Detectors</p>
          <h2 data-split="" id="caps-title">Twelve ways a crowd tells you something is wrong.</h2>
        </div>
        <p>Every detector needs its condition to hold before it fires and waits before firing again, so one incident is one alert. Thresholds are live settings, not code.</p>
      </div>
      <div className="wrap caps__body" data-tabs="">
        <div aria-label="Detector groups" className="caps__list" role="tablist">
          {GROUPS.map((g, i) => (
            <button aria-controls={`cap-${i}`} aria-selected={i === 0 ? 'true' : 'false'} id={`cap-t${i}`} key={g.id} role="tab" tabIndex={i === 0 ? undefined : -1}>{g.tab}</button>
          ))}
        </div>
        <div className="caps__panels">
          {GROUPS.map((g, i) => (
            <article aria-labelledby={`cap-t${i}`} hidden={i !== 0} id={`cap-${i}`} key={g.id} role="tabpanel">
              <h3>{g.title}</h3>
              <p>{g.body}</p>
              <dl className="metrics">
                {g.metrics.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd data-count="">{value}</dd>
                  </div>
                ))}
              </dl>
              <ul className="chips chips--ink">
                {g.chips.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
