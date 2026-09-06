import * as THREE from "three";

const STOPS = [
  [0.00, 0x102a43], [0.22, 0x1f7a8c], [0.45, 0x65a30d],
  [0.68, 0xd6a84b], [0.84, 0x8b5e3c], [1.00, 0xf4f1e8],
];

function elevationToColor(t) {
  const v = THREE.MathUtils.clamp(t, 0, 1);
  for (let i = 1; i < STOPS.length; i++) {
    const [aT, aHex] = STOPS[i - 1], [bT, bHex] = STOPS[i];
    if (v <= bT) return new THREE.Color(aHex).lerp(new THREE.Color(bHex), (v - aT) / (bT - aT));
  }
  return new THREE.Color(STOPS.at(-1)[1]);
}

function finiteRange(values) {
  let low = Infinity, high = -Infinity;
  for (const value of values) if (Number.isFinite(value)) { low = Math.min(low, value); high = Math.max(high, value); }
  return Number.isFinite(low) && Number.isFinite(high) ? [low, high] : [0, 1];
}

function percentileBounds(values, lowFraction, highFraction) {
  const sorted = Array.from(values, Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return [0, 1];
  const q = f => { const p = (sorted.length - 1) * f, i = Math.floor(p), r = p - i; return sorted[i] + (sorted[Math.min(i + 1, sorted.length - 1)] - sorted[i]) * r; };
  return [q(lowFraction), q(highFraction)];
}

function clampGrid(values, low, high) {
  return Float32Array.from(values, value => THREE.MathUtils.clamp(value, low, high));
}

function sampleGrid(values, width, height, x, y) {
  const gx = THREE.MathUtils.clamp(x, 0, width - 1), gy = THREE.MathUtils.clamp(y, 0, height - 1);
  const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(x0 + 1, width - 1), y1 = Math.min(y0 + 1, height - 1);
  const tx = gx - x0, ty = gy - y0;
  const a = values[y0 * width + x0] * (1 - tx) + values[y0 * width + x1] * tx;
  const b = values[y1 * width + x0] * (1 - tx) + values[y1 * width + x1] * tx;
  return a * (1 - ty) + b * ty;
}

function smoothGrid(values, width, height, centerWeight = 6) {
  const output = new Float32Array(values.length);
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const center = values[row * width + col]; let total = center * centerWeight, weight = centerWeight;
    if (col > 0) { total += values[row * width + col - 1]; weight++; }
    if (col + 1 < width) { total += values[row * width + col + 1]; weight++; }
    if (row > 0) { total += values[(row - 1) * width + col]; weight++; }
    if (row + 1 < height) { total += values[(row + 1) * width + col]; weight++; }
    output[row * width + col] = total / weight;
  }
  return output;
}

function resampleGrid(data, maxSize) {
  const scale = Math.min(1, maxSize / Math.max(data.width, data.height));
  if (scale === 1) return data;
  const width = Math.max(2, Math.round(data.width * scale)), height = Math.max(2, Math.round(data.height * scale));
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    out[y * width + x] = sampleGrid(data.elevation, data.width, data.height, x * (data.width - 1) / (width - 1), y * (data.height - 1) / (height - 1));
  }
  return { ...data, width, height, elevation: out };
}

function loadTerrainTexture(image, maxAnisotropy = 8) {
  if (!image) return null;
  const texture = new THREE.Texture(image);
  texture.flipY = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = Math.max(1, Math.min(Number(maxAnisotropy) || 8, 16));
  texture.needsUpdate = true;
  return texture;
}

export function buildTerrainMesh(data, textureImage = null, options = {}) {
  const sampled = resampleGrid(data, 512);
  const { width, height, elevation } = sampled;
  const relativeUnits = String(data.elevation_unit || data.units || "").toLowerCase().startsWith("relative");
  const [min, max] = finiteRange(elevation);
  const [robustLow, robustHigh] = relativeUnits ? percentileBounds(elevation, 0.01, 0.99) : [min, max];
  const robustRange = Math.max(robustHigh - robustLow, 1e-8);
  const clipped = relativeUnits ? clampGrid(elevation, robustLow, robustHigh) : elevation;
    const displayHeights = relativeUnits ? smoothGrid(clipped, width, height, 6) : clipped;
  const [displayMin, displayMax] = finiteRange(displayHeights);
  const displayRange = Math.max(displayMax - displayMin, 0);

  const pixelSize = Number(data.pixel_size_m);
  const horizontalScale = !relativeUnits && Number.isFinite(pixelSize) && pixelSize > 0 ? pixelSize : 1;
  const worldWidth = (width - 1) * horizontalScale;
  const worldDepth = (height - 1) * horizontalScale;
  const worldSpan = Math.max(worldWidth, worldDepth, 1);
  const requested = Number(options.verticalExaggeration);
  const relativeExaggeration = Number.isFinite(requested) && requested > 0 ? THREE.MathUtils.clamp(requested, 0.5, 3) : 1.4;
  const elevationScale = relativeUnits && displayRange > 1e-8 ? (worldSpan * 0.28) / displayRange : 1;
  const totalVerticalScale = elevationScale * (relativeUnits ? relativeExaggeration : 1);

  const geometry = new THREE.PlaneGeometry(worldWidth, worldDepth, width - 1, height - 1);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const i = row * width + col;
    const raw = Number(elevation[i]), value = Number.isFinite(raw) ? raw : min;
    const normalized = THREE.MathUtils.clamp((value - robustLow) / robustRange, 0, 1);
    positions.setY(i, (displayHeights[i] - displayMin) * totalVerticalScale);
    const color = elevationToColor(normalized);
    colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const base = { side: THREE.DoubleSide, flatShading: false, roughness: 0.94, metalness: 0 };
  const texture = textureImage ? loadTerrainTexture(textureImage, 8) : null;
  const material = texture
    ? new THREE.MeshStandardMaterial({ ...base, map: texture })
    : new THREE.MeshStandardMaterial({ ...base, vertexColors: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = {
    heightScale: totalVerticalScale, textureMode: Boolean(textureImage), terrainHeightRange: displayRange,
    baseline: displayMin, min, max, width, height, worldWidth, worldDepth,
    pixelSizeX: horizontalScale, pixelSizeY: horizontalScale, elevationScale,
    verticalExaggeration: relativeUnits ? relativeExaggeration : 1, relativeUnits,
    sourceHeights: Float32Array.from(displayHeights, value => value - displayMin),
    elevationHeights: Float32Array.from(elevation, value => Number(value)),
  };
  return mesh;
}

export function buildWireframeOverlay(data, options = {}) {
  const solid = buildTerrainMesh(data, null, options);
  const wireGeo = new THREE.WireframeGeometry(solid.geometry);
  const wireMat = new THREE.LineBasicMaterial({ color: 0x73e5ff, transparent: true, opacity: 0.52, depthTest: true });
  const wire = new THREE.LineSegments(wireGeo, wireMat);
  wire.rotation.copy(solid.rotation);
  wire.renderOrder = 3;
  solid.geometry.dispose(); solid.material.dispose();
  return wire;
}

export function probeTerrain(raycaster, camera, mouseNDC, terrainMesh, data) {
  raycaster.setFromCamera(mouseNDC, camera);
  const intersects = raycaster.intersectObject(terrainMesh, false);
  if (!intersects.length) return null;
  const hit = intersects[0], { width, height, elevation } = data, uv = hit.uv;
  if (!uv) return { elevation: 0, point: hit.point, x: 0, y: 0 };
  const gx = THREE.MathUtils.clamp(Math.round(uv.x * (width - 1)), 0, width - 1);
  const gy = THREE.MathUtils.clamp(Math.round((1 - uv.y) * (height - 1)), 0, height - 1);
  return { elevation: elevation[gy * width + gx] ?? 0, point: hit.point.clone(), x: gx, y: gy };
}

export { elevationToColor };
