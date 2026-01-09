import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

// particle_app.js — ES module
// Visualizes a particle cloud; optionally reacts to hand data over WebSocket.

// UI elements (from particle_app.html)
const STATUS_EL = document.getElementById('status');
const container = document.getElementById('canvas-container');
const particleCountSlider = document.getElementById('particleCount');
const particleCountVal = document.getElementById('particleCountVal');
const particleSizeSlider = document.getElementById('particleSize');
const particleSizeVal = document.getElementById('particleSizeVal');
const colorIntensitySlider = document.getElementById('colorIntensity');
const colorIntensityVal = document.getElementById('colorIntensityVal');

function setStatus(t){ if(STATUS_EL) STATUS_EL.textContent = t; }

// Three.js scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 1000);
camera.position.set(0,0,6);
const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

// Defaults
let CURRENT_COUNT = parseInt(particleCountSlider?.value || '5000', 10);
const RADIUS = 2.2;

// Particle state
let geometry = null, material = null, points = null;
let positions = null, phases = null, amplitudes = null, shapeTargets = null, randomPts = null, baseColors = null;
let currentShape = 'sphere'; // sphere | cube | pyramid | diamond | star | text
let baseSpeed = 0.0;
let rotBoost = 1.0;
let colorShift = 0.0;
let dirSign = 1.0;
let textCache = null;
let particlesFrozen = false;
let targetZoom = 6.0; // camera z-position (lower = zoomed in)
const MIN_ZOOM = 2.0; // closest zoom
const MAX_ZOOM = 10.0; // farthest zoom

let formationProgress = 0;
const FORMATION_RATE = 0.6;
let rotMultiplier = 1.0;
const ROT_RATE = 1.5;
const MAX_ROT_MULT = 3.0;
const DIST_THRESHOLD = 0.03;
const BASE_ROT_SPEED = 0.3;
const stateTargets = { rightPinch:false, leftPinch:false };

function hslToRgb(h,s,l){
  let r,g,b;
  if(s===0){ r=g=b=l; }
  else{
    const hue2rgb=(p,q,t)=>{ if(t<0) t+=1; if(t>1) t-=1; if(t<1/6) return p+(q-p)*6*t; if(t<1/2) return q; if(t<2/3) return p+(q-p)*(2/3-t)*6; return p; };
    const q = l<0.5 ? l*(1+s) : l+s-l*s; const p = 2*l-q;
    r = hue2rgb(p,q,h+1/3); g = hue2rgb(p,q,h); b = hue2rgb(p,q,h-1/3);
  }
  return [r,g,b];
}

function generateSpherePoints(count, radius){
  const pts = new Array(count);
  const phi = Math.PI*(3-Math.sqrt(5));
  for(let i=0;i<count;i++){
    const y = 1 - (i/(count-1))*2; const r = Math.sqrt(Math.max(0,1-y*y)); const theta = phi*i; const x = Math.cos(theta)*r; const z = Math.sin(theta)*r; pts[i] = [x*radius,y*radius,z*radius];
  }
  return pts;
}

function generateRandomPoints(count, size){ const pts = new Array(count); for(let i=0;i<count;i++) pts[i] = [(Math.random()-0.5)*size, (Math.random()-0.5)*size, (Math.random()-0.5)*size]; return pts; }
function createBaseColors(count){ const cols = new Float32Array(count*3); for(let i=0;i<count;i++){ const hue=(Math.random()*0.8 + (i%10)*0.02)%1.0; const sat=0.6+Math.random()*0.3; const light=0.45+Math.random()*0.2; const rgb=hslToRgb(hue,sat,light); cols[i*3+0]=rgb[0]; cols[i*3+1]=rgb[1]; cols[i*3+2]=rgb[2]; } return cols; }

function generateStarPoints(count, radius){
  const pts = new Array(count);
  for(let i=0;i<count;i++){
    const t = Math.random()*Math.PI*2;
    const r = (i%2===0 ? radius : radius*0.45) * (0.7 + 0.3*Math.random());
    const x = Math.cos(t)*r;
    const y = Math.sin(t)*r;
    const z = (Math.random()*2-1)*radius*0.15;
    pts[i] = [x,y,z];
  }
  return pts;
}

function generateTextPoints(count, text){
  if(textCache && textCache.count === count && textCache.text === text) return textCache.points;
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 120px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width/2, canvas.height/2);
  const data = ctx.getImageData(0,0,canvas.width,canvas.height).data;
  const pts = [];
  const step = Math.max(1, Math.floor(Math.sqrt((canvas.width*canvas.height)/count)));
  for(let y=0;y<canvas.height;y+=step){
    for(let x=0;x<canvas.width;x+=step){
      const idx = (y*canvas.width + x)*4;
      if(data[idx+3] > 10){
        const nx = (x/canvas.width - 0.5)*4;
        const ny = -(y/canvas.height - 0.5)*2;
        const nz = (Math.random()*2-1)*0.2;
        pts.push([nx, ny, nz]);
      }
    }
  }
  while(pts.length < count){
    pts.push(pts[Math.floor(Math.random()*pts.length)]);
  }
  pts.length = count;
  textCache = {count, text, points: pts};
  return pts;
}

function generateCubePoints(count, size){
  const pts = new Array(count);
  const half = size/2;
  for(let i=0;i<count;i++){
    // distribute on cube surface
    const face = Math.floor(Math.random()*3);
    const sign = Math.random() < 0.5 ? -1 : 1;
    let x = (Math.random()*2-1)*half;
    let y = (Math.random()*2-1)*half;
    let z = (Math.random()*2-1)*half;
    if(face === 0) x = sign*half;
    else if(face === 1) y = sign*half;
    else z = sign*half;
    pts[i] = [x,y,z];
  }
  return pts;
}

function generatePyramidPoints(count, baseSize, height){
  const pts = new Array(count);
  const half = baseSize/2;
  for(let i=0;i<count;i++){
    const t = Math.random();
    const x = (Math.random()*2-1)*half*(1-t);
    const z = (Math.random()*2-1)*half*(1-t);
    const y = -half + t*height;
    pts[i] = [x,y,z];
  }
  return pts;
}

function generateDiamondPoints(count, radius){
  const pts = new Array(count);
  for(let i=0;i<count;i++){
    // sample on octahedron-like shape
    let x = Math.random()*2-1;
    let y = Math.random()*2-1;
    let z = Math.random()*2-1;
    const s = Math.abs(x)+Math.abs(y)+Math.abs(z);
    x = (x/s)*radius; y = (y/s)*radius; z = (z/s)*radius;
    pts[i] = [x,y,z];
  }
  return pts;
}

function buildShapeTargets(count){
  return {
    sphere: generateSpherePoints(count, RADIUS),
    cube: generateCubePoints(count, RADIUS*1.5),
    pyramid: generatePyramidPoints(count, RADIUS*1.4, RADIUS*2.2),
    diamond: generateDiamondPoints(count, RADIUS*1.2),
    star: generateStarPoints(count, RADIUS*1.4),
    text: generateTextPoints(count, 'Hello User')
  };
}

function initParticles(count){
  positions = new Float32Array(count*3);
  phases = new Float32Array(count);
  amplitudes = new Float32Array(count);
  shapeTargets = buildShapeTargets(count);
  randomPts = new Array(count);
  baseColors = createBaseColors(count);
  const rp = generateRandomPoints(count, 10);
  for(let i=0;i<count;i++){ positions[i*3+0]=rp[i][0]; positions[i*3+1]=rp[i][1]; positions[i*3+2]=rp[i][2]; randomPts[i]=rp[i]; phases[i]=Math.random()*Math.PI*2; amplitudes[i]=0.01+Math.random()*0.04; }
  if(geometry) geometry.dispose(); geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions,3)); geometry.setAttribute('color', new THREE.BufferAttribute(baseColors.slice(),3));
  if(material) material.dispose(); material = new THREE.PointsMaterial({ vertexColors:true, size: parseFloat(particleSizeSlider?.value || 0.035), sizeAttenuation:true, depthWrite:false });
  if(points) scene.remove(points); points = new THREE.Points(geometry, material);
  let group = scene.getObjectByName('particleGroup'); if(!group){ group = new THREE.Group(); group.name='particleGroup'; scene.add(group); } while(group.children.length) group.remove(group.children[0]); group.add(points);
}

function updateColorIntensity(intensity){ if(!geometry||!baseColors) return; const attr = geometry.attributes.color; for(let i=0;i<baseColors.length;i++) attr.array[i] = Math.min(1.0, baseColors[i]*intensity); attr.needsUpdate = true; }
function setParticleSize(s){ if(material) material.size = s; }
function rebuildParticles(n){ CURRENT_COUNT = n; initParticles(CURRENT_COUNT); if(particleCountVal) particleCountVal.textContent = String(CURRENT_COUNT); updateColorIntensity(parseFloat(colorIntensitySlider?.value || 1.0)); setParticleSize(parseFloat(particleSizeSlider?.value || 0.035)); }

initParticles(CURRENT_COUNT); updateColorIntensity(parseFloat(colorIntensitySlider?.value || 1.0));
scene.add(new THREE.AmbientLight(0x404040,1.2)); const dir = new THREE.DirectionalLight(0xffffff,0.2); dir.position.set(5,10,7); scene.add(dir);

// websocket (optional; if server is absent we stay in demo mode)
let ws = null;
const FINGER_SHAPE_RIGHT = { index:'sphere', middle:'cube', ring:'pyramid', pinky:'star' };
function handleMessage(data){
  let left=null,right=null;
  if(Array.isArray(data.hands)){
    for(const h of data.hands){
      if(h.side==='left') left=h;
      else if(h.side==='right') right=h;
    }
  }
  const rightPinch = right && right.pinch_finger;
  if(rightPinch && FINGER_SHAPE_RIGHT[rightPinch]){
    currentShape = FINGER_SHAPE_RIGHT[rightPinch];
  }

  // LEFT HAND CONTROLS
  const leftPinch = left && left.pinch_finger;
  if(left && left.finger_dist_norm){
    // index pinch controls speed/ freeze logic
    if(left.finger_dist_norm.index !== undefined){
      const d = left.finger_dist_norm.index; // normalized distance to thumb
      const maxD = 0.12;
      const minD = 0.015;
      const clamp = Math.max(0, Math.min(1, (d - minD) / (maxD - minD)));
      const inv = 1 - clamp;
      baseSpeed = inv * 3.0; // up to 3x
      if(d >= maxD) baseSpeed = 0.0; // freeze when far apart
    }
    // middle pinch: zoom control based on hand distance from camera
    if(leftPinch === 'middle' && left.hand_size_norm !== undefined){
      // hand_size_norm: larger = closer to camera, smaller = farther
      // Map to zoom: close hand (large size) = zoom in (low z), far hand (small size) = zoom out (high z)
      const handSize = left.hand_size_norm;
      const minSize = 0.08;  // hand far from camera
      const maxSize = 0.25;   // hand close to camera
      const normalized = Math.max(0, Math.min(1, (handSize - minSize) / (maxSize - minSize)));
      // Invert: large hand size (close) = low z (zoom in), small hand size (far) = high z (zoom out)
      targetZoom = MAX_ZOOM - (normalized * (MAX_ZOOM - MIN_ZOOM));
    }
    // ring pinch: change rotation direction
    if(leftPinch === 'ring'){
      dirSign = -1.0;
    } else if(leftPinch !== 'pinky') {
      dirSign = 1.0;
    }
    // pinky pinch: freeze particles in place
    if(leftPinch === 'pinky'){
      particlesFrozen = true;
    } else {
      particlesFrozen = false;
    }
  } else {
    particlesFrozen = false;
  }

  stateTargets.rightPinch = !!rightPinch;
  stateTargets.leftPinch = !!leftPinch;
}

let wsRetryMs = 1000;
function connectWS(){
  const wsUrl = `ws://${window.location.hostname || 'localhost'}:8765`;
  setStatus(`Connecting to hand server (${wsUrl})...`);
  try{
    ws = new WebSocket(wsUrl);
  }catch(e){
    setStatus('Hand server unavailable — demo mode');
    setTimeout(connectWS, wsRetryMs);
    wsRetryMs = Math.min(wsRetryMs * 2, 8000);
    return;
  }
  ws.onopen = ()=>{ setStatus('Connected — right pinch forms sphere; left pinch speeds rotation'); wsRetryMs = 1000; };
  ws.onmessage = (ev)=>{
    try{ const d = JSON.parse(ev.data); handleMessage(d); }catch(_e){}
  };
  const retry = ()=>{
    setStatus('Hand server unavailable — retrying...');
    setTimeout(connectWS, wsRetryMs);
    wsRetryMs = Math.min(wsRetryMs * 2, 8000);
  };
  ws.onclose = retry;
  ws.onerror = retry;
}
connectWS();

let last = performance.now();
let frozenPositions = null; // Store positions when frozen
function animate(now){
  const dt = Math.min(0.05,(now-last)/1000);
  last = now;
  
  // Smooth camera zoom interpolation
  const zoomSpeed = 2.0;
  const zoomAlpha = Math.min(1, zoomSpeed * dt);
  camera.position.z += (targetZoom - camera.position.z) * zoomAlpha;
  
  // If particles are frozen, don't update positions
  if(particlesFrozen && frozenPositions && geometry){
    const pos = geometry.attributes.position.array;
    for(let i=0;i<CURRENT_COUNT;i++){
      pos[i*3+0] = frozenPositions[i*3+0];
      pos[i*3+1] = frozenPositions[i*3+1];
      pos[i*3+2] = frozenPositions[i*3+2];
    }
    geometry.attributes.position.needsUpdate = true;
  } else {
    // Normal particle animation
    const formationTarget = stateTargets.rightPinch ? 1 : 0;
    const alpha = Math.min(1, FORMATION_RATE * dt);
    formationProgress += (formationTarget - formationProgress) * alpha;
    const rotTarget = stateTargets.leftPinch ? MAX_ROT_MULT : 1.0;
    const rAlpha = Math.min(1, ROT_RATE * dt);
    rotMultiplier += (rotTarget - rotMultiplier) * rAlpha;
    
    if(geometry){
      const pos = geometry.attributes.position.array;
      const time = now*0.001;
      const t = formationProgress;
      const ease = t*t*(3-2*t);
      const target = (shapeTargets && shapeTargets[currentShape]) ? shapeTargets[currentShape] : (shapeTargets ? shapeTargets.sphere : null);
      for(let i=0;i<CURRENT_COUNT;i++){
        const rx=randomPts[i][0], ry=randomPts[i][1], rz=randomPts[i][2];
        const sx=(target?.[i]?.[0]) ?? 0, sy=(target?.[i]?.[1]) ?? 0, sz=(target?.[i]?.[2]) ?? 0;
        let x=rx+(sx-rx)*ease; let y=ry+(sy-ry)*ease; let z=rz+(sz-rz)*ease;
        if(ease>0.02){
          const phase=phases[i]; const amp=amplitudes[i]*(0.25+0.75*ease);
          const nx=sx, ny=sy, nz=sz;
          const nlen=Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
          const ux=nx/nlen, uy=ny/nlen, uz=nz/nlen;
          const off=Math.sin(time*1.8+phase)*amp*0.5;
          x+=ux*off; y+=uy*off; z+=uz*off;
        }
        pos[i*3+0]=x; pos[i*3+1]=y; pos[i*3+2]=z;
      }
      geometry.attributes.position.needsUpdate = true;
      
      // Store current positions when freezing starts
      if(particlesFrozen && !frozenPositions){
        frozenPositions = new Float32Array(pos.length);
        frozenPositions.set(pos);
      } else if(!particlesFrozen){
        frozenPositions = null;
      }
    }
  }
  
  // Rotation only if not frozen
  if(!particlesFrozen){
    const group = scene.getObjectByName('particleGroup');
    const speed = dirSign * BASE_ROT_SPEED * (rotMultiplier*rotBoost + baseSpeed);
    if(group) group.rotation.z += speed * dt;
  }
  
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

window.addEventListener('resize', ()=>{ const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w,h); camera.aspect = w/h; camera.updateProjectionMatrix(); });

// UI wiring
if(particleCountSlider){
  particleCountSlider.addEventListener('input',(e)=>{
    const v=parseInt(e.target.value,10);
    if(particleCountVal) particleCountVal.textContent=String(v);
  });
  particleCountSlider.addEventListener('change',(e)=>{
    const v=parseInt(e.target.value,10);
    rebuildParticles(v);
  });
}
if(particleSizeSlider) particleSizeSlider.addEventListener('input',(e)=>{ const v=parseFloat(e.target.value); if(particleSizeVal) particleSizeVal.textContent=v.toFixed(3); setParticleSize(v); });
if(colorIntensitySlider) colorIntensitySlider.addEventListener('input',(e)=>{ const v=parseFloat(e.target.value); if(colorIntensityVal) colorIntensityVal.textContent=v.toFixed(2); updateColorIntensity(v); });

if(particleCountVal) particleCountVal.textContent = String(CURRENT_COUNT);
if(particleSizeVal) particleSizeVal.textContent = parseFloat(particleSizeSlider?.value || 0.035).toFixed(3);
if(colorIntensityVal) colorIntensityVal.textContent = parseFloat(colorIntensitySlider?.value || 1.0).toFixed(2);
