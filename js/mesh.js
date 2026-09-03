/**
 * mesh.js — elevation grid -> Three.js terrain mesh + probing helpers.
 * The elevation array is intentionally independent from the visual palette.
 */
import * as THREE from "three";

/** Calm, readable terrain palette: aqua -> mint -> sand -> lavender -> coral. */
function elevationToColor(t) {
  const v = THREE.MathUtils.clamp(t, 0, 1);
  const stops = [
    [0.00, 0x6fb9c4],
    [0.24, 0x8fd6c0],
    [0.50, 0xd3d99d],
    [0.74, 0xf0c58f],
    [1.00, 0xe49ba7],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [aT, aHex] = stops[i];
    const [bT, bHex] = stops[i + 1];
    if (v <= bT) {
      const f = (v - aT) / (bT - aT);
      return new THREE.Color(aHex).lerp(new THREE.Color(bHex), f);
    }
  }
  return new THREE.Color(stops[stops.length - 1][1]);
}

export function buildTerrainMesh(data, textureImage = null, options = {}) {
  const { width, height, elevation, min_elevation, max_elevation } = data;
  const heightScale = options.heightScale ?? 1;
  const wireframe = options.wireframe ?? false;
  const geometry = new THREE.PlaneGeometry(width, height, width - 1, height - 1);
  const positions = geometry.attributes.position;
  const range = max_elevation - min_elevation || 1;
  const colors = new Float32Array(positions.count * 3);

  for (let i = 0; i < positions.count; i++) {
    const el = elevation[i] ?? min_elevation;
    const normalized = (el - min_elevation) / range;
    positions.setZ(i, (el - min_elevation) * heightScale);
    const c = elevationToColor(normalized);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const materialOptions = {
    side: THREE.DoubleSide,
    wireframe,
    flatShading: false,
    metalness: 0,
    roughness: 0.92,
  };

  let material;
  if (textureImage) {
    const texture = new THREE.Texture(textureImage);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    // Do not multiply the satellite image by the elevation palette.
    // The real product requirement is to drape the original RGB image.
    material = new THREE.MeshStandardMaterial({ ...materialOptions, map: texture });
  } else {
    material = new THREE.MeshStandardMaterial({ ...materialOptions, vertexColors: true });
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildWireframeOverlay(data, heightScale = 1) {
  const solid = buildTerrainMesh(data, null, { heightScale, wireframe: false });
  const wireGeo = new THREE.WireframeGeometry(solid.geometry);
  const wireMat = new THREE.LineBasicMaterial({ color: 0x4f9eaa, transparent: true, opacity: 0.25 });
  const wire = new THREE.LineSegments(wireGeo, wireMat);
  wire.rotation.copy(solid.rotation);
  solid.geometry.dispose();
  solid.material.dispose();
  return wire;
}

export function probeTerrain(raycaster, camera, mouseNDC, terrainMesh, data) {
  raycaster.setFromCamera(mouseNDC, camera);
  const intersects = raycaster.intersectObject(terrainMesh, false);
  if (!intersects.length) return null;
  const hit = intersects[0];
  const { width, height, elevation } = data;
  const uv = hit.uv;
  if (!uv) return { elevation: 0, point: hit.point, x: 0, y: 0 };
  const gx = THREE.MathUtils.clamp(Math.round(uv.x * (width - 1)), 0, width - 1);
  const gy = THREE.MathUtils.clamp(Math.round((1 - uv.y) * (height - 1)), 0, height - 1);
  return { elevation: elevation[gy * width + gx] ?? 0, point: hit.point, x: gx, y: gy };
}

export { elevationToColor };
