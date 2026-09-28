# SpaceMap

An interactive 3D map of the universe that runs in your browser. Fly from the
streets below the International Space Station out past the planets to the
largest stars known, with everything placed where it really is right now.

**[Try it live →](https://scaryfast.ca/space/)**

Built with [Three.js](https://threejs.org/) and plain JavaScript: no build step,
no framework, no account.

## What you can do

### Explore the Solar System
- The Sun, all eight planets and their major moons, using real NASA-derived surface maps
- Two orbit modes: **Aligned** for a tidy overview, or **Realistic**, which places
  every planet where it is on any date, based on JPL orbital elements
- Two scale modes: **Compressed** so everything fits on screen, or **Realistic**
  spacing, where moons sit at their true distance (the Moon is 60 Earth radii out)
- Moons are tidally locked, and moon shadows cross their planets during transits

### Watch Earth in real time
- **The ISS, live.** Its position comes from the station's latest published orbit,
  shown with NASA's 3D model and a trail of the last 45 minutes. Pick it from the
  object list and the camera rides along with it.
- **Satellites.** Space stations, the GPS constellation, the geostationary belt,
  and optionally all ~10,000 Starlink satellites, from CelesTrak's public catalogue
- **Day and night.** An 8K Earth with city lights that come on along the terminator
- **Satellite view.** Keep scrolling into Earth to go from orbit to street level,
  with high-resolution imagery streaming in as you descend

### Travel through time
- Scrub to any date, or run time forwards or backwards
- Scroll over the speed slider for fine control, from real time (1 sec/sec) up to
  a year per second. Planets, moons, the ISS and every satellite follow the clock.

### Go beyond
- A real night sky of about 9,000 naked-eye stars, with constellation lines and labels
- Nearby stars, exoplanet systems and black holes
- A **size comparison** mode that lines everything up from the Moon to
  Stephenson 2-18, one of the largest stars known

## Controls

| Action | Mouse | Touch |
|---|---|---|
| Rotate | Drag | One-finger drag |
| Zoom | Scroll | Pinch |
| Pan | Shift + drag, or middle mouse | Two-finger drag |
| Select / fly to | Click an object or pick it from the side panel | Tap |
| Time speed | Scroll over the speed slider | Slider |

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
js/earthTiles.js      Streaming satellite imagery for Earth close-ups
js/stellarEffects.js  Star surface, corona and black hole shaders
js/textures.js        Procedural textures for bodies without real maps
textures/             Planet and Earth maps
models/iss.glb        ISS 3D model
data/                 Star catalogue and constellation lines
```

When you deploy changes, bump the `?v=` number on `main.js` in `index.html`
*and* on every import at the top of `main.js`, so browsers fetch the new files
instead of reusing cached ones.

## Data and credits

| What | Source | License |
|---|---|---|
| Planet, Moon and Earth maps | [Solar System Scope](https://www.solarsystemscope.com/textures/), based on NASA data | CC BY 4.0 |
| ISS 3D model | [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources) | Public domain |
| ISS orbit | [Where the ISS at?](https://wheretheiss.at/) API | Free public API |
| Satellite orbits | [CelesTrak](https://celestrak.org/) | Free public data |
| Orbit propagation | [satellite.js](https://github.com/shashwatak/satellite-js) (SGP4) | MIT |
| Satellite imagery | Esri World Imagery (Esri, Maxar, Earthstar Geographics, and the GIS User Community) | Esri terms of use |
| Night sky stars | [HYG Database](https://github.com/astronexus/HYG-Database) v4.1 | CC BY-SA 4.0 |
| Constellation lines | [d3-celestial](https://github.com/ofrohn/d3-celestial) | BSD 3-Clause |
| Planet positions | JPL mean orbital elements (J2000) | Public domain |
| 3D engine | [Three.js](https://threejs.org/) r160 | MIT |

CelesTrak asks that each network download a given satellite list no more than
once every two hours. SpaceMap caches the lists in your browser to stay within that.

## Status

SpaceMap is in beta, so expect rough edges and the odd inaccuracy. Questions or
bug reports: [space@scaryfast.ca](mailto:space@scaryfast.ca) or open an issue.
