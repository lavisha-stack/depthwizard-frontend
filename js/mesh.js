/**
 * mesh.js — converts elevation JSON into a real vertex-displaced Three.js
 * terrain mesh with per-vertex color mapping and optional image texture
 * overlay. Also provides the raycasting helper for click-to-probe.
 */

import * as THREE from "three";

/**
 * Maps a normalized 0..1 value to an RGB color using a terrain-like
 * gradient: deep blue -> teal -> green -> yellow -> orange -> white.
 * Returns a THREE.Color.
 *
 * @param {number} t - normalized elevation (0 = lowest, 1 = highest)
 * @returns {THREE.Color}
 */
function elevationToColor(t) {
  const c = new THREE.Color();
  // Clamp to 0..1
  const v = Math.max(0, Math.min(1, t));

  if (v < 0.2) {
    // Deep blue to teal
    const f = v / 0.2;
    c.setRGB(0.04 + f * 0.0, 0.10 + f * 0.45, 0.28 + f * 0.42);
  } else if (v < 0.4) {
    // Teal to green
    const f = (v - 0.2) / 0.2;
    c.setRGB(0.0 + f * 0.18, 0.55 + f * 0.30, 0.70 - f * 0.45);
  } else if (v < 0.6) {
    // Green to yellow
    const f = (v - 0.4) / 0.2;
    c.setRGB(0.18 + f * 0.62, 0.85 - f * 0.05, 0.25 - f * 0.25);
  } else if (v < 0.8) {
    // Yellow to orange
    const f = (v - 0.6) / 0.2;
    c.setRGB(0.80 + f * 0.15, 0.80 - f * 0.40, 0.0 + f * 0.0);
  } else {
    // Orange to white
    const f = (v - 0.8) / 0.2;
    c.setRGB(0.95 + f * 0.05, 0.40 + f * 0.50, 0.0 + f * 0.90);
  }
  return c;
}

/**
 * Builds a terrain mesh from elevation data JSON.
 *
 * @param {object} data - elevation data with width, height, elevation[], min/max
 * @param {HTMLImageElement|null} textureImage - optional uploaded image to drape over terrain
 * @param {object} options - { heightScale: number, wireframe: boolean }
 * @returns {THREE.Mesh} the terrain mesh
 */
export function buildTerrainMesh(data, textureImage = null, options = {}) {
  const { width, height, elevation, min_elevation, max_elevation } = data;
  const heightScale = options.heightScale ?? 1.0;
  const wireframe = options.wireframe ?? false;

  // PlaneGeometry is created in the XY plane, then rotated to XZ.
  // segments = grid points - 1 so each quad maps to one elevation cell.
  const geometry = new THREE.PlaneGeometry(
    width,
    height,
    width - 1,
    height - 1
  );

  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const range = max_elevation - min_elevation || 1;

  // Displace each vertex's Z by the elevation value (PlaneGeometry's Z
  // becomes Y after the 90° X rotation, so this is "up" in world space).
  for (let i = 0; i < positions.count; i++) {
    const el = elevation[i] ?? 0;
    const normalized = (el - min_elevation) / range;
    positions.setZ(i, el * heightScale);

    const c = elevationToColor(normalized);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  // Material: use vertex colors as the base. If a texture image is
  // provided, blend it on top using a second material pass approach —
  // we use a single material with vertexColors + map for simplicity.
  const materialOptions = {
    vertexColors: true,
    side: THREE.DoubleSide,
    wireframe: wireframe,
    flatShading: false,
    metalness: 0.1,
    roughness: 0.85,
  };

  let material;
  if (textureImage) {
    const texture = new THREE.Texture(textureImage);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    material = new THREE.MeshStandardMaterial({
      ...materialOptions,
      map: texture,
      vertexColors: true,
    });
    // Blend vertex color with texture: vertexColors modulates the map
  } else {
    material = new THREE.MeshStandardMaterial(materialOptions);
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2; // lay flat: PlaneGeometry XY -> XZ
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return mesh;
}

/**
 * Builds a wireframe overlay mesh to show the grid structure on top of
 * the solid terrain.
 *
 * @param {object} data - elevation data
 * @param {number} heightScale
 * @returns {THREE.LineSegments}
 */
export function buildWireframeOverlay(data, heightScale = 1.0) {
  const solid = buildTerrainMesh(data, null, { heightScale, wireframe: false });
  const wireGeo = new THREE.WireframeGeometry(solid.geometry);
  const wireMat = new THREE.LineBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.15,
  });
  const wire = new THREE.LineSegments(wireGeo, wireMat);
  wire.rotation.copy(solid.rotation);
  solid.geometry.dispose();
  solid.material.dispose();
  return wire;
}

/**
 * Given a raycaster, camera, mouse NDC coords, and the terrain mesh,
 * returns the elevation value at the clicked point, or null if the
 * ray misses the terrain.
 *
 * @param {THREE.Raycaster} raycaster
 * @param {THREE.Camera} camera
 * @param {{x: number, y: number}} mouseNDC
 * @param {THREE.Mesh} terrainMesh
 * @param {object} data - elevation data (for reading the value)
 * @returns {{elevation: number, point: THREE.Vector3, x: number, y: number} | null}
 */
export function probeTerrain(raycaster, camera, mouseNDC, terrainMesh, data) {
  raycaster.setFromCamera(mouseNDC, camera);
  const intersects = raycaster.intersectObject(terrainMesh, false);
  if (intersects.length === 0) return null;

  const hit = intersects[0];
  const { width, height, elevation } = data;

  // The mesh is a rotated PlaneGeometry. The UV coordinates of the
  // hit face tell us where on the grid we are.
  const uv = hit.uv;
  if (!uv) return { elevation: 0, point: hit.point, x: 0, y: 0 };

  // UV.x goes 0..1 across width, UV.y goes 0..1 across height
  // (but PlaneGeometry's V is flipped, so we flip Y)
  const gx = Math.round(uv.x * (width - 1));
  const gy = Math.round((1 - uv.y) * (height - 1));
  const idx = gy * width + gx;
  const el = elevation[idx] ?? 0;

  return {
    elevation: el,
    point: hit.point,
    x: gx,
    y: gy,
  };
}

/**
 * Returns the THREE.Color for a given normalized elevation value,
 * for use in building the legend or probe markers.
 *
 * @param {number} t - normalized 0..1
 * @returns {THREE.Color}
 */
export { elevationToColor };
