// Celestial body data for FreakinSpace
// Distances in km, periods in Earth days, radii in km

export const AU = 149597870.7; // km per astronomical unit
export const LY = 9460730472580.8; // km per light year

export const ZOOM_LEVELS = {
    EARTH_MOON: {
        name: "Earth-Moon System",
        scale: 1000, // 1 unit = 1000 km
        distance: 384400, // km to moon
        label: "384,000 km"
    },
    INNER_SOLAR: {
        name: "Inner Solar System",
        scale: 100000, // 1 unit = 100,000 km
        distance: 400 * 1000000, // 400 million km
        label: "400 Million km"
    },
    FULL_SOLAR: {
        name: "Solar System",
        scale: 10000000, // 1 unit = 10 million km
        distance: 6000 * 1000000, // 6 billion km
        label: "6 Billion km"
    },
    STELLAR: {
        name: "Stellar Neighborhood",
        scale: LY, // 1 unit = 1 light year
        distance: 30 * LY, // 30 light years
        label: "30 Light Years"
    }
};

// Solar System data
export const solarSystem = {
    name: "Sun",
    type: "star",
    spectralClass: "G2V",
    radius: 696340, // km
    color: 0xFFD700,
    emissive: 0xFFAA00,
    emissiveIntensity: 1,
    mass: "1.989 × 10³⁰ kg",
    temperature: "5,778 K",
    children: [
        {
            name: "Mercury",
        mass: "3.3011 x 10^23 kg",
            type: "planet",
            radius: 2439.7,
            distance: 0.387 * AU,
            orbitalPeriod: 88,
            rotationPeriod: 1407.6,
            color: 0x8C8C8C,
            description: "Smallest planet, closest to the Sun"
        },
        {
            name: "Venus",
        mass: "4.8675 x 10^24 kg",
            type: "planet",
            radius: 6051.8,
            distance: 0.723 * AU,
            orbitalPeriod: 225,
            rotationPeriod: 5832.5,
            color: 0xE6E6B8,
            description: "Hottest planet with thick atmosphere"
        },
        {
            name: "Earth",
            type: "planet",
            radius: 6371,
            distance: 1 * AU,
            orbitalPeriod: 365.25,
            rotationPeriod: 24,
            color: 0x2233FF,
            hasAtmosphere: true,
            atmosphereColor: 0x88AAFF,
            description: "Our home, the only known planet with life",
            children: [
                {
                    name: "Moon",
                    type: "moon",
                    radius: 1737.4,
                    distance: 384400,
                    orbitalPeriod: 27.3,
                    rotationPeriod: 655.7,
                    color: 0xC0C0C0,
                    description: "Earth's only natural satellite"
                }
            ]
        },
        {
            name: "Mars",
        mass: "6.4171 x 10^23 kg",
            type: "planet",
            radius: 3389.5,
            distance: 1.524 * AU,
            orbitalPeriod: 687,
            rotationPeriod: 24.6,
            color: 0xDD4422,
            description: "The Red Planet",
            children: [
                {
                    name: "Phobos",
                    type: "moon",
                    radius: 11.3,
                    distance: 9376,
                    orbitalPeriod: 0.32,
                    color: 0x8C8C8C
                },
                {
                    name: "Deimos",
                    type: "moon",
                    radius: 6.2,
                    distance: 23463,
                    orbitalPeriod: 1.26,
                    color: 0x8C8C8C
                }
            ]
        },
        {
            name: "Jupiter",
        mass: "1.8982 x 10^27 kg",
            type: "planet",
            radius: 69911,
            distance: 5.204 * AU,
            orbitalPeriod: 4333,
            rotationPeriod: 9.9,
            color: 0xD4A574,
            hasBands: true,
            description: "Largest planet, gas giant",
            children: [
                { name: "Io", type: "moon", radius: 1821.6, distance: 421700, orbitalPeriod: 1.77, color: 0xFFFF99 },
                { name: "Europa", type: "moon", radius: 1560.8, distance: 671034, orbitalPeriod: 3.55, color: 0xDDDDFF },
                { name: "Ganymede", type: "moon", radius: 2634.1, distance: 1070412, orbitalPeriod: 7.15, color: 0x999999 },
                { name: "Callisto", type: "moon", radius: 2410.3, distance: 1882709, orbitalPeriod: 16.69, color: 0x666666 }
            ]
        },
        {
            name: "Saturn",
        mass: "5.6834 x 10^26 kg",
            type: "planet",
            radius: 58232,
            distance: 9.582 * AU,
            orbitalPeriod: 10759,
            rotationPeriod: 10.7,
            color: 0xE8DCC0,
            hasRings: true,
            description: "Famous for its prominent ring system",
            children: [
                { name: "Titan", type: "moon", radius: 2574.7, distance: 1221870, orbitalPeriod: 15.95, color: 0xCC9933 },
                { name: "Enceladus", type: "moon", radius: 252.1, distance: 238020, orbitalPeriod: 1.37, color: 0xEEEEFF }
            ]
        },
        {
            name: "Uranus",
        mass: "8.6810 x 10^25 kg",
            type: "planet",
            radius: 25362,
            distance: 19.20 * AU,
            orbitalPeriod: 30687,
            rotationPeriod: 17.2,
            color: 0x99DDDD,
            description: "Ice giant tilted on its side"
        },
        {
            name: "Neptune",
        mass: "1.02413 x 10^26 kg",
            type: "planet",
            radius: 24622,
            distance: 30.05 * AU,
            orbitalPeriod: 60190,
            rotationPeriod: 16.1,
            color: 0x4444FF,
            description: "Windiest planet, furthest from Sun"
        }
    ]
};

// Nearby star systems (within ~15 light years)
export const nearbyStars = [
    {
        name: "Proxima Centauri",
        mass: "0.122 Solar masses",
        type: "star",
        spectralClass: "M5.5Ve",
        distance: 4.24 * LY,
        direction: { x: -1.65, y: -0.77, z: -3.85 }, // Approximate 3D position
        radius: 107280, // km (0.154 solar radii)
        color: 0xFF6633,
        emissive: 0xFF4422,
        temperature: "3,042 K",
        description: "Closest star to Sun, red dwarf flare star",
        children: [
            {
                name: "Proxima Centauri b",
                type: "planet",
                radius: 7160, // Approx Earth-like
                distance: 0.0485 * AU,
                orbitalPeriod: 11.2,
                color: 0x228844,
                description: "Potentially habitable exoplanet"
            }
        ]
    },
    {
        name: "Alpha Centauri A",
        mass: "1.1 Solar masses",
        type: "star",
        spectralClass: "G2V",
        distance: 4.37 * LY,
        direction: { x: -1.67, y: -0.77, z: -3.97 },
        radius: 854391, // km (1.227 solar radii)
        color: 0xFFFFCC,
        emissive: 0xFFEEDD,
        temperature: "5,790 K",
        description: "Similar to our Sun, part of triple system"
    },
    {
        name: "Alpha Centauri B",
        mass: "0.907 Solar masses",
        type: "star",
        spectralClass: "K1V",
        distance: 4.37 * LY,
        direction: { x: -1.68, y: -0.77, z: -3.97 },
        radius: 625000, // km (0.898 solar radii)
        color: 0xFFDDAA,
        emissive: 0xFFCC88,
        temperature: "5,260 K",
        description: "Orange dwarf companion to Alpha Centauri A"
    },
    {
        name: "Barnard's Star",
        type: "star",
        spectralClass: "M4.0V",
        distance: 5.96 * LY,
        direction: { x: 0.13, y: 5.23, z: -2.88 },
        radius: 116000, // km
        color: 0xFF5533,
        emissive: 0xCC3311,
        temperature: "3,134 K",
        description: "Fastest moving star in sky, red dwarf"
    },
    {
        name: "Wolf 359",
        type: "star",
        spectralClass: "M6.0V",
        distance: 7.86 * LY,
        direction: { x: -1.89, y: 5.43, z: 4.28 },
        radius: 112000, // km
        color: 0xFF4422,
        emissive: 0xAA2200,
        temperature: "2,800 K",
        description: "Very faint red dwarf"
    },
    {
        name: "Lalande 21185",
        type: "star",
        spectralClass: "M2.0V",
        distance: 8.31 * LY,
        direction: { x: -3.68, y: -1.16, z: 7.19 },
        radius: 208000, // km
        color: 0xFF6644,
        emissive: 0xDD4422,
        temperature: "3,528 K",
        description: "Bright red dwarf with known exoplanets"
    },
    {
        name: "Sirius A",
        mass: "2.06 Solar masses",
        type: "star",
        spectralClass: "A1V",
        distance: 8.60 * LY,
        direction: { x: -1.61, y: -8.06, z: -2.47 },
        radius: 1191400, // km (1.711 solar radii)
        color: 0xDDEEFF,
        emissive: 0xAADDFF,
        emissiveIntensity: 1.5,
        temperature: "9,940 K",
        description: "Brightest star in night sky"
    },
    {
        name: "Sirius B",
        mass: "1.02 Solar masses",
        type: "star",
        spectralClass: "DA2",
        distance: 8.60 * LY,
        direction: { x: -1.61, y: -8.06, z: -2.47 },
        radius: 5840, // km (white dwarf)
        color: 0xFFFFFF,
        emissive: 0xDDDDFF,
        temperature: "25,200 K",
        description: "White dwarf companion to Sirius A"
    },
    {
        name: "Luyten 726-8 A",
        type: "star",
        spectralClass: "M5.5V",
        distance: 8.79 * LY,
        direction: { x: -4.45, y: -5.63, z: 4.49 },
        radius: 118000, // km
        color: 0xFF5533,
        emissive: 0xCC3311,
        temperature: "2,670 K",
        description: "Also known as BL Ceti, flare star"
    },
    {
        name: "Luyten 726-8 B",
        type: "star",
        spectralClass: "M6.0V",
        distance: 8.79 * LY,
        direction: { x: -4.45, y: -5.63, z: 4.49 },
        radius: 115000, // km
        color: 0xFF4422,
        emissive: 0xBB2200,
        temperature: "2,650 K",
        description: "Also known as UV Ceti, famous flare star"
    },
    {
        name: "Ross 154",
        type: "star",
        spectralClass: "M3.5V",
        distance: 9.71 * LY,
        direction: { x: 5.44, y: -2.31, z: -7.45 },
        radius: 154000, // km
        color: 0xFF6644,
        emissive: 0xDD4422,
        temperature: "3,340 K",
        description: "Red dwarf with magnetic activity"
    },
    {
        name: "Ross 248",
        type: "star",
        spectralClass: "M5.5V",
        distance: 10.32 * LY,
        direction: { x: 2.62, y: 6.65, z: -6.37 },
        radius: 118000, // km
        color: 0xFF5533,
        emissive: 0xCC3311,
        temperature: "2,799 K",
        description: "Small red dwarf moving toward Solar System"
    },
    {
        name: "Epsilon Eridani",
        type: "star",
        spectralClass: "K2V",
        distance: 10.52 * LY,
        direction: { x: -1.61, y: -6.24, z: 7.74 },
        radius: 514000, // km (0.74 solar radii)
        color: 0xFFCC88,
        emissive: 0xFFBB66,
        temperature: "5,084 K",
        description: "Young Sun-like star with debris disk"
    },
    {
        name: "Lacaille 9352",
        type: "star",
        spectralClass: "M0.5V",
        distance: 10.74 * LY,
        direction: { x: -5.93, y: 7.14, z: -3.54 },
        radius: 266000, // km
        color: 0xFF7744,
        emissive: 0xEE5533,
        temperature: "3,727 K",
        description: "Bright red dwarf, high proper motion"
    },
    {
        name: "Ross 128",
        type: "star",
        spectralClass: "M4.0V",
        distance: 11.01 * LY,
        direction: { x: 6.79, y: -0.44, z: -8.15 },
        radius: 139000, // km
        color: 0xFF5533,
        emissive: 0xCC3311,
        temperature: "3,192 K",
        description: "Red dwarf with potentially habitable planet"
    },
    {
        name: "Procyon A",
        type: "star",
        spectralClass: "F5IV-V",
        distance: 11.46 * LY,
        direction: { x: -3.18, y: -9.41, z: -3.06 },
        radius: 1404600, // km (2.048 solar radii)
        color: 0xFFFFEE,
        emissive: 0xFFEEDD,
        emissiveIntensity: 1.3,
        temperature: "6,530 K",
        description: "Bright yellow-white subgiant"
    },
    {
        name: "Procyon B",
        type: "star",
        spectralClass: "DQZ",
        distance: 11.46 * LY,
        direction: { x: -3.18, y: -9.41, z: -3.06 },
        radius: 8760, // km
        color: 0xFFFFFF,
        emissive: 0xDDDDFF,
        temperature: "7,740 K",
        description: "White dwarf companion"
    },
    {
        name: "61 Cygni A",
        type: "star",
        spectralClass: "K5.0V",
        distance: 11.74 * LY,
        direction: { x: -2.67, y: 7.61, z: -7.07 },
        radius: 451000, // km (0.648 solar radii)
        color: 0xFFAA66,
        emissive: 0xEE8844,
        temperature: "4,526 K",
        description: "First star to have parallax measured"
    },
    {
        name: "61 Cygni B",
        type: "star",
        spectralClass: "K7.0V",
        distance: 11.74 * LY,
        direction: { x: -2.67, y: 7.61, z: -7.07 },
        radius: 389000, // km (0.559 solar radii)
        color: 0xFF9966,
        emissive: 0xDD7744,
        temperature: "4,077 K",
        description: "Orange dwarf companion"
    },
    {
        name: "Epsilon Indi",
        type: "star",
        spectralClass: "K5V",
        distance: 11.87 * LY,
        direction: { x: 5.67, y: -2.02, z: -9.56 },
        radius: 497000, // km (0.713 solar radii)
        color: 0xFFAA66,
        emissive: 0xEE8844,
        temperature: "4,628 K",
        description: "Orange dwarf with brown dwarf companions"
    },
    {
        name: "Tau Ceti",
        type: "star",
        spectralClass: "G8.5V",
        distance: 11.91 * LY,
        direction: { x: 6.36, y: -4.00, z: -8.59 },
        radius: 552000, // km (0.793 solar radii)
        color: 0xFFFFCC,
        emissive: 0xFFEEDD,
        temperature: "5,344 K",
        description: "Very Sun-like star, candidate for SETI"
    },
    {
        name: "YZ Ceti",
        type: "star",
        spectralClass: "M4.5V",
        distance: 12.12 * LY,
        direction: { x: 7.00, y: -0.88, z: -9.01 },
        radius: 125000, // km
        color: 0xFF5533,
        emissive: 0xCC3311,
        temperature: "3,056 K",
        description: "Extremely flare-active red dwarf"
    },
    {
        name: "Luyten's Star",
        type: "star",
        spectralClass: "M3.5V",
        distance: 12.37 * LY,
        direction: { x: -1.20, y: -10.75, z: -4.85 },
        radius: 152000, // km
        color: 0xFF6644,
        emissive: 0xDD4422,
        temperature: "3,150 K",
        description: "Red dwarf with habitable zone planet"
    },
    {
        name: "Teegarden's Star",
        type: "star",
        spectralClass: "M6.5V",
        distance: 12.50 * LY,
        direction: { x: 5.18, y: 9.11, z: -5.94 },
        radius: 104000, // km
        color: 0xFF4422,
        emissive: 0xAA2200,
        temperature: "2,634 K",
        description: "Very faint red dwarf discovered 2003"
    },
    {
        name: "Kapteyn's Star",
        type: "star",
        spectralClass: "M1.0V",
        distance: 12.76 * LY,
        direction: { x: 1.89, y: -9.98, z: -6.24 },
        radius: 220000, // km
        color: 0xFF7744,
        emissive: 0xEE5533,
        temperature: "3,570 K",
        description: "One of the oldest stars near Sun"
    },
    {
        name: "Altair",
        type: "star",
        spectralClass: "A7V",
        distance: 16.73 * LY,
        direction: { x: 3.89, y: -14.74, z: -5.41 },
        radius: 1253400, // km (1.8 solar radii)
        color: 0xEEDDFF,
        emissive: 0xDDCCFF,
        emissiveIntensity: 1.4,
        temperature: "7,550 K",
        description: "Bright white star, rapidly rotating"
    },
    {
        name: "Vega",
        type: "star",
        spectralClass: "A0V",
        distance: 25.04 * LY,
        direction: { x: 8.48, y: -16.48, z: 15.54 },
        radius: 1631700, // km (2.362 solar radii)
        color: 0xDDEEFF,
        emissive: 0xCCDDFF,
        emissiveIntensity: 1.6,
        temperature: "9,602 K",
        description: "Fifth brightest star in night sky"
    },
    // Black Holes and Neutron Stars
    {
        name: "Sagittarius A*",
        type: "blackhole",
        subtype: "supermassive",
        distance: 26673 * LY, // ~26,673 light years to galactic center
        direction: { x: -0.02, y: -0.99, z: -0.14 }, // Toward galactic center
        radius: 12685000,
        displayRadius: 15, // Visual size for rendering
        color: 0x000000,
        accretionColor: 0xFF4400,
        mass: "4.3 × 10⁶ Solar masses",
        temperature: "Dormant supermassive black hole",
        description: "Supermassive black hole at center of Milky Way"
    },
    {
        name: "Cygnus X-1",
        type: "blackhole",
        subtype: "stellar",
        distance: 6070 * LY,
        direction: { x: 2.14, y: 5.34, z: -2.08 },
        radius: 44, // km
        displayRadius: 12,
        color: 0x000000,
        accretionColor: 0x4488FF,
        mass: "21 Solar masses",
        temperature: "~10⁹ K (accretion disk)",
        description: "First confirmed black hole, in binary system with blue supergiant"
    },
    {
        name: "V616 Monocerotis",
        type: "blackhole",
        subtype: "stellar",
        distance: 3000 * LY,
        direction: { x: -7.12, y: 2.34, z: 4.56 },
        radius: 17, // km (Schwarzschild radius of ~5.9 Solar masses)
        displayRadius: 10,
        color: 0x000000,
        accretionColor: 0xFF6644,
        mass: "≈6 Solar masses",
        temperature: "Microquasar (X-ray binary)",
        description: "Closest known black hole to Earth"
    },
    {
        name: "Crab Pulsar",
        type: "neutronstar",
        spectralClass: "Pulsar",
        distance: 6500 * LY,
        direction: { x: -4.12, y: 3.89, z: -3.45 },
        radius: 10, // km
        displayRadius: 8,
        color: 0xCCFFFF,
        emissive: 0x88FFFF,
        emissiveIntensity: 0.8,
        mass: "1.4 Solar masses",
        temperature: "~1,000,000 K surface",
        description: "Rapidly rotating neutron star in Crab Nebula, 30 times/sec"
    },
    {
        name: "Betelgeuse",
        mass: "16.5 Solar masses",
        type: "star",
        spectralClass: "M1-2 Ia-Iab",
        distance: 642.5 * LY,
        direction: { x: 7.89, y: 4.56, z: -22.34 },
        radius: 617100000, // km (~887 solar radii!)
        color: 0xFF6633,
        emissive: 0xFF4422,
        emissiveIntensity: 0.9,
        temperature: "3,500 K",
        description: "Red supergiant, one of largest known stars, may explode as supernova soon"
    },

    {
        name: "Rigel",
        mass: "21 Solar masses",
        type: "star",
        spectralClass: "B8 Ia",
        distance: 860 * LY,
        direction: { x: 3.45, y: -12.67, z: -18.92 },
        radius: 54430000, // km (~78 solar radii)
        color: 0xDDEEFF,
        emissive: 0xAADDFF,
        emissiveIntensity: 1.5,
        temperature: "12,100 K",
        description: "Blue supergiant, brightest star in Orion"
    },
    {
        name: "Pleiades Cluster",
        type: "cluster",
        subtype: "opencluster",
        distance: 444 * LY,
        direction: { x: 15.23, y: 28.45, z: -12.67 },
        radius: 30000000, // Visual representation
        displayRadius: 25,
        color: 0xAAAADD,
        emissive: 0x8888CC,
        emissiveIntensity: 0.6,
        temperature: "~12,000 K (hot young stars)",
        description: "Young open star cluster, Seven Sisters"
    },
    {
        name: "Orion Nebula",
        type: "nebula",
        subtype: "diffuse",
        distance: 1344 * LY,
        direction: { x: 4.56, y: -6.78, z: -22.45 },
        radius: 60000000,
        displayRadius: 30,
        color: 0xFFAA88,
        emissive: 0xFF8866,
        emissiveIntensity: 0.5,
        temperature: "~10,000 K",
        description: "Stellar nursery, massive star formation region"
    },
    {
        name: "Andromeda Galaxy",
        type: "galaxy",
        subtype: "spiral",
        distance: 2537000 * LY, // 2.537 million LY
        direction: { x: 121.23, y: -22.45, z: -98.67 },
        radius: 110000000000, // ~110,000 light years radius
        displayRadius: 40,
        color: 0xDDDDBB,
        emissive: 0xCCCCAA,
        emissiveIntensity: 0.4,
        temperature: "Billions of stars",
        description: "Closest major galaxy to Milky Way, on collision course in 4.5 billion years"
    },
    // More Black Holes
    {
        name: "M87*",
        type: "blackhole",
        subtype: "supermassive",
        distance: 53500000 * LY, // 53.5 million LY in Messier 87 galaxy
        direction: { x: 34.56, y: 67.89, z: -123.45 },
        radius: 19175000000, // km (Schwarzschild radius ~19.1 billion km)
        displayRadius: 20,
        color: 0x000000,
        accretionColor: 0xFF6600,
        mass: "6.5 × 10⁹ Solar masses",
        temperature: "Active galactic nucleus (first imaged 2019)",
        description: "First black hole ever photographed, in center of M87 galaxy"
    },
    {
        name: "TON 618",
        type: "blackhole",
        subtype: "supermassive",
        distance: 18200000000 * LY, // 18.2 billion LY
        direction: { x: -45.67, y: 23.45, z: 156.78 },
        radius: 120200000000, // km (Schwarzschild radius of 40.7 billion Solar masses)
        displayRadius: 25,
        color: 0x000000,
        accretionColor: 0xFFAA00,
        mass: "40.7 × 10⁹ Solar masses",
        temperature: "Quasar accretion disk",
        description: "One of the most massive black holes known, powers a quasar"
    },
    {
        name: "Phoenix A*",
        type: "blackhole",
        subtype: "supermassive",
        distance: 8610000000 * LY, // 8.61 billion LY
        direction: { x: 88.12, y: -34.56, z: 112.34 },
        radius: 295000000000, // km (Schwarzschild radius ~295 billion km)
        displayRadius: 28,
        color: 0x000000,
        accretionColor: 0xFF3300,
        mass: "~100 × 10⁹ Solar masses (model estimate)",
        temperature: "Active galactic nucleus / Quasar",
        description: "Possibly the most massive black hole known. Its mass comes from modelling the galaxy around it and hasn't been measured directly"
    },
    {
        name: "J0529-4351",
        type: "blackhole",
        subtype: "supermassive",
        distance: 12000000000 * LY, // 12 billion LY
        direction: { x: -12.34, y: 89.01, z: -45.67 },
        radius: 50000000000, // km (Schwarzschild radius ~50 billion km)
        displayRadius: 22,
        color: 0x000000,
        accretionColor: 0xFFFFFF,
        mass: "17 × 10⁹ Solar masses",
        temperature: "Extremely luminous quasar",
        description: "Fastest-growing black hole known, consuming over a solar mass per day"
    },
    {
        name: "Gaia BH1",
        type: "blackhole",
        subtype: "stellar",
        distance: 1560 * LY,
        direction: { x: 12.34, y: -8.9, z: 7.65 },
        radius: 28, // km
        displayRadius: 10,
        color: 0x000000,
        accretionColor: 0x4466FF,
        mass: "9.6 Solar masses",
        temperature: "In binary with Sun-like star",
        description: "Closest known black hole to Earth, dormant stellar black hole"
    },
    {
        name: "Gargantua (Interstellar)",
        type: "blackhole",
        subtype: "supermassive",
        distance: 123000000 * LY,
        direction: { x: 78.9, y: -45.6, z: 23.4 },
        radius: 295000000, // km (Schwarzschild radius ~295 million km)
        displayRadius: 22,
        color: 0x000000,
        accretionColor: 0xFFDD00,
        mass: "100 × 10⁶ Solar masses",
        temperature: "Rapidly spinning (Fictional)",
        description: "Supermassive black hole in distant galaxy (Fictional/Interstellar)"
    },
    // More Giant Stars
    {
        name: "Antares",
        mass: "12 Solar masses",
        type: "star",
        spectralClass: "M1.5Iab-Ib",
        distance: 550 * LY,
        direction: { x: -15.67, y: 8.92, z: -18.34 },
        radius: 483780000, // km (~694 solar radii)
        color: 0xFF4422,
        emissive: 0xCC2200,
        emissiveIntensity: 0.85,
        temperature: "3,600 K",
        description: "Red supergiant in Scorpius, 'rival of Mars' due to red color"
    },
    {
        name: "Arcturus",
        mass: "1.08 Solar masses",
        type: "star",
        spectralClass: "K0III",
        distance: 36.7 * LY,
        direction: { x: -8.5, y: 22.3, z: -15.2 },
        radius: 25340000, // km (~36 solar radii)
        color: 0xFFAA44,
        emissive: 0xDD8822,
        emissiveIntensity: 0.9,
        temperature: "4,286 K",
        description: "Brightest star in northern hemisphere, orange giant"
    },
    {
        name: "Aldebaran",
        type: "star",
        spectralClass: "K5III",
        distance: 65.3 * LY,
        direction: { x: 18.9, y: 12.4, z: -32.1 },
        radius: 61128000, // km (~88 solar radii)
        color: 0xFF8844,
        emissive: 0xDD6622,
        emissiveIntensity: 0.88,
        temperature: "3,900 K",
        description: "Red giant eye of Taurus the bull"
    },
    {
        name: "Stephenson 2-18",
        mass: "Not measured",
        type: "star",
        spectralClass: "M6",
        distance: 18900 * LY,
        direction: { x: -67.8, y: 45.2, z: -23.1 },
        radius: 1497131000, // km (~2,150 solar radii) - currently the largest known
        color: 0xFF3311,
        emissive: 0xAA1100,
        emissiveIntensity: 0.7,
        temperature: "3,200 K",
        description: "One of the largest known stars. About 2,150 times wider than the Sun (a 2026 study puts it nearer 1,840), but so thin that it would weigh only a few tens of Suns at most. Its mass has never been measured."
    },
    {
        name: "UY Scuti",
        mass: "7-10 Solar masses",
        type: "star",
        spectralClass: "M4Ia",
        distance: 9500 * LY,
        direction: { x: 52.3, y: -78.4, z: 15.2 },
        radius: 633000000, // km (~909 solar radii) - measurements revised down
        color: 0xFF4422,
        emissive: 0xCC2200,
        emissiveIntensity: 0.75,
        temperature: "3,365 K",
        description: "Former record holder for largest known star, red supergiant"
    },
    {
        name: "VY Canis Majoris",
        type: "star",
        spectralClass: "M2.5-M5Ia",
        distance: 3900 * LY,
        direction: { x: -12.5, y: -36.8, z: 5.3 },
        radius: 988280000, // km (~1,420 solar radii)
        color: 0xFF5533,
        emissive: 0xDD3311,
        emissiveIntensity: 0.8,
        temperature: "3,490 K",
        description: "Massive red hypergiant, one of largest and most luminous"
    },
    {
        name: "WOH G64",
        type: "star",
        spectralClass: "M7.5I",
        distance: 163000 * LY,
        direction: { x: -112.4, y: -85.6, z: -47.2 },
        radius: 1073000000, // km (~1,540 solar radii) - highly variable
        color: 0xFF3311,
        emissive: 0xAA1100,
        emissiveIntensity: 0.7,
        temperature: "3,200 K",
        description: "Red supergiant in Large Magellanic Cloud, highly variable size"
    },
    {
        name: "R136a1",
        type: "star",
        spectralClass: "WN5h",
        distance: 163000 * LY,
        direction: { x: -112.5, y: -85.7, z: -47.3 },
        radius: 27000000, // km (~39 solar radii)
        color: 0x99BBFF,
        emissive: 0x77AAFF,
        emissiveIntensity: 1.5,
        mass: "~250-300 Solar masses",
        temperature: "46,000 K",
        description: "Most massive and luminous known star, Wolf-Rayet star in Large Magellanic Cloud"
    },
    {
        name: "VV Cephei A",
        type: "star",
        spectralClass: "M2Iab",
        distance: 5100 * LY,
        direction: { x: 28.9, y: 42.1, z: 12.7 },
        radius: 1050000000, // km (~1,050-1,900 solar radii)
        color: 0xFF4422,
        emissive: 0xCC2200,
        emissiveIntensity: 0.75,
        temperature: "3,826 K",
        description: "Red supergiant in eclipsing binary system"
    },
    {
        name: "Mu Cephei",
        type: "star",
        spectralClass: "M2Ia",
        distance: 6000 * LY,
        direction: { x: 35.2, y: 47.8, z: -8.3 },
        radius: 877400000, // km (~1,260 solar radii)
        color: 0xFF3322,
        emissive: 0xBB1100,
        emissiveIntensity: 0.7,
        temperature: "3,690 K",
        description: "Herschel's Garnet Star, one of reddest visible stars"
    },
    {
        name: "KY Cygni",
        type: "star",
        spectralClass: "M3.5Ia",
        distance: 5000 * LY,
        direction: { x: -25.3, y: 42.6, z: 14.8 },
        radius: 719300000, // km (~1,033 solar radii)
        color: 0xFF4411,
        emissive: 0xCC2200,
        emissiveIntensity: 0.75,
        temperature: "3,550 K",
        description: "Red supergiant, one of largest and most luminous stars"
    },
    {
        name: "V354 Cephei",
        type: "star",
        spectralClass: "M2Ia",
        distance: 9000 * LY,
        direction: { x: 48.7, y: 65.2, z: -22.1 },
        radius: 738800000, // km (~1,061 solar radii)
        color: 0xFF3311,
        emissive: 0xBB1100,
        emissiveIntensity: 0.7,
        temperature: "3,650 K",
        description: "Red supergiant with extreme luminosity"
    },
    {
        name: "RW Cephei",
        type: "star",
        spectralClass: "K2.5Iab-Ib",
        distance: 11800 * LY,
        direction: { x: 62.4, y: 78.3, z: -35.7 },
        radius: 683100000, // km (~981 solar radii)
        color: 0xFF6633,
        emissive: 0xDD4411,
        emissiveIntensity: 0.75,
        temperature: "4,015 K",
        description: "Orange-red hypergiant with pulsating brightness"
    },

    {
        name: "Westerlund 1-26",
        type: "star",
        spectralClass: "M5Ia",
        distance: 11800 * LY,
        direction: { x: -34.5, y: 67.8, z: -12.3 },
        radius: 811200000, // km (~1,165 solar radii)
        color: 0xFF4422,
        emissive: 0xCC2200,
        emissiveIntensity: 0.72,
        temperature: "3,600 K",
        description: "Red supergiant in Westerlund 1 super star cluster"
    },
    {
        name: "Deneb",
        type: "star",
        spectralClass: "A2Ia",
        distance: 2615 * LY,
        direction: { x: 23.4, y: 89.1, z: 12.5 },
        radius: 140268000, // km (~201 solar radii)
        color: 0xEEDDFF,
        emissive: 0xDDCCFF,
        emissiveIntensity: 1.4,
        temperature: "8,525 K",
        description: "Brightest star in Cygnus, white supergiant"
    },
    {
        name: "Spica",
        type: "star",
        spectralClass: "B1III-IV",
        distance: 250 * LY,
        direction: { x: 56.7, y: -34.5, z: -67.8 },
        radius: 10584000, // km (~15 solar radii)
        color: 0xDDDDFF,
        emissive: 0xBBBBFF,
        emissiveIntensity: 1.5,
        temperature: "22,400 K",
        description: "Brightest star in Virgo, blue giant binary system"
    },
    {
        name: "Polaris",
        type: "star",
        spectralClass: "F7Ib",
        distance: 433 * LY,
        direction: { x: 12.3, y: 78.9, z: -56.7 },
        radius: 52243200, // km (~75 solar radii)
        color: 0xFFFFDD,
        emissive: 0xFFEECC,
        emissiveIntensity: 1.1,
        temperature: "6,015 K",
        description: "North Star, yellow supergiant, Cepheid variable"
    },
    // More Deep Space Objects
    {
        name: "Triangulum Galaxy",
        type: "galaxy",
        subtype: "spiral",
        distance: 2720000 * LY,
        direction: { x: -145.2, y: 89.3, z: -112.7 },
        radius: 60000000000, // ~60,000 ly
        displayRadius: 35,
        color: 0xDDDDCC,
        emissive: 0xCCCCBB,
        emissiveIntensity: 0.35,
        temperature: "Billions of stars",
        description: "Third largest galaxy in Local Group"
    },
    {
        name: "Whirlpool Galaxy",
        type: "galaxy",
        subtype: "spiral",
        distance: 23000000 * LY,
        direction: { x: 234.5, y: -178.9, z: 67.2 },
        radius: 38000000000, // ~38,000 ly
        displayRadius: 30,
        color: 0xDDDDCC,
        emissive: 0xCCCCBB,
        emissiveIntensity: 0.4,
        temperature: "Star-forming galaxy",
        description: "Classic spiral galaxy with companion"
    },
    {
        name: "Sombrero Galaxy",
        type: "galaxy",
        subtype: "lenticular",
        distance: 29350000 * LY,
        direction: { x: -189.4, y: 234.8, z: -45.6 },
        radius: 25000000000, // ~25,000 ly
        displayRadius: 28,
        color: 0xCCCCAA,
        emissive: 0xBBBB99,
        emissiveIntensity: 0.35,
        temperature: "Supermassive black hole center",
        description: "Unusual galaxy with prominent dust lane"
    },
    {
        name: "Ring Nebula",
        type: "nebula",
        subtype: "planetary",
        distance: 2287 * LY,
        direction: { x: 45.6, y: 67.8, z: 23.4 },
        radius: 12000000,
        displayRadius: 15,
        color: 0x88AAFF,
        emissive: 0x6699FF,
        emissiveIntensity: 0.4,
        temperature: "White dwarf remnant",
        description: "Planetary nebula, dying star remnant"
    },
    {
        name: "Eagle Nebula",
        type: "nebula",
        subtype: "diffuse",
        distance: 7000 * LY,
        direction: { x: -78.9, y: 56.7, z: -34.5 },
        radius: 35000000,
        displayRadius: 22,
        color: 0xFFCC99,
        emissive: 0xFFBB88,
        emissiveIntensity: 0.35,
        temperature: "Pillars of Creation",
        description: "Famous star-forming region with pillars"
    },
    {
        name: "Omega Centauri",
        type: "cluster",
        subtype: "globular",
        distance: 15800 * LY,
        direction: { x: 123.4, y: -89.0, z: 45.6 },
        radius: 75000000,
        displayRadius: 25,
        color: 0xFFFFEE,
        emissive: 0xFFFEDD,
        emissiveIntensity: 0.6,
        temperature: "10 million stars",
        description: "Largest globular cluster in Milky Way"
    },
    {
        name: "Hercules Cluster",
        type: "cluster",
        subtype: "globular",
        distance: 22200 * LY,
        direction: { x: -156.7, y: 78.9, z: -123.4 },
        radius: 42000000,
        displayRadius: 20,
        color: 0xFFFFDD,
        emissive: 0xFFEECC,
        emissiveIntensity: 0.55,
        temperature: "1 million stars",
        description: "Bright globular cluster in Hercules"
    },
    {
        name: "Vela Pulsar",
        type: "neutronstar",
        spectralClass: "Pulsar",
        distance: 936 * LY,
        direction: { x: -45.6, y: 34.5, z: -78.9 },
        radius: 12, // km
        displayRadius: 8,
        color: 0xDDFFFF,
        emissive: 0xAAFFFF,
        emissiveIntensity: 0.9,
        mass: "1.4 Solar masses",
        temperature: "~1,000,000 K",
        description: "Young pulsar with supernova remnant"
    },
    {
        name: "Gemma (Alpha Coronae Borealis)",
        type: "star",
        spectralClass: "A0V",
        distance: 75 * LY,
        direction: { x: 23.4, y: 56.7, z: 12.3 },
        radius: 2080000, // km (~3 solar radii)
        color: 0xDDEEFF,
        emissive: 0xCCDDFF,
        emissiveIntensity: 1.3,
        temperature: "9,700 K",
        description: "Brightest star in Northern Crown constellation"
    },
    {
        name: "Fomalhaut",
        type: "star",
        spectralClass: "A3V",
        distance: 25 * LY,
        direction: { x: 12.3, y: -23.4, z: 5.6 },
        radius: 1243200, // km (~1.8 solar radii)
        color: 0xDDEEFF,
        emissive: 0xCCDDFF,
        emissiveIntensity: 1.25,
        temperature: "8,590 K",
        description: "Lonely bright star with debris disk, exoplanet candidate"
    },
    {
        name: "LHS 1140",
        mass: "0.184 Solar masses",
        type: "star",
        spectralClass: "M4.5V",
        distance: 48.88 * LY,
        direction: { x: 0.9461, y: -0.2634, z: 0.1882 },
        radius: 150340, // km (0.2159 solar radii)
        color: 0xFF5533,
        emissive: 0xCC3311,
        temperature: "3,096 K",
        description: "Nearby cool red dwarf hosting the temperate super-Earth LHS 1140 b",
        children: [
            {
                name: "LHS 1140 b",
                mass: "5.60 Earth masses",
                type: "planet",
                radius: 11022, // km (1.730 Earth radii)
                distance: 0.0946 * AU,
                orbitalPeriod: 24.73723,
                color: 0x527FA3,
                temperature: "226 K equilibrium",
                description: "Temperate transiting super-Earth in the habitable zone; observations suggest it may be water-rich, but its atmosphere and surface remain uncertain"
            }
        ]
    },
    {
        name: "Castor",
        type: "star",
        spectralClass: "A1V",
        distance: 51 * LY,
        direction: { x: -34.5, y: 45.6, z: -23.4 },
        radius: 1392000, // km (~2 solar radii)
        color: 0xDDEEFF,
        emissive: 0xCCDDFF,
        emissiveIntensity: 1.3,
        temperature: "10,286 K",
        description: "Famous multiple star system (6 stars!)",
        children: [
            {
                name: "Castor Aa",
                type: "planet",
                radius: 60000, // hypothetical
                distance: 0.1 * AU,
                orbitalPeriod: 9.2,
                color: 0x666688,
                description: "Hypothetical companion"
            }
        ]
    },
    {
        name: "Pollux",
        type: "star",
        spectralClass: "K0III",
        distance: 33.78 * LY,
        direction: { x: 45.6, y: -34.5, z: 23.4 },
        radius: 6100000, // km (~8.8 solar radii)
        color: 0xFFCC88,
        emissive: 0xFFBB66,
        emissiveIntensity: 1.0,
        temperature: "4,666 K",
        description: "Orange giant with confirmed exoplanet (Thestias)",
        children: [
            {
                name: "Thestias",
                type: "planet",
                radius: 80000,
                distance: 1.64 * AU,
                orbitalPeriod: 589.6,
                color: 0xCC6633,
                description: "Gas giant, 2.3x Jupiter mass"
            }
        ]
    }
];

// Size comparison data - objects arranged from smallest to largest for size comparison view
// Starting with Earth, then Sun, then progressively larger stars
export const sizeComparison = [
    {
        name: "Gaia BH1",
        type: "blackhole",
        radius: 28, // km
        color: 0x000000,
        accretionColor: 0x4466FF,
        mass: "9.6 Solar masses",
        temperature: "In binary with Sun-like star",
        description: "Closest known black hole to Earth, dormant stellar black hole"
    },
    {
        name: "Mercury",
        type: "planet",
        radius: 2439.7, // km
        color: 0x8C8C8C,
        mass: "3.3011 × 10²³ kg",
        temperature: "-180 to 430 °C",
        description: "Smallest planet in our solar system, closest to the Sun"
    },
    {
        name: "Mars",
        type: "planet",
        radius: 3389.5, // km
        color: 0xDD4422,
        mass: "6.4171 × 10²³ kg",
        temperature: "-62 °C (aver)",
        description: "The Red Planet, home to Olympus Mons, the tallest volcano in the solar system"
    },
    {
        name: "Venus",
        type: "planet",
        radius: 6051.8, // km
        color: 0xE6E6B8,
        mass: "4.8675 × 10²⁴ kg",
        temperature: "462 °C (aver)",
        description: "Hottest planet in the solar system with a thick, toxic greenhouse atmosphere"
    },
    {
        name: "Earth",
        type: "planet",
        radius: 6371, // km
        color: 0x2233FF,
        hasAtmosphere: true,
        atmosphereColor: 0x88AAFF,
        mass: "5.972 × 10²⁴ kg",
        temperature: "15 °C (aver)",
        description: "Our home planet, the only known planet with life"
    },
    {
        name: "Neptune",
        type: "planet",
        radius: 24622, // km
        color: 0x4444FF,
        mass: "1.02413 × 10²⁶ kg",
        temperature: "-200 °C (aver)",
        description: "Windiest planet in the solar system, a deep blue ice giant"
    },
    {
        name: "Uranus",
        type: "planet",
        radius: 25362, // km
        color: 0x99DDDD,
        mass: "8.6810 × 10²⁵ kg",
        temperature: "-195 °C (aver)",
        description: "Ice giant tilted nearly 98 degrees on its side, orbiting the Sun horizontally"
    },
    {
        name: "Saturn",
        type: "planet",
        radius: 58232, // km
        color: 0xE8DCC0,
        hasRings: true,
        mass: "5.6834 × 10²⁶ kg",
        temperature: "-140 °C (aver)",
        description: "Gas giant famous for its massive, spectacular ring system"
    },
    {
        name: "Jupiter",
        type: "planet",
        radius: 69911, // km
        color: 0xD4A574,
        hasBands: true,
        mass: "1.8982 × 10²⁷ kg",
        temperature: "-110 °C (aver)",
        description: "Largest planet in our solar system, a massive gas giant with the Great Red Spot"
    },
    {
        name: "Proxima Centauri",
        mass: "0.122 Solar masses",
        type: "star",
        spectralClass: "M5.5Ve",
        radius: 107280, // ~0.15 solar radii
        color: 0xFF4422,
        emissive: 0xBB2200,
        emissiveIntensity: 0.6,
        temperature: "3,042 K",
        description: "Closest known star to the Sun, a small red dwarf"
    },
    {
        name: "Sun",
        type: "star",
        spectralClass: "G2V",
        radius: 696340, // km
        color: 0xFFD700,
        emissive: 0xFFAA00,
        emissiveIntensity: 1,
        temperature: "5,778 K",
        description: "Our star, contains 99.86% of Solar System's mass"
    },
    {
        name: "Sirius A",
        mass: "2.06 Solar masses",
        type: "star",
        spectralClass: "A1V",
        radius: 1190000, // ~1.71 solar radii
        color: 0xDDEEFF,
        emissive: 0xAADDFF,
        emissiveIntensity: 1.5,
        temperature: "9,940 K",
        description: "Brightest star in the night sky"
    },
    {
        name: "Vega",
        type: "star",
        spectralClass: "A0V",
        radius: 1961000, // ~2.8 solar radii
        color: 0xE6F0FF,
        emissive: 0xBBDDFF,
        emissiveIntensity: 1.6,
        temperature: "9,602 K",
        description: "Bright blue-white star, once the North Star"
    },
    {
        name: "Pollux",
        type: "star",
        spectralClass: "K0III",
        radius: 6127000, // ~8.8 solar radii
        color: 0xFFCC88,
        emissive: 0xFFBB66,
        emissiveIntensity: 1.0,
        temperature: "4,666 K",
        description: "Orange giant star in Gemini"
    },
    {
        name: "Arcturus",
        mass: "1.08 Solar masses",
        type: "star",
        spectralClass: "K0III",
        radius: 17687000, // ~25.4 solar radii
        color: 0xFFAA44,
        emissive: 0xDD8822,
        emissiveIntensity: 0.9,
        temperature: "4,286 K",
        description: "Red giant, brightest star in the northern celestial hemisphere"
    },
    {
        name: "R136a1",
        type: "star",
        spectralClass: "WN5h",
        radius: 27000000, // ~39 solar radii
        color: 0x99BBFF,
        emissive: 0x77AAFF,
        emissiveIntensity: 1.5,
        temperature: "46,000 K",
        description: "Most massive and luminous known star, Wolf-Rayet star"
    },
    {
        name: "Aldebaran",
        type: "star",
        spectralClass: "K5III",
        radius: 30778000, // ~44 solar radii
        color: 0xFF9955,
        emissive: 0xDD6622,
        emissiveIntensity: 0.9,
        temperature: "3,910 K",
        description: "The 'Eye of Taurus', a huge orange giant"
    },
    {
        name: "Rigel",
        mass: "21 Solar masses",
        type: "star",
        spectralClass: "B8 Ia",
        radius: 54941000, // ~79 solar radii
        color: 0xAACCFF,
        emissive: 0x99BBFF,
        emissiveIntensity: 2.0,
        temperature: "12,100 K",
        description: "Blue supergiant, brightest star in Orion"
    },
    {
        name: "Deneb",
        type: "star",
        spectralClass: "A2 Ia",
        radius: 141360000, // ~203 solar radii
        color: 0xDDEEFF,
        emissive: 0xCCDDEE,
        emissiveIntensity: 1.8,
        temperature: "8,525 K",
        description: "Blue-white supergiant, farthest first-magnitude star"
    },
    {
        name: "Pistol Star",
        type: "star",
        spectralClass: "LBV",
        radius: 213000000, // ~306 solar radii
        color: 0x99CCFF,
        emissive: 0x77AAFF,
        emissiveIntensity: 1.7,
        temperature: "11,800 K",
        description: "Luminous Blue Variable, one of the most luminous stars known"
    },
    {
        name: "Gargantua (Interstellar)",
        type: "blackhole",
        radius: 295000000
    },
    {
        name: "Antares",
        type: "star",
        radius: 483780000
    },
    {
        name: "Betelgeuse",
        type: "star",
        radius: 617100000
    },
    {
        name: "VY Canis Majoris",
        type: "star",
        radius: 988800000
    },
    {
        name: "UY Scuti",
        type: "star",
        radius: 1183000000
    },
    {
        name: "Stephenson 2-18",
        mass: "Not measured",
        type: "star",
        radius: 1497131000
    },
    {
        name: "M87*",
        type: "blackhole",
        radius: 19175000000
    },
    {
        name: "J0529-4351",
        type: "blackhole",
        radius: 50000000000
    },
    {
        name: "TON 618",
        type: "blackhole",
        radius: 120200000000
    },
    {
        name: "Phoenix A*",
        type: "blackhole",
        radius: 295000000000
    }
];

export function raDecToAppFrame(raDeg, decDeg) {
    const raRad = raDeg * Math.PI / 180;
    const decRad = decDeg * Math.PI / 180;
    
    const x = Math.cos(decRad) * Math.cos(raRad);
    const y = Math.cos(decRad) * Math.sin(raRad);
    const z = Math.sin(decRad);
    
    const eps = 23.4393 * Math.PI / 180;
    const cosE = Math.cos(eps);
    const sinE = Math.sin(eps);
    
    const xe = x;
    const ye = y * cosE + z * sinE;
    const ze = -y * sinE + z * cosE;
    
    return { x: xe, y: ze, z: -ye };
}

const REAL_STAR_COORDS = {
    "Proxima Centauri": { ra: 217.42, dec: -62.68 },
    "Alpha Centauri A": { ra: 219.9, dec: -60.83 },
    "Alpha Centauri B": { ra: 219.9, dec: -60.83 },
    "Barnard's Star": { ra: 269.45, dec: 4.67 },
    "Wolf 359": { ra: 164.12, dec: 7.01 },
    "Lalande 21185": { ra: 165.83, dec: 35.97 },
    "Sirius A": { ra: 101.29, dec: -16.73 },
    "Sirius B": { ra: 101.29, dec: -16.73 },
    "Luyten 726-8 A": { ra: 26.23, dec: -17.95 },
    "Luyten 726-8 B": { ra: 26.23, dec: -17.95 },
    "Ross 154": { ra: 282.46, dec: -23.83 },
    "Ross 248": { ra: 355.48, dec: 44.17 },
    "Epsilon Eridani": { ra: 53.23, dec: -9.46 },
    "Lacaille 9352": { ra: 346.47, dec: -35.85 },
    "Ross 128": { ra: 176.93, dec: 0.8 },
    "Procyon A": { ra: 114.83, dec: 5.22 },
    "Procyon B": { ra: 114.83, dec: 5.22 },
    "61 Cygni A": { ra: 316.72, dec: 38.74 },
    "61 Cygni B": { ra: 316.72, dec: 38.74 },
    "Epsilon Indi": { ra: 330.44, dec: -56.79 },
    "Tau Ceti": { ra: 26.02, dec: -15.93 },
    "YZ Ceti": { ra: 18.23, dec: -16.99 },
    "Luyten's Star": { ra: 111.43, dec: 5.22 },
    "Teegarden's Star": { ra: 43.23, dec: 16.88 },
    "Kapteyn's Star": { ra: 77.92, dec: -45.02 },
    "Altair": { ra: 297.7, dec: 8.87 },
    "Vega": { ra: 279.23, dec: 38.78 },
    "Sagittarius A*": { ra: 266.42, dec: -29.01 },
    "Cygnus X-1": { ra: 299.59, dec: 35.2 },
    "V616 Monocerotis": { ra: 99.89, dec: -0.35 },
    "Crab Pulsar": { ra: 83.63, dec: 22.01 },
    "Betelgeuse": { ra: 88.79, dec: 7.41 },
    "Rigel": { ra: 78.63, dec: -8.2 },
    "Pleiades Cluster": { ra: 56.75, dec: 24.12 },
    "Orion Nebula": { ra: 83.82, dec: -5.39 },
    "Andromeda Galaxy": { ra: 10.68, dec: 41.27 },
    "M87*": { ra: 187.7, dec: 12.4 },
    "TON 618": { ra: 186.2, dec: 20.8 },
    "Phoenix A*": { ra: 8.35, dec: -42.4 },
    "J0529-4351": { ra: 82.35, dec: -43.85 },
    "Gaia BH1": { ra: 97.44, dec: -0.01 },
    "Gargantua (Interstellar)": { ra: 266.42, dec: -29.01 },
    "Antares": { ra: 247.35, dec: -26.43 },
    "Arcturus": { ra: 213.92, dec: 19.18 },
    "Aldebaran": { ra: 68.98, dec: 16.51 },
    "Stephenson 2-18": { ra: 283.42, dec: -13.01 },
    "UY Scuti": { ra: 281.9, dec: -12.45 },
    "VY Canis Majoris": { ra: 110.82, dec: -25.77 },
    "WOH G64": { ra: 74.83, dec: -69.15 },
    "R136a1": { ra: 84.68, dec: -69.1 },
    "VV Cephei A": { ra: 329.88, dec: 62.58 },
    "Mu Cephei": { ra: 327.93, dec: 58.78 },
    "KY Cygni": { ra: 307.23, dec: 38.35 },
    "V354 Cephei": { ra: 337.03, dec: 58.55 },
    "RW Cephei": { ra: 336.03, dec: 56.95 },
    "Westerlund 1-26": { ra: 250.32, dec: -45.9 },
    "Deneb": { ra: 310.36, dec: 45.28 },
    "Spica": { ra: 201.3, dec: -11.16 },
    "Polaris": { ra: 37.95, dec: 89.26 },
    "Triangulum Galaxy": { ra: 23.46, dec: 30.66 },
    "Whirlpool Galaxy": { ra: 202.48, dec: 47.2 },
    "Sombrero Galaxy": { ra: 192.48, dec: -11.62 },
    "Ring Nebula": { ra: 283.4, dec: 33.03 },
    "Eagle Nebula": { ra: 274.7, dec: -13.8 },
    "Omega Centauri": { ra: 201.7, dec: -47.48 },
    "Hercules Cluster": { ra: 250.42, dec: 36.46 },
    "Vela Pulsar": { ra: 128.84, dec: -45.18 },
    "Gemma (Alpha Coronae Borealis)": { ra: 233.68, dec: 26.71 },
    "Fomalhaut": { ra: 344.41, dec: -29.62 },
    "LHS 1140": { ra: 11.248625, dec: -15.274108 },
    "Castor": { ra: 113.65, dec: 31.89 },
    "Pollux": { ra: 116.33, dec: 28.02 }
};

export function calculateStarPosition(starData) {
    if (!starData.direction) return { x: 0, y: 0, z: 0 };
    
    let x, y, z;
    const realCoord = REAL_STAR_COORDS[starData.name];
    if (realCoord) {
        const appVec = raDecToAppFrame(realCoord.ra, realCoord.dec);
        x = appVec.x;
        y = appVec.y;
        z = -appVec.z;
    } else {
        x = starData.direction.x;
        y = starData.direction.y;
        z = starData.direction.z;
    }
    
    const mag = Math.sqrt(x*x + y*y + z*z);
    
    if (mag === 0) return { x: 0, y: 0, z: 0 };
    
    // Default to the original vector magnitude if distance is not explicitly set
    let distanceInLY = mag;
    if (starData.distance !== undefined) {
        distanceInLY = starData.distance / LY;
    }
    
    return {
        x: (x / mag) * distanceInLY,
        y: (y / mag) * distanceInLY,
        z: -(z / mag) * distanceInLY
    };
}

// One short "did you know" line per object, shown in the hover tooltip and
// the info panel. Keep each to a sentence.
export const BLACK_HOLE_SHADOW_FACT = "Its black shadow looks about 2.6× wider than the event horizon: gravity bends nearby light into it.";
export const OBJECT_FACTS = {
    "Milky Way": "Holds some 100–400 billion stars; the Sun takes about 230 million years to go around it once.",
    "Solar System": "Formed about 4.6 billion years ago from a collapsing cloud of gas and dust.",
    "Sun": "Holds 99.8% of the Solar System's mass; its light takes about 8 minutes to reach us.",
    "Mercury": "A year there (88 days) is shorter than one sunrise-to-sunrise day (176 days).",
    "Venus": "The hottest planet (~465 °C), and it spins backwards: the Sun rises in the west.",
    "Earth": "The only place we know of with life, and the densest planet in the Solar System.",
    "Moon": "Drifting away from Earth by about 3.8 cm a year.",
    "Mars": "Home to Olympus Mons, a volcano nearly three times taller than Everest.",
    "Phobos": "Spiralling inward: in about 50 million years it will hit Mars or break up into a ring.",
    "Deimos": "So small you could jump off it: its escape speed is only about 20 km/h.",
    "Jupiter": "Its Great Red Spot is a storm wider than Earth that has raged for centuries.",
    "Io": "The most volcanic world known, with hundreds of active volcanoes.",
    "Europa": "Its ocean under the ice may hold about twice as much water as all of Earth's oceans.",
    "Ganymede": "The largest moon in the Solar System, bigger than the planet Mercury.",
    "Callisto": "Has one of the most heavily cratered surfaces in the Solar System.",
    "Saturn": "Less dense than water, and its main rings are mostly just tens of metres thick.",
    "Titan": "The only moon with a thick atmosphere, and it has lakes of liquid methane.",
    "Enceladus": "Sprays geysers of ocean water into space from cracks at its south pole.",
    "Uranus": "Tipped on its side: each pole gets 42 years of sunlight, then 42 years of darkness.",
    "Neptune": "The windiest planet, with gusts over 2,000 km/h.",
    "Pluto": "Has a giant heart-shaped glacier of nitrogen ice, seen by New Horizons in 2015.",
    "Eris": "About the size of Pluto; finding it led to Pluto's reclassification in 2006.",
    "Makemake": "Discovered just after Easter 2005 and named after the Rapa Nui creator god.",
    "Haumea": "Spins every 4 hours, which stretches it into an egg shape, and it has a ring.",
    "Ceres": "The largest object in the asteroid belt, with bright salt deposits in its craters.",
    "Apophis": "Will pass Earth on 13 April 2029, closer than some satellites, visible to the naked eye.",
    "Halley's Comet": "Comes back every ~76 years; its next visit is in 2061.",
    "ʻOumuamua": "The first known interstellar object (2017), long and thin and tumbling end over end.",
    "2I/Borisov": "The first interstellar comet, found by an amateur astronomer in 2019.",
    "3I/ATLAS": "The third known visitor from another star system, discovered in July 2025.",
    "Voyager 1": "The farthest human-made object, in interstellar space since 2012.",
    "Voyager 2": "The only spacecraft ever to visit Uranus and Neptune.",
    "New Horizons": "Reached Pluto in 2015 after a 9½-year journey.",
    "Proxima Centauri": "The nearest star to the Sun, a red dwarf too faint to see without a telescope.",
    "Proxima Centauri b": "The closest known exoplanet, orbiting in its star's habitable zone.",
    "Alpha Centauri A": "The nearest Sun-like star, a little bigger and brighter than the Sun.",
    "Alpha Centauri B": "Circles Alpha Centauri A every 80 years; together they're our 3rd-brightest star.",
    "Barnard's Star": "Crosses our sky faster than any other star: a Moon's width every 180 years.",
    "Wolf 359": "Where Starfleet lost its famous battle against the Borg in Star Trek.",
    "Lalande 21185": "One of the brightest red dwarfs in our sky, yet still too faint to see by eye.",
    "Sirius A": "The brightest star in the night sky, only 8.6 light-years away.",
    "Sirius B": "A white dwarf: about a Sun's worth of mass packed into a ball the size of Earth.",
    "Luyten 726-8 A": "A flare star: it and its partner UV Ceti can brighten dramatically within minutes.",
    "Luyten 726-8 B": "Better known as UV Ceti, the star that gave flare stars their name.",
    "Ross 248": "In about 36,000 years it will be the closest star to the Sun.",
    "Epsilon Eridani": "A young Sun-like star with dusty rings, like a younger Solar System.",
    "Ross 128": "One of the calmest nearby red dwarfs, with a temperate Earth-sized planet.",
    "Procyon A": "Its name means 'before the dog': it rises just before Sirius, the Dog Star.",
    "Procyon B": "A faint white dwarf companion, first seen through a telescope in 1896.",
    "61 Cygni A": "The first star to have its distance measured, by Friedrich Bessel in 1838.",
    "Epsilon Indi": "Has a pair of brown dwarfs orbiting far out from it.",
    "Tau Ceti": "A nearby Sun-like star that turns up again and again in science fiction.",
    "Teegarden's Star": "Hosts two of the most Earth-like planets known.",
    "Kapteyn's Star": "An ancient star that orbits the Milky Way backwards.",
    "Altair": "Spins so fast (about every 9 hours) that it bulges ~20% wider at the equator.",
    "Vega": "Will be our north star in about 12,000 years.",
    "Sagittarius A*": "Photographed in 2022; the dark centre is its shadow, about 2.6× wider than the event horizon.",
    "Cygnus X-1": "The first object widely accepted as a black hole, in the early 1970s.",
    "V616 Monocerotis": "Among the closest black holes known; it pulls gas off a companion star.",
    "Gaia BH1": "The closest known black hole, found in 2022 by the way it tugs a Sun-like star.",
    "M87*": "The first black hole ever photographed (2019); the dark centre is its shadow, ~2.6× the event horizon.",
    "TON 618": "One of the most massive black holes known; its quasar outshines whole galaxies.",
    "Phoenix A*": "Possibly the most massive black hole known, at the heart of the Phoenix galaxy cluster.",
    "J0529-4351": "Powers the brightest quasar known, swallowing about a Sun's worth of gas every day.",
    "Gargantua (Interstellar)": "The black hole from Interstellar, rendered with help from physicist Kip Thorne.",
    "Crab Pulsar": "Spins 30 times a second: the core left by a supernova seen from Earth in 1054.",
    "Vela Pulsar": "Spins 11 times a second, and now and then 'glitches', suddenly spinning faster.",
    "Betelgeuse": "A red supergiant expected to explode as a supernova within about 100,000 years.",
    "Rigel": "A blue supergiant around 100,000 times as bright as the Sun.",
    "Pleiades Cluster": "The Seven Sisters: young stars drifting through a faint blue dust cloud.",
    "Orion Nebula": "The nearest big star nursery, visible by eye as the middle of Orion's sword.",
    "Andromeda Galaxy": "Heading for a merger with the Milky Way in about 4.5 billion years.",
    "Antares": "Its name means 'rival of Mars', for its deep red colour.",
    "Arcturus": "The brightest star in the northern half of the sky.",
    "Aldebaran": "The red eye of Taurus the Bull; the Pioneer 10 probe is drifting its way.",
    "Stephenson 2-18": "One of the largest stars known: put in place of the Sun, it would reach past Saturn.",
    "UY Scuti": "So big that light would take about 7 hours to travel once around it.",
    "VY Canis Majoris": "A dying hypergiant throwing off enormous clouds of gas and dust.",
    "WOH G64": "A giant in another galaxy (the LMC), recently caught turning into a yellow hypergiant.",
    "R136a1": "The most massive star known, roughly 200–300 times the mass of the Sun.",
    "VV Cephei A": "A red supergiant spilling gas onto a hot blue companion star.",
    "Mu Cephei": "Herschel's 'Garnet Star', one of the reddest stars you can see by eye.",
    "KY Cygni": "One of the largest stars in the Milky Way, hidden behind thick dust.",
    "RW Cephei": "Dimmed dramatically in 2022–23 after puffing out a cloud of dust.",
    "Westerlund 1-26": "Lives in Westerlund 1, the most massive young star cluster in the Milky Way.",
    "Deneb": "One of the farthest stars you can see by eye, about 2,600 light-years away.",
    "Spica": "Really two hot stars orbiting so closely that they squash each other into egg shapes.",
    "Polaris": "Sits within a degree of the north celestial pole, so it barely moves in our sky.",
    "Triangulum Galaxy": "Under very dark skies, one of the farthest things you can see by eye.",
    "Whirlpool Galaxy": "Its spiral arms are being stirred up by a smaller galaxy tugging on it.",
    "Sombrero Galaxy": "A bright core and a dark lane of dust make it look like a wide-brimmed hat.",
    "Ring Nebula": "Glowing gas puffed off by a dying Sun-like star.",
    "Eagle Nebula": "Home of the Pillars of Creation, towers of gas where new stars are forming.",
    "Omega Centauri": "About 10 million stars; possibly the core of a small galaxy the Milky Way swallowed.",
    "Hercules Cluster": "Target of the Arecibo radio message, sent in 1974.",
    "Gemma (Alpha Coronae Borealis)": "The brightest star in Corona Borealis, the Northern Crown.",
    "Fomalhaut": "Surrounded by a wide ring of dust imaged by Hubble and JWST.",
    "LHS 1140 b": "A super-Earth that may be an ocean world or a frozen 'snowball' planet.",
    "Castor": "Looks like one star, but it's really six stars in three pairs.",
    "Pollux": "The nearest giant star to the Sun, with a planet of its own.",
    "Thestias": "A giant planet a little over twice Jupiter's mass, orbiting Pollux.",
    "Pistol Star": "One of the most luminous stars known; the gas it shed formed the Pistol Nebula."
};
