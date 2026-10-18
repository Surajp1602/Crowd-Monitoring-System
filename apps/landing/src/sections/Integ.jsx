// Section 6 · Integrations: what feeds the platform and where its alerts go.
const NODES = [
  ['RTSP & ONVIF', 'IP cameras and NVR streams'],
  ['HTTP / MJPEG', 'browser-grade streams'],
  ['USB & files', 'local devices and recordings'],
  ['Email', 'SMTP to any mailbox'],
  ['SMS & WhatsApp', 'through Twilio'],
  ['Push', 'Firebase Cloud Messaging'],
  ['Public address', 'signed webhooks to PA and signage'],
  ['Postgres & Redis', 'your own data stores'],
];

export default function Integ() {
  return (
    <section aria-labelledby="integ-title" className="integ" data-integ="">
      <div className="wrap integ__grid">
        <div className="integ__copy">
          <p className="eyebrow"><span>06</span> Connects</p>
          <h2 data-split="" id="integ-title">Cameras in, people informed.</h2>
          <p>Six camera source types feed the detectors; five channels carry alerts out. Each channel is a pluggable provider you switch on with configuration.</p>
          <ul className="integ__list" data-integ-list="">
            {NODES.map(([b, rest], i) => (
              <li data-node={i} key={b}><b>{b}</b> {rest}</li>
            ))}
          </ul>
        </div>
        <div className="integ__stage">
          <canvas aria-label="The CCD mark at the centre of its camera sources and alert channels" data-orbit="" role="img"></canvas>
        </div>
      </div>
    </section>
  );
}
