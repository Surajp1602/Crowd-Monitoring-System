// Section 4 · Where it works: a pinned gallery; every image is contour art of a crowd field.
const PLACES = [
  {
    seed: 41, hot: true, stat: 'Rush hour', label: 'two daily peaks, one floor at a time',
    title: 'Transit stations',
    body: 'Platforms, ticket halls and exits are corridors with a direction. Counter-flow, abnormal stopping and density on the stairs matter more than raw counts.',
    points: ['Floors stacked in the 3D map', 'Counter-flow against the dominant direction', 'Restricted staff areas'],
  },
  {
    seed: 7, stat: 'Ingress', label: 'thousands arriving in a short window',
    title: 'Stadiums and arenas',
    body: 'Gates and concourses fill fast before kick-off and empty all at once. A rapid density rise at one gate is the cue to open another.',
    points: ['Rapid rise against a rolling baseline', 'Zone capacity per gate', 'Public notices to fans nearby'],
  },
  {
    seed: 93, stat: 'Front of stage', label: 'the densest square metres on site',
    title: 'Festivals and open-air events',
    body: 'Crowd pressure builds where people want to stand. Density held above the congestion threshold is surfaced before it turns into a surge.',
    points: ['Congestion held for ten seconds', 'Stampede risk when dense crowds move', 'PA announcements by zone'],
  },
  {
    seed: 58, stat: 'Every day', label: 'steady footfall, rare incidents',
    title: 'Malls and campuses',
    body: 'Most hours are calm. Loitering, unattended bags and after-hours entry to closed areas are the alerts that matter, and analytics show the busy hours.',
    points: ['Abandoned bags by owner association', 'Typical-week occupancy', 'Loitering and after-hours intrusion'],
  },
];

export default function Cases() {
  return (
    <section aria-labelledby="cases-title" className="cases" data-cases="">
      <div className="cases__pin">
        <div className="wrap cases__head">
          <div>
            <p className="eyebrow eyebrow--ink"><span>04</span> Where it works</p>
            <h2 data-split="" id="cases-title">Built for places where crowds have a shape.</h2>
          </div>
          <p>Each venue tilts the problem differently. The same field and the same detectors, tuned per zone.</p>
        </div>
        {/* Focusable so keyboard users can scroll it where it becomes a swipe row (mobile, reduced motion). */}
        <div aria-label="Venues, scroll sideways" className="cases__track" data-cases-track="" role="region" tabIndex={0}>
          {PLACES.map((p) => (
            <article className="case" key={p.title}>
              <div className="case__media case__media--contour" data-contour={p.seed} data-contour-hot={p.hot ? '' : undefined}></div>
              <div className="case__body">
                <p className="case__stat"><b>{p.stat}</b> {p.label}</p>
                <h3>{p.title}</h3>
                <p>{p.body}</p>
                <ul>{p.points.map((pt) => <li key={pt}>{pt}</li>)}</ul>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
