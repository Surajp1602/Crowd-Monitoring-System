// Section 8 · Questions security and IT teams ask first.
import { links } from '../links.js';

const FAQ = [
  ['Does it identify people?', 'No. It detects and tracks bodies to estimate where people are and how they move. There is no face recognition, and public notices never include images or details about individuals.'],
  ['Do we need GPUs?', 'For live cameras an NVIDIA GPU is recommended for detection; one mid-range card serves several streams. The built-in simulator runs everything else, from heatmaps to notifications, with no GPU and no cameras.'],
  ['Where does the data live?', 'On your infrastructure: Postgres, Redis and a shared media volume. Raw frames are not stored. Snapshots are kept only for alerts, and raw tracks are pruned on a retention schedule.'],
  ['Which cameras work?', 'RTSP, ONVIF, HTTP or MJPEG streams, USB cameras, webcams and video files. Each is placed on the floor plan with its position, heading, field of view and range.'],
  ['How do we stop false alarms?', 'Every detector needs its condition to persist and then cools down, so an incident becomes one alert. Thresholds and the confidence floor are live settings, and false positives are counted so you can tune them.'],
];

export default function Faq() {
  return (
    <section aria-labelledby="faq-title" className="faq" id="faq">
      <div className="wrap faq__grid">
        <div className="faq__head">
          <p className="eyebrow eyebrow--ink"><span>08</span> Questions</p>
          <h2 data-split="" id="faq-title">Before you put it in the control room.</h2>
          <p>The questions security, IT and privacy teams ask first.</p>
          <a className="link-arrow" href={links.dashboard}>Explore the demo station</a>
        </div>
        <div className="faq__list" data-accordion="">
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
