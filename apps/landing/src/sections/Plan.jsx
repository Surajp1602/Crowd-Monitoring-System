// Section 2 · Terrain becomes instrument: scrolling tilts the field to the operator's 2D plan.
const STEPS = [
  ['Cameras see people', 'YOLO finds every person in each frame and DeepSORT follows them, camera by camera, at the stream\'s own pace.'],
  ['People land on the floor', 'Each camera is placed on the floor plan with its heading, field of view and range, so every person gets a position in metres.'],
  ['Density becomes terrain', 'Positions merge across cameras into one field per floor, refreshed every second, in people per square metre.'],
  ['Terrain becomes the plan', 'Flattened, the field is the map your operators watch: contours at 0.5, 1, 2, 3.5 and 5 people/m², zones against capacity.'],
];

export default function Plan() {
  return (
    <section aria-labelledby="plan-title" className="film plan" data-plan="" data-terrain-root="" id="how">
      <div className="film__stage">
        <canvas aria-hidden="true" className="plan__canvas" data-terrain-plan=""></canvas>
        <div aria-hidden="true" className="film__shade"></div>
        <div className="film__intro" data-film-intro="">
          <p className="eyebrow"><span>02</span> How it works</p>
          <h2 data-split="" id="plan-title">From camera frames to a floor you can read.</h2>
        </div>
        <ol className="film__steps">
          {STEPS.map(([title, body], i) => (
            <li data-step="" key={title}>
              <span className="film__num">{String(i + 1).padStart(2, '0')} / 04</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
        <div className="film__progress"><span data-film-bar=""></span></div>
      </div>
    </section>
  );
}
