# SpaceMap 3D Universe Explorer - Architecture

## Project Overview
An interactive 3D web application that allows users to explore the universe at multiple scales, inspired by No Man's Sky. Users can zoom seamlessly from the Earth-Moon system out to nearby star systems.

## Tech Stack
- **3D Engine**: Three.js (WebGL-based)
- **UI Framework**: Vanilla HTML/CSS/JavaScript
- **Math Library**: Three.js built-in math utilities
- **Build Tool**: None (vanilla JS for simplicity)

## Scale Levels (Zoom Layers)

The application uses a hierarchical zoom system with 4 distinct scale levels:

```
Level 1: Earth-Moon System
  - Scale: 1 unit = 1,000 km
  - Objects: Earth, Moon (orbiting)
  - Distance: ~384,000 km (Moon orbit)

Level 2: Solar System (Inner)
  - Scale: 1 unit = 100,000 km
  - Objects: Sun, Mercury, Venus, Earth, Mars, Asteroid Belt
  - Distance: ~400 million km

Level 3: Solar System (Full)
  - Scale: 1 unit = 10 million km
  - Objects: All planets including outer gas giants
  - Distance: ~6 billion km

Level 4: Stellar Neighborhood
  - Scale: 1 unit = 1 light year
  - Objects: 15+ star systems within 15 light years
    - Sun (Sol)
    - Proxima Centauri (4.24 ly)
    - Alpha Centauri A & B (4.37 ly)
    - Barnard's Star (5.96 ly)
    - Wolf 359 (7.86 ly)
    - Lalande 21185 (8.31 ly)
    - Sirius A & B (8.60 ly)
    - Luyten 726-8 (8.79 ly)
    - Ross 154 (9.71 ly)
    - Ross 248 (10.32 ly)
    - Epsilon Eridani (10.52 ly)
    - Lacaille 9352 (10.74 ly)
    - Ross 128 (11.01 ly)
    - EZ Aquarii (11.27 ly)
    - Procyon A & B (11.46 ly)
    - 61 Cygni (11.74 ly)
    - Struve 2398 (11.89 ly)
    - Groombridge 34 (11.62 ly)
    - Epsilon Indi (11.87 ly)
    - Tau Ceti (11.91 ly)
    - Gliese 1061 (12.04 ly)
    - YZ Ceti (12.12 ly)
    - Luyten's Star (12.37 ly)
    - Teegarden's Star (12.50 ly)
    - Kapteyn's Star (12.76 ly)
    - Lacaille 8760 (12.94 ly)
    - Kruger 60 (13.07 ly)
    - Gliese 1 (13.15 ly)
    - WISE 0855−0714 (13.30 ly)
    - Wolf 1061 (13.82 ly)
    - Van Maanen 2 (14.07 ly)
    - Gliese 687 (14.84 ly)
    - LHS 292 (14.90 ly)
    - Groombridge 1618 (15.89 ly)
    - DX Cancri (15.29 ly)
    - Vega (25.04 ly) - visible bright star
    - Altair (16.73 ly)
    - Fomalhaut (25.13 ly)
  - Distance: ~15 light years
```

## Data Structure

### Celestial Body Object
```javascript
{
  name: string,
  type: 'star' | 'planet' | 'moon' | 'asteroid' | 'station',
  radius: number,           // In km
  distanceFromParent: number, // In km or AU
  orbitalPeriod: number,    // In Earth days
  rotationPeriod: number,   // In Earth hours
  color: hex,
  texture: string,          // URL or procedural
  emissive: boolean,        // For stars
  children: [CelestialBody],
  parent: CelestialBody | null
}
```

## Scene Architecture

### Scene Graph Structure
```
Scene
├── Starfield (background particles)
├── Sun System
│   ├── Sun (Mesh)
│   ├── Mercury Orbit
│   ├── Venus Orbit
│   ├── Earth System
│   │   ├── Earth (Mesh)
│   │   ├── Moon Orbit
│   │   │   └── Moon (Mesh)
│   ├── Mars Orbit
│   ├── Jupiter Orbit
│   ├── Saturn Orbit
│   ├── Uranus Orbit
│   └── Neptune Orbit
├── Proxima Centauri System
│   ├── Proxima Centauri (Mesh)
│   └── Planets...
├── Alpha Centauri A System
│   ├── Alpha Centauri A (Mesh)
│   └── Planets...
└── [Other Star Systems...]
```

### Camera Controller
- **Zoom-based LOD**: As camera zooms out, switch which objects are visible/rendered
- **Smooth Transitions**: Tween camera between scale levels
- **Orbit Controls**: Allow rotation around current focus point

## Rendering Strategy

### Level of Detail (LOD)
- Close-up: High detail spheres with textures
- Medium: Simple colored spheres
- Far: Glowing points for stars, invisible for planets

### Visibility Culling
- Only render objects within current scale range
- Use distance-based visibility
- Stars always visible as points

## User Interaction

### Controls
- **Scroll**: Zoom in/out, triggers scale level transitions
- **Drag**: Rotate camera around focus point
- **Click**: Focus on celestial body, show info panel
- **Double-click**: Zoom to celestial body

### UI Elements
- Info panel showing current celestial body data
- Zoom level indicator
- Mini-map showing position in universe
- Navigation buttons for quick jumps

## Visual Design

### Color Palette
- Space background: Deep black (#000000) with subtle nebula gradients
- Stars: White to yellow-white glow
- Planets: Distinctive colors (Earth blue, Mars red, Jupiter banded)
- Orbits: Subtle cyan lines (faint, toggleable)

### Lighting
- Stars emit light (point lights)
- Ambient light for visibility
- No shadows for performance (optional toggle)

## Performance Optimizations

1. **Object Pooling**: Reuse geometry/materials
2. **Frustum Culling**: Don't render off-screen objects
3. **Texture Compression**: Use small, compressed textures
4. **Geometry Simplification**: Lower poly count for distant objects
5. **Animation Throttling**: Update orbits only when visible

## File Structure
```
/
├── index.html              # Main entry point
├── css/
│   └── styles.css          # UI styles
├── js/
│   ├── main.js             # Application entry
│   ├── scene.js            # Three.js scene setup
│   ├── camera.js           # Camera controller
│   ├── celestialData.js    # Universe data
│   ├── body.js             # Celestial body class
│   ├── orbit.js            # Orbital mechanics
│   ├── controls.js         # User input handling
│   └── ui.js               # UI components
├── assets/
│   └── textures/           # Planet/star textures
└── plans/
    └── architecture.md     # This file
```

## Implementation Phases

### Phase 1: Core Setup
- Three.js scene initialization
- Basic camera controls
- Earth-Moon system

### Phase 2: Solar System
- Add all planets
- Orbital mechanics
- Scale transitions

### Phase 3: Stellar Neighborhood
- Add nearby star systems
- Long-distance camera transitions
- Starfield background

### Phase 4: Polish
- UI and info panels
- Visual effects
- Performance optimization
