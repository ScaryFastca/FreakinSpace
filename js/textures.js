// Procedural Texture Generator for SpaceMap
// Generates planet and star textures using HTML5 Canvas

export function generatePlanetTexture(type, color, seed = Math.random(), name = '') {
    // Earth gets its own hand-authored texture with real continent shapes
    if (name === 'Earth') return generateEarthTexture();

    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size / 2; // Equirectangular projection
    const ctx = canvas.getContext('2d');

    const baseColor = new THREE.Color(color);

    switch(type) {
        case 'gas':
            generateGasGiantTexture(ctx, size, baseColor, seed);
            break;
        case 'rocky':
            generateRockyTexture(ctx, size, baseColor, seed);
            break;
        case 'ice':
            generateIceTexture(ctx, size, baseColor, seed);
            break;
        case 'terrestrial':
            generateTerrestrialTexture(ctx, size, baseColor, seed);
            break;
        default:
            generateGenericTexture(ctx, size, baseColor, seed);
            break;
    }

    return canvas;
}

function generateGasGiantTexture(ctx, size, baseColor, seed) {
    const width = size;
    const height = size / 2;
    
    // Create bands
    const bands = 8 + Math.floor(seededRandom(seed) * 6);
    const bandColors = [];
    
    for (let i = 0; i < bands; i++) {
        const t = i / (bands - 1);
        const variation = (seededRandom(seed + i) - 0.5) * 0.3;
        const color = baseColor.clone();
        color.offsetHSL(variation, variation * 0.5, variation * 0.3);
        bandColors.push(color);
    }
    
    // Draw bands with turbulence
    for (let y = 0; y < height; y++) {
        const bandIndex = Math.floor((y / height) * bands);
        const bandT = (y / height) * bands - bandIndex;
        
        const color1 = bandColors[Math.min(bandIndex, bands - 1)];
        const color2 = bandColors[Math.min(bandIndex + 1, bands - 1)] || color1;
        
        // Add turbulence
        const turbulence = seededNoise(y * 0.02, seed) * 20;
        const mixFactor = bandT + turbulence / height;
        
        const r = Math.floor(lerp(color1.r, color2.r, mixFactor) * 255);
        const g = Math.floor(lerp(color1.g, color2.g, mixFactor) * 255);
        const b = Math.floor(lerp(color1.b, color2.b, mixFactor) * 255);
        
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(0, y, width, 1);
    }
    
    // Add swirling storms
    const storms = 3 + Math.floor(seededRandom(seed + 100) * 5);
    for (let i = 0; i < storms; i++) {
        const sx = seededRandom(seed + i * 10) * width;
        const sy = seededRandom(seed + i * 10 + 1) * height;
        const sr = 10 + seededRandom(seed + i * 10 + 2) * 40;
        
        const gradient = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
        const stormColor = baseColor.clone().offsetHSL(0.05, 0.2, -0.1);
        gradient.addColorStop(0, `rgba(${stormColor.r*255},${stormColor.g*255},${stormColor.b*255},0.6)`);
        gradient.addColorStop(0.5, `rgba(${stormColor.r*255},${stormColor.g*255},${stormColor.b*255},0.3)`);
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fill();
    }
}

function generateRockyTexture(ctx, size, baseColor, seed) {
    const width = size;
    const height = size / 2;
    
    // Base fill
    ctx.fillStyle = `rgb(${baseColor.r*255},${baseColor.g*255},${baseColor.b*255})`;
    ctx.fillRect(0, 0, width, height);
    
    // Add craters
    const craters = 20 + Math.floor(seededRandom(seed) * 30);
    for (let i = 0; i < craters; i++) {
        const cx = seededRandom(seed + i * 3) * width;
        const cy = seededRandom(seed + i * 3 + 1) * height;
        const cr = 5 + seededRandom(seed + i * 3 + 2) * 25;
        
        // Crater shadow
        const gradient = ctx.createRadialGradient(cx - cr*0.3, cy - cr*0.3, 0, cx, cy, cr);
        const shadowColor = baseColor.clone().multiplyScalar(0.5);
        const highlightColor = baseColor.clone().multiplyScalar(1.3);
        
        gradient.addColorStop(0, `rgba(${highlightColor.r*255},${highlightColor.g*255},${highlightColor.b*255},0.3)`);
        gradient.addColorStop(0.4, `rgba(${baseColor.r*255},${baseColor.g*255},${baseColor.b*255},0)`);
        gradient.addColorStop(0.6, `rgba(${shadowColor.r*255},${shadowColor.g*255},${shadowColor.b*255},0.4)`);
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(cx, cy, cr, 0, Math.PI * 2);
        ctx.fill();
    }
    
    // Add surface noise
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const noise = (seededRandom(seed + i) - 0.5) * 30;
        data[i] = Math.max(0, Math.min(255, data[i] + noise));
        data[i+1] = Math.max(0, Math.min(255, data[i+1] + noise));
        data[i+2] = Math.max(0, Math.min(255, data[i+2] + noise));
    }
    ctx.putImageData(imageData, 0, 0);
}

function generateIceTexture(ctx, size, baseColor, seed) {
    const width = size;
    const height = size / 2;
    
    // Smooth ice gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    const c1 = baseColor.clone().multiplyScalar(1.2);
    const c2 = baseColor.clone().multiplyScalar(0.8);
    gradient.addColorStop(0, `rgb(${c1.r*255},${c1.g*255},${c1.b*255})`);
    gradient.addColorStop(1, `rgb(${c2.r*255},${c2.g*255},${c2.b*255})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    
    // Add crack patterns
    ctx.strokeStyle = `rgba(255,255,255,0.3)`;
    ctx.lineWidth = 1;
    
    const cracks = 15 + Math.floor(seededRandom(seed) * 10);
    for (let i = 0; i < cracks; i++) {
        let x = seededRandom(seed + i * 2) * width;
        let y = seededRandom(seed + i * 2 + 1) * height;
        
        ctx.beginPath();
        ctx.moveTo(x, y);
        
        const segments = 5 + Math.floor(seededRandom(seed + i) * 5);
        for (let j = 0; j < segments; j++) {
            x += (seededRandom(seed + i + j) - 0.5) * 100;
            y += (seededRandom(seed + i + j + 100) - 0.5) * 50;
            ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
}

function generateTerrestrialTexture(ctx, size, baseColor, seed) {
    // Venus / generic terrestrial — keep the old simple look
    const width = size;
    const height = size / 2;
    const oceanColor = new THREE.Color(0x1144AA);
    ctx.fillStyle = `rgb(${oceanColor.r*255},${oceanColor.g*255},${oceanColor.b*255})`;
    ctx.fillRect(0, 0, width, height);
    const continents = 4 + Math.floor(seededRandom(seed) * 3);
    for (let i = 0; i < continents; i++) {
        const cx = seededRandom(seed + i * 10) * width;
        const cy = seededRandom(seed + i * 10 + 1) * height;
        ctx.fillStyle = `rgba(${baseColor.r*255},${baseColor.g*255},${baseColor.b*255},0.9)`;
        ctx.beginPath();
        const points = 8 + Math.floor(seededRandom(seed + i) * 8);
        for (let j = 0; j <= points; j++) {
            const angle = (j / points) * Math.PI * 2;
            const r = 30 + seededNoise(j * 0.5, seed + i) * 40;
            const x = cx + Math.cos(angle) * r;
            const y = cy + Math.sin(angle) * r * 0.5;
            if (j === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    for (let i = 0; i < 12; i++) {
        const cx = seededRandom(seed + i * 7) * width;
        const cy = seededRandom(seed + i * 7 + 1) * height;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 40 + seededRandom(seed + i) * 60, 15 + seededRandom(seed + i + 1) * 20, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

// Convert geographic [lon, lat] degrees to canvas [x, y] in equirectangular projection
function ll2xy(lon, lat, W, H) {
    return [
        ((lon + 180) / 360) * W,
        ((90 - lat) / 180) * H
    ];
}

function drawContinent(ctx, coords, W, H) {
    ctx.beginPath();
    coords.forEach(([lon, lat], i) => {
        const [x, y] = ll2xy(lon, lat, W, H);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
}

export function generateEarthTexture() {
    const W = 1024, H = 512;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // ── Ocean ────────────────────────────────────────────────────────
    // Deep ocean gradient (darker near poles, slightly lighter tropics)
    const oceanGrad = ctx.createLinearGradient(0, 0, 0, H);
    oceanGrad.addColorStop(0,    '#0a1a3a');  // arctic
    oceanGrad.addColorStop(0.15, '#0d2a5e');
    oceanGrad.addColorStop(0.5,  '#1a4a8a');  // tropics
    oceanGrad.addColorStop(0.85, '#0d2a5e');
    oceanGrad.addColorStop(1,    '#0a1a3a');  // antarctic
    ctx.fillStyle = oceanGrad;
    ctx.fillRect(0, 0, W, H);

    // Subtle ocean depth noise
    const imgD = ctx.getImageData(0, 0, W, H);
    for (let i = 0; i < imgD.data.length; i += 4) {
        const n = (Math.sin(i * 0.0031) * Math.cos(i * 0.0017)) * 8;
        imgD.data[i]   = Math.max(0, Math.min(255, imgD.data[i]   + n));
        imgD.data[i+1] = Math.max(0, Math.min(255, imgD.data[i+1] + n));
        imgD.data[i+2] = Math.max(0, Math.min(255, imgD.data[i+2] + n * 0.5));
    }
    ctx.putImageData(imgD, 0, 0);

    // ── Land colours ─────────────────────────────────────────────────
    // Helper to set land colour before each continent
    function landColor(r, g, b, a = 1) {
        ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
    }

    // ── North America ────────────────────────────────────────────────
    landColor(100, 140, 75);
    drawContinent(ctx, [
        [-168,72],[-140,70],[-130,60],[-126,50],[-124,46],[-120,34],[-118,24],
        [-104,20],[-88,16],[-84,10],[-78,8],[-76,9],[-80,12],[-82,18],[-88,22],
        [-90,18],[-88,16],[-84,24],[-80,32],[-80,36],[-75,38],[-72,42],[-68,48],
        [-60,46],[-54,48],[-52,46],[-56,44],[-62,44],[-64,48],[-66,50],[-70,54],
        [-78,58],[-80,62],[-84,64],[-90,68],[-100,70],[-110,70],[-120,72],
        [-130,72],[-140,70],[-160,72],[-168,72]
    ], W, H);

    // Alaska peninsula
    landColor(95, 135, 70);
    drawContinent(ctx, [
        [-168,72],[-164,66],[-158,58],[-152,58],[-148,60],[-152,62],
        [-158,62],[-160,64],[-164,66],[-168,68],[-168,72]
    ], W, H);

    // Greenland
    landColor(200, 220, 230);
    drawContinent(ctx, [
        [-72,84],[-44,84],[-20,76],[-20,68],[-24,64],[-42,60],[-50,58],
        [-54,60],[-58,64],[-60,68],[-64,72],[-68,76],[-72,80],[-72,84]
    ], W, H);

    // ── South America ────────────────────────────────────────────────
    landColor(90, 150, 60);
    drawContinent(ctx, [
        [-80,12],[-76,8],[-72,12],[-68,12],[-62,4],[-52,-4],[-48,-8],
        [-36,-10],[-34,-12],[-36,-18],[-40,-22],[-44,-24],[-48,-28],
        [-50,-32],[-52,-34],[-54,-36],[-58,-40],[-62,-44],[-64,-52],
        [-66,-56],[-68,-56],[-70,-52],[-68,-44],[-66,-38],[-62,-34],
        [-58,-30],[-54,-24],[-50,-18],[-48,-12],[-52,-4],[-58,4],
        [-62,6],[-68,8],[-72,12],[-76,8],[-80,12]
    ], W, H);

    // ── Europe ──────────────────────────────────────────────────────
    landColor(110, 148, 82);
    drawContinent(ctx, [
        [-10,36],[0,36],[6,38],[10,42],[14,42],[16,44],[14,46],[10,48],
        [8,50],[4,52],[0,52],[-4,52],[-4,56],[0,58],[4,58],[8,56],
        [12,56],[14,58],[18,60],[20,64],[24,68],[28,70],[24,72],
        [18,70],[16,68],[14,66],[10,64],[6,60],[4,58],[-4,58],
        [-4,62],[-8,64],[-8,68],[-6,70],[0,70],[6,70],[10,72],
        [14,74],[16,76],[8,78],[0,78],[-10,76],[-20,72],[-20,66],
        [-24,64],[-20,60],[-14,56],[-10,52],[-10,46],[-8,40],[-10,36]
    ], W, H);

    // Scandinavia
    landColor(108, 146, 80);
    drawContinent(ctx, [
        [4,58],[8,56],[12,56],[14,58],[18,60],[24,66],[28,70],[24,72],
        [18,70],[16,68],[14,66],[10,64],[6,60],[4,58]
    ], W, H);

    // British Isles (simplified)
    landColor(105, 143, 78);
    drawContinent(ctx, [
        [-6,50],[-4,50],[-2,52],[0,52],[0,54],[-2,56],[-4,58],[-6,58],
        [-6,56],[-4,54],[-4,52],[-6,50]
    ], W, H);

    // ── Africa ──────────────────────────────────────────────────────
    landColor(180, 155, 85); // sandy/savanna tones
    drawContinent(ctx, [
        [-6,36],[0,36],[10,38],[14,38],[18,38],[22,38],[26,38],[34,30],
        [36,22],[42,12],[44,12],[46,8],[42,2],[40,-4],[36,-8],[34,-12],
        [30,-18],[28,-24],[32,-28],[32,-34],[26,-34],[20,-34],[18,-32],
        [16,-28],[14,-22],[12,-18],[10,-12],[8,-6],[4,0],[2,4],[2,6],
        [2,10],[-2,10],[-6,10],[-8,6],[-14,4],[-18,4],[-16,6],[-14,10],
        [-16,14],[-18,18],[-16,24],[-14,28],[-10,32],[-6,36]
    ], W, H);

    // Madagascar
    landColor(165, 140, 75);
    drawContinent(ctx, [
        [44,-14],[50,-14],[50,-18],[50,-22],[48,-26],[46,-26],[44,-22],[44,-18],[44,-14]
    ], W, H);

    // ── Asia ─────────────────────────────────────────────────────────
    // Main Eurasian landmass
    landColor(112, 150, 84);
    drawContinent(ctx, [
        [26,38],[34,38],[40,38],[46,40],[50,44],[54,48],[58,52],[62,52],
        [68,54],[72,54],[80,52],[90,54],[100,54],[110,54],[120,52],
        [130,52],[138,56],[140,60],[142,60],[142,52],[140,46],[138,42],
        [132,38],[128,34],[122,30],[118,24],[110,20],[106,14],[104,10],
        [102,4],[100,2],[100,-4],[104,-8],[108,-8],[112,-8],[116,-8],
        [110,-4],[104,0],[102,4],[100,10],[96,12],[90,20],[86,28],
        [80,28],[76,24],[72,20],[68,22],[64,22],[60,24],[56,28],
        [52,32],[48,36],[44,38],[40,38],[36,34],[34,30],[28,28],
        [26,32],[26,38]
    ], W, H);

    // Indian subcontinent
    landColor(108, 148, 80);
    drawContinent(ctx, [
        [66,24],[72,22],[76,20],[80,14],[80,10],[78,8],[76,8],[72,12],
        [68,14],[64,18],[62,22],[66,24]
    ], W, H);

    // Arabian Peninsula
    landColor(200, 185, 130); // desert
    drawContinent(ctx, [
        [36,30],[44,30],[48,30],[52,26],[56,22],[58,16],[56,14],[52,12],
        [46,12],[42,12],[38,16],[36,22],[36,30]
    ], W, H);

    // Japan (simplified)
    landColor(110, 150, 80);
    drawContinent(ctx, [
        [130,34],[132,34],[134,36],[136,36],[138,36],[140,38],[140,40],
        [138,42],[136,42],[134,40],[132,38],[130,36],[130,34]
    ], W, H);

    // ── Australia ────────────────────────────────────────────────────
    landColor(185, 148, 80); // arid interior
    drawContinent(ctx, [
        [114,-22],[118,-20],[122,-18],[128,-14],[132,-12],[136,-12],
        [138,-14],[140,-18],[140,-22],[138,-26],[136,-32],[138,-34],
        [140,-38],[146,-38],[150,-38],[152,-36],[150,-30],[148,-24],
        [148,-20],[152,-16],[152,-24],[148,-28],[144,-32],[142,-34],
        [140,-36],[138,-38],[134,-36],[130,-32],[126,-34],[120,-34],
        [116,-32],[114,-28],[114,-22]
    ], W, H);

    // New Zealand (simplified)
    landColor(110, 150, 80);
    drawContinent(ctx, [
        [166,-46],[170,-44],[172,-42],[174,-38],[174,-36],[172,-36],
        [170,-38],[168,-42],[166,-44],[166,-46]
    ], W, H);

    // ── Antarctica ────────────────────────────────────────────────────
    landColor(230, 240, 255); // ice white
    drawContinent(ctx, [
        [-180,-70],[180,-70],[180,-90],[-180,-90],[-180,-70]
    ], W, H);
    // Irregular coastline
    landColor(220, 232, 250);
    drawContinent(ctx, [
        [-180,-68],[-160,-66],[-140,-68],[-120,-65],[-100,-70],[-80,-66],
        [-60,-70],[-40,-68],[-20,-66],[0,-68],[20,-66],[40,-70],[60,-68],
        [80,-66],[100,-70],[120,-68],[140,-66],[160,-70],[180,-68],
        [180,-90],[-180,-90],[-180,-68]
    ], W, H);

    // ── Arctic ice cap ────────────────────────────────────────────────
    landColor(220, 235, 255, 0.85);
    drawContinent(ctx, [
        [-180,72],[180,72],[180,90],[-180,90],[-180,72]
    ], W, H);

    // ── Polar ice softening gradient ─────────────────────────────────
    // North pole fade
    const npGrad = ctx.createLinearGradient(0, 0, 0, H * 0.18);
    npGrad.addColorStop(0, 'rgba(230,242,255,0.7)');
    npGrad.addColorStop(1, 'rgba(230,242,255,0)');
    ctx.fillStyle = npGrad;
    ctx.fillRect(0, 0, W, H * 0.18);

    // South pole fade
    const spGrad = ctx.createLinearGradient(0, H, 0, H * 0.82);
    spGrad.addColorStop(0, 'rgba(230,242,255,0.7)');
    spGrad.addColorStop(1, 'rgba(230,242,255,0)');
    ctx.fillStyle = spGrad;
    ctx.fillRect(0, H * 0.82, W, H);

    // ── Clouds ────────────────────────────────────────────────────────
    // A few realistic cloud band positions
    const cloudBands = [
        { lat: 55, spread: 8, opacity: 0.45 },
        { lat: 40, spread: 6, opacity: 0.3  },
        { lat:  5, spread: 5, opacity: 0.35 },
        { lat:-15, spread: 6, opacity: 0.3  },
        { lat:-45, spread: 8, opacity: 0.5  },
    ];
    cloudBands.forEach(({ lat, spread, opacity }) => {
        const cy = ((90 - lat) / 180) * H;
        const halfH = (spread / 180) * H;
        const cg = ctx.createLinearGradient(0, cy - halfH, 0, cy + halfH);
        cg.addColorStop(0,   'rgba(255,255,255,0)');
        cg.addColorStop(0.5, `rgba(255,255,255,${opacity})`);
        cg.addColorStop(1,   'rgba(255,255,255,0)');
        ctx.fillStyle = cg;
        ctx.fillRect(0, cy - halfH, W, halfH * 2);
    });

    // Scattered cloud patches
    for (let i = 0; i < 60; i++) {
        const cx2 = (Math.sin(i * 2.39) * 0.5 + 0.5) * W;
        const cy2 = (Math.cos(i * 1.61) * 0.5 + 0.5) * H;
        const cw2 = 20 + (i % 7) * 12;
        const ch2 = 8 + (i % 5) * 4;
        ctx.fillStyle = `rgba(255,255,255,${0.15 + (i % 4) * 0.07})`;
        ctx.beginPath();
        ctx.ellipse(cx2, cy2, cw2, ch2, (i % 6) * 0.3, 0, Math.PI * 2);
        ctx.fill();
    }

    return canvas;
}

function generateGenericTexture(ctx, size, baseColor, seed) {
    const width = size;
    const height = size / 2;
    
    ctx.fillStyle = `rgb(${baseColor.r*255},${baseColor.g*255},${baseColor.b*255})`;
    ctx.fillRect(0, 0, width, height);
    
    // Add simple noise
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const noise = (seededRandom(seed + i) - 0.5) * 20;
        data[i] = Math.max(0, Math.min(255, data[i] + noise));
        data[i+1] = Math.max(0, Math.min(255, data[i+1] + noise));
        data[i+2] = Math.max(0, Math.min(255, data[i+2] + noise));
    }
    ctx.putImageData(imageData, 0, 0);
}

export function generateStarTexture(color, seed = Math.random()) {
    const size = 512; // Higher resolution for more detail
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const baseColor = new THREE.Color(color);

    // Fill the entire canvas with the base star color
    ctx.fillStyle = `rgb(${baseColor.r*255},${baseColor.g*255},${baseColor.b*255})`;
    ctx.fillRect(0, 0, size, size);

    // Get image data for procedural effects
    const imageData = ctx.getImageData(0, 0, size, size);
    const data = imageData.data;

    // Add solar granulation (convection cells) uniformly over the entire texture
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const idx = (y * size + x) * 4;

            // Multi-scale noise for granulation texture
            const granulation = (
                noise2D(x * 0.05, y * 0.05, seed) * 20 +
                noise2D(x * 0.12, y * 0.12, seed + 10) * 12 +
                noise2D(x * 0.25, y * 0.25, seed + 20) * 6
            ) - 19;

            data[idx] = Math.max(0, Math.min(255, data[idx] + granulation));
            data[idx+1] = Math.max(0, Math.min(255, data[idx+1] + granulation));
            data[idx+2] = Math.max(0, Math.min(255, data[idx+2] + granulation));
        }
    }

    ctx.putImageData(imageData, 0, 0);

    // Add sunspots (darker regions) uniformly distributed across the entire space
    const numSpots = 3 + Math.floor(seededRandom(seed + 1000) * 8);
    for (let i = 0; i < numSpots; i++) {
        const spotX = seededRandom(seed + i * 100) * size;
        const spotY = seededRandom(seed + i * 100 + 1) * size;
        const spotRadius = 3 + seededRandom(seed + i * 100 + 2) * 12;

        // Sunspot with umbra (dark center) and penumbra (lighter outer region)
        const spotGradient = ctx.createRadialGradient(spotX, spotY, 0, spotX, spotY, spotRadius);
        const darkColor = baseColor.clone().multiplyScalar(0.3);
        const mediumColor = baseColor.clone().multiplyScalar(0.6);

        spotGradient.addColorStop(0, `rgba(${darkColor.r*255},${darkColor.g*255},${darkColor.b*255},0.8)`); // Umbra
        spotGradient.addColorStop(0.5, `rgba(${mediumColor.r*255},${mediumColor.g*255},${mediumColor.b*255},0.5)`); // Penumbra
        spotGradient.addColorStop(1, 'rgba(0,0,0,0)'); // Fade out

        ctx.fillStyle = spotGradient;
        ctx.beginPath();
        ctx.arc(spotX, spotY, spotRadius, 0, Math.PI * 2);
        ctx.fill();
    }

    // Add bright active regions (solar flares/prominences) uniformly distributed
    const numActiveRegions = 2 + Math.floor(seededRandom(seed + 2000) * 4);
    for (let i = 0; i < numActiveRegions; i++) {
        const regionX = seededRandom(seed + i * 150 + 3000) * size;
        const regionY = seededRandom(seed + i * 150 + 3001) * size;
        const regionRadius = 8 + seededRandom(seed + i * 150 + 3002) * 20;

        const regionGradient = ctx.createRadialGradient(regionX, regionY, 0, regionX, regionY, regionRadius);
        const brightColor = baseColor.clone().multiplyScalar(1.3);

        regionGradient.addColorStop(0, `rgba(255,255,255,0.4)`); // Very bright center
        regionGradient.addColorStop(0.3, `rgba(${brightColor.r*255},${brightColor.g*255},${brightColor.b*255},0.3)`);
        regionGradient.addColorStop(1, 'rgba(0,0,0,0)');

        ctx.fillStyle = regionGradient;
        ctx.beginPath();
        ctx.arc(regionX, regionY, regionRadius, 0, Math.PI * 2);
        ctx.fill();
    }

    return canvas;
}

// Generates a camera-facing sprite texture with a soft glow + diffraction spikes
// Used to give stars a "star-like" appearance (like bright stars in telescope photos)
export function generateStarSpriteTexture(color) {
    const S = 256;
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d');
    const cx = S / 2, cy = S / 2;

    const c = new THREE.Color(color);
    const cr = Math.round(c.r * 255);
    const cg = Math.round(c.g * 255);
    const cb = Math.round(c.b * 255);

    // ── Core glow ────────────────────────────────────────────────────
    const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.18);
    coreGrad.addColorStop(0,   'rgba(255,255,255,1)');
    coreGrad.addColorStop(0.2, `rgba(${cr},${cg},${cb},0.9)`);
    coreGrad.addColorStop(0.6, `rgba(${cr},${cg},${cb},0.3)`);
    coreGrad.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = coreGrad;
    ctx.fillRect(0, 0, S, S);

    // ── Outer halo ───────────────────────────────────────────────────
    const haloGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.48);
    haloGrad.addColorStop(0,   `rgba(${cr},${cg},${cb},0.25)`);
    haloGrad.addColorStop(0.5, `rgba(${cr},${cg},${cb},0.08)`);
    haloGrad.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = haloGrad;
    ctx.fillRect(0, 0, S, S);

    // ── Diffraction spikes ───────────────────────────────────────────
    // 4-spike pattern (like a telescope with a secondary mirror support)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const spikes = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
    spikes.forEach(angle => {
        const spikeLen = S * 0.48;
        const spikeWidth = S * 0.025;
        const grad = ctx.createLinearGradient(
            cx, cy,
            cx + Math.cos(angle) * spikeLen,
            cy + Math.sin(angle) * spikeLen
        );
        grad.addColorStop(0,    'rgba(255,255,255,0.9)');
        grad.addColorStop(0.15, `rgba(${cr},${cg},${cb},0.5)`);
        grad.addColorStop(0.5,  `rgba(${cr},${cg},${cb},0.15)`);
        grad.addColorStop(1,    'rgba(0,0,0,0)');

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        ctx.translate(-cx, -cy);

        // Draw spike as a tapered rectangle using a clip + gradient fill
        ctx.beginPath();
        ctx.moveTo(cx, cy - spikeWidth);
        ctx.lineTo(cx + spikeLen, cy - spikeWidth * 0.1);
        ctx.lineTo(cx + spikeLen, cy + spikeWidth * 0.1);
        ctx.lineTo(cx, cy + spikeWidth);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.restore();
    });
    ctx.restore();

    return canvas;
}

export function createAtmosphereTexture(color) {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    
    const baseColor = new THREE.Color(color);
    const centerX = size / 2;
    const centerY = size / 2;
    
    // Create atmosphere gradient (transparent center, colored edge)
    const gradient = ctx.createRadialGradient(centerX, centerY, size * 0.4, centerX, centerY, size * 0.5);
    // Use clear transparent at the center and solid color with opacity at the edges
    gradient.addColorStop(0, `rgba(${baseColor.r*255},${baseColor.g*255},${baseColor.b*255},0)`);
    gradient.addColorStop(0.7, `rgba(${baseColor.r*255},${baseColor.g*255},${baseColor.b*255},0.1)`);
    gradient.addColorStop(1, `rgba(${baseColor.r*255},${baseColor.g*255},${baseColor.b*255},0.4)`);
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    
    return canvas;
}

// Utility functions
function seededRandom(seed) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
}

function seededNoise(x, seed) {
    return Math.sin(x * 12.9898 + seed * 78.233) * 43758.5453 % 1;
}

function noise2D(x, y, seed) {
    const x0 = Math.floor(x);
    const x1 = x0 + 1;
    const y0 = Math.floor(y);
    const y1 = y0 + 1;

    const sx = x - x0;
    const sy = y - y0;
    const ux = sx * sx * (3 - 2 * sx);
    const uy = sy * sy * (3 - 2 * sy);

    const val00 = seededRandom(x0 * 17.3 + y0 * 43.1 + seed);
    const val10 = seededRandom(x1 * 17.3 + y0 * 43.1 + seed);
    const val01 = seededRandom(x0 * 17.3 + y1 * 43.1 + seed);
    const val11 = seededRandom(x1 * 17.3 + y1 * 43.1 + seed);

    const nx0 = lerp(val00, val10, ux);
    const nx1 = lerp(val01, val11, ux);
    return lerp(nx0, nx1, uy);
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

// Import THREE at the end for the color class
import * as THREE from 'three';
