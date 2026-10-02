# SpaceMap

An interactive 3D map of the universe that runs in your browser. Fly from the
streets below the International Space Station out past the planets to the
largest stars known, with everything placed where it really is right now.

**[Try it live →](https://scaryfast.ca/space/)**

<img width="2555" height="1279" alt="image" src="https://github.com/user-attachments/assets/af801bdc-6485-40a3-af9e-00bd2dd24e6c" />

<img width="2276" height="1278" alt="image" src="https://github.com/user-attachments/assets/c74bf1c5-59c4-4da4-9abd-0bb1693c382e" />

<img width="2277" height="1275" alt="image" src="https://github.com/user-attachments/assets/6f4cade7-b7b4-46cf-8109-84be901ae97f" />

<img width="1729" height="980" alt="image" src="https://github.com/user-attachments/assets/f3b8f177-edea-46fa-a14f-9dc3bc3ce2cb" />

<img width="2279" height="1276" alt="image" src="https://github.com/user-attachments/assets/ca8d0117-7252-4f27-b8ca-e91fab9122d1" />

<img width="1126" height="898" alt="firefox_ox2hU9Fq0C" src="https://github.com/user-attachments/assets/d40bcf06-fa00-408e-ad2f-e760c5cc4544" />

<img width="2555" height="1278" alt="image" src="https://github.com/user-attachments/assets/0d76fd63-097a-45df-9461-5752ec3e30c2" />


Built with [Three.js](https://threejs.org/) and plain JavaScript: no build step,
no framework, no account.

## What you can do

### Explore the Solar System
- The Sun, all eight planets and their major moons, using real NASA-derived surface maps
- Two orbit modes: **Aligned** for a tidy overview, or **Realistic**, which places
  every planet where it is on any date, based on JPL orbital elements
- Two scale modes: **Compressed** so everything fits on screen, or **Realistic**
  spacing, where moons sit at their true distance (the Moon is 60 Earth radii out)
- Realistic orbits are true tilted ellipses (JPL Keplerian elements), so Mercury
  swings between 0.31 and 0.47 AU and Saturn's rings turn edge-on to Earth when
  they really do
- Every planet has its real axial tilt and spin (IAU pole and rotation data):
  Earth's seasons, Uranus on its side, Venus and Uranus spinning backwards,
  Saturn's rings in its equatorial plane. Earth turns by sidereal time, so the
  Sun is overhead where it really is
- Moons are tidally locked and orbit in their planet's equatorial plane (the Moon
  in its own 5°-tilted orbit), and moon shadows cross their planets during transits

### Watch Earth in real time
- **The ISS, live.** Its position comes from the station's latest published orbit,
  shown with NASA's 3D model and a trail of the last 45 minutes. Pick it from the
  object list and the camera rides along with it.
- **Satellites.** Space stations, the GPS constellation, the geostationary belt,
  and optionally all ~10,000 Starlink satellites, from CelesTrak's public catalogue
- **Day and night.** An 8K Earth with city lights that come on along the terminator
- **Satellite view.** Keep scrolling into Earth to go from orbit to street level,
  with high-resolution imagery streaming in as you descend. Scrolling zooms toward
  the cursor, like a web map.
- **Night view.** Up close, the night side shows a dark street map with place and
  street names, blending into the daylight imagery across the terminator. Or switch
  to city lights, which follow the real streets and districts up close.

### Film it
- **Follow modes.** The camera can follow the selected object, or follow it *and*
  keep its angle: a chase cam that turns with the ISS so a framed horizon stays put
  all the way around the planet. Drag to a new angle and it locks on there.
- **Roll and level.** Ctrl + drag rolls the view; the compass puts north back up and
  the level-horizon button lines up with the ISS's own "up".
- **Smooth hand-offs.** Following the ISS, click Earth to switch focus without
  the camera moving, then scroll straight down into it. Panning (Shift-drag or
  right-drag) shifts the framing and keeps riding along with the station.
- **Scale changes as a shot.** Switching between compressed and realistic scale
  slides every planet and moon to its new distance while the camera holds still.

### Travel through time
- Opens playing at about 43 minutes per second, so you can see things move;
  picking the ISS slows the clock to 2 minutes per second, so Earth doesn't
  race by below it
- Pick any date, or run time forwards or backwards
- Scroll anywhere over the time panel, or use − and +, to step through speeds from
  20 sec/s doubling up to a year per second (and the same in reverse). One-click
  presets from real time to 1 yr/s. Planets, moons, the ISS and every satellite
  follow the clock.

### Go beyond
- A real night sky of about 9,000 naked-eye stars, with constellation lines and labels
- Nearby stars, exoplanet systems and black holes. Black holes are ray-traced
  in the browser: light bends around them, so the far side of the accretion
  disk arcs over and under the black shadow, like in *Interstellar*
- A **size comparison** mode that lines everything up from the Moon to
  Stephenson 2-18, one of the largest stars known

## Controls

| Action | Mouse | Touch |
|---|---|---|
| Rotate | Drag | One-finger drag |
| Zoom | Scroll (toward the cursor near Earth) | Pinch |
| Pan | Shift + drag, or middle mouse | Two-finger drag |
| Roll the view | Ctrl + drag | – |
| North up / level horizon | Compass and horizon buttons (top left) | Same buttons |
| Select / fly to | Click an object or pick it from the side panel | Tap |
| Play / pause | Space, or the play button | Play button |
| Time speed | A / D keys, scroll over the time panel, − / + buttons, presets | Buttons and presets |
| Spread out / compress distances | W / S, or the Scale slider | Scale slider |
| Hide / show orbit lines | Q | – |
| Fly to Earth / the Moon / the ISS | E / M / I | – |
| Desktop globe mode | G, or the Globe button | Globe button |
| Back to the present time | R, or the Now button | Now button |
| Hide / show the interface | H | – |

On phones, a bottom bar opens the object list, time controls and settings.

## Running it locally

It's a static site, but it has to be served over HTTP (browsers block ES
modules and textures opened as `file://`).

```bash
npx serve .
```

Then open http://localhost:3000. Three.js and the other libraries load from a CDN,
so you need an internet connection. The ISS, satellites and satellite imagery
are fetched live.

## Project layout

```
index.html            UI markup, loads js/main.js
css/styles.css        All styles (desktop and mobile)
js/main.js            Scene setup, camera, UI, timeline, orbital mechanics
js/celestialData.js   Planets, moons, stars and exoplanets (km, days)
js/iss.js             Live ISS position, model and trail
js/satellites.js      CelesTrak satellite groups and caching
js/earthTiles.js      Streaming imagery and night street map for Earth close-ups
js/stellarEffects.js  Star surface, corona and black hole shaders
js/textures.js        Procedural textures for bodies without real maps
textures/             Planet and Earth maps
models/iss.glb        ISS 3D model
data/                 Star catalogue and constellation lines
```

When you deploy changes, bump the `?v=` number on `main.js` in `index.html`
*and* on every import at the top of `main.js`, so browsers fetch the new files
instead of reusing cached ones. `styles.css` has its own `?v=` in `index.html`;
bump it when the CSS changes.

## Data and credits

| What | Source | License |
|---|---|---|
| Planet, Moon and Earth maps | [Solar System Scope](https://www.solarsystemscope.com/textures/), based on NASA data | CC BY 4.0 |
| ISS 3D models | [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources) (distant view); [NASA VTAD textured model](https://science.nasa.gov/resource/international-space-station-3d-model/) (close-up, compressed with glTF-Transform) | Public domain |
| ISS orbit | [Where the ISS at?](https://wheretheiss.at/) API | Free public API |
| Satellite orbits | [CelesTrak](https://celestrak.org/) | Free public data |
| Orbit propagation | [satellite.js](https://github.com/shashwatak/satellite-js) (SGP4) | MIT |
| Live cloud cover | [clouds.matteason.co.uk](https://clouds.matteason.co.uk/) (geostationary weather satellites: EUMETSAT, NOAA, JMA) | Free to use with credit |
| Satellite imagery | Esri World Imagery (Esri, Maxar, Earthstar Geographics, and the GIS User Community) | Esri terms of use |
| Night street map | Esri Dark Gray Canvas (Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS User Community) | Esri terms of use |
| Night sky stars | [HYG Database](https://github.com/astronexus/HYG-Database) v4.1 | CC BY-SA 4.0 |
| Constellation lines | [d3-celestial](https://github.com/ofrohn/d3-celestial) | BSD 3-Clause |
| Planet positions | JPL mean orbital elements (J2000) | Public domain |
| 3D engine | [Three.js](https://threejs.org/) r160 | MIT |

CelesTrak asks that each network download a given satellite list no more than
once every two hours. SpaceMap caches the lists in your browser to stay within that.

## Status

SpaceMap is in beta, so expect rough edges and the odd inaccuracy. Questions or
bug reports: [space@scaryfast.ca](mailto:space@scaryfast.ca) or open an issue.
