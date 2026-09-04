/**
 * mesh.js — elevation grid -> Three.js terrain mesh + probing helpers.
 * The elevation array is intentionally independent from the visual palette.
 */
import * as THREE from "three";

const STOPS = [
  [0.00, 0x2d5a6e],
  [0.18, 0x3a8a7e],
  [0.38, 0x6ab987],
  [0.55, 0xa9c97a],
  [0.72, 0xd4a85e],
  [0.88, 0xc97a4e],
  [1.00, 0xa85440],
];

function elevationToColor(t) {
  const v = THREE.MathUtils.clamp(t, 0, 1);
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [aT, aHex] = STOPS[i];
    const [bT, bHex] = STOPS[i + 1];
    if (v <= bT) {
      const f = (v - aT) / (bT - aT);
      return new THREE.Color(aHex).lerp(new THREE.Color(bHex), f);
    }
  }
  return new THREE.Color(STOPS[STOPS.length - 1][1]);
}

export function buildTerrainMesh(data, textureImage = null, options = {}) {
  const { width, height, elevation, min_elevation, max_elevation } = data;
  const heightScale = options.heightScale ?? 1;
  const geometry = new THREE.PlaneGeometry(width, height, width - 1, height - 1);
  const positions = geometry.attributes.position;
  const range = max_elevation - min_elevation || 1;
  const colors = new Float32Array(positions.count * 3);

  for (let i = 0; i < positions.count; i++) {
    const el = elevation[i] ?? min_elevation;
    const normalized = THREE.MathUtils.clamp((el - min_elevation) / range, 0, 1);
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
    flatShading: false,
    metalness: 0,
    roughness: 0.86,
  };

  let material;
  if (textureImage) {
    const texture = new THREE.Texture(textureImage);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    material = new THREE.MeshStandardMaterial({ ...materialOptions, map: texture });
  } else {
    material = new THREE.MeshStandardMaterial({
      ...materialOptions,
      vertexColors: true,
    });
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.heightScale = heightScale;
  mesh.userData.textureMode = Boolean(textureImage);
  return mesh;
}

export function buildWireframeOverlay(data, heightScale = 1) {
  const solid = buildTerrainMesh(data, null, { heightScale });
  const wireGeo = new THREE.WireframeGeometry(solid.geometry);
  const wireMat = new THREE.LineBasicMaterial({
    color: 0x73e5ff,
    transparent: true,
    opacity: 0.52,
    depthTest: true,
  });
  const wire = new THREE.LineSegments(wireGeo, wireMat);
  wire.rotation.copy(solid.rotation);
  wire.renderOrder = 3;
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
  return {
    elevation: elevation[gy * width + gx] ?? 0,
    point: hit.point.clone(),
    x: gx,
    y: gy,
  };
}

export { elevationToColor };
