/** The WebGL side of the 3D product city: one program, one buffer per level of
 * detail, one draw call per frame. It draws only when asked to; the component
 * decides when a frame is due. */

import { STRIDE, SURFACE, type Palette, type Rgb, type Vec3 } from "./scene3d";
import { STOREY_COLOURS } from "./storeyLens";

const VERTEX = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec2 aUv;
attribute vec4 aPlace;
attribute vec4 aLook;
uniform mat4 uMatrix;
uniform vec3 uStoreys[${STOREY_COLOURS.length}];
varying vec3 vPos;
varying vec3 vNormal;
varying vec2 vUv;
varying vec4 vPlace;
varying vec4 vLook;
varying vec3 vStorey;
void main() {
  vPos = aPos;
  vNormal = aNormal;
  vUv = aUv;
  vPlace = aPlace;
  vLook = aLook;
  vStorey = aLook.y < -0.5 ? uStoreys[int(-1.0 - aLook.y)] : vec3(0.0);
  gl_Position = uMatrix * vec4(aPos, 1.0);
}
`;

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec3 vPos;
varying vec3 vNormal;
varying vec2 vUv;
varying vec4 vPlace;
varying vec4 vLook;
varying vec3 vStorey;
uniform vec3 uBg, uGround, uDot, uPlate, uKerb, uBody, uRoof, uOk, uPlan, uWarn, uSignal, uRest;
uniform vec3 uFocus;
uniform float uFog;
uniform float uBuilding, uFloor, uDistrict, uHover;

bool same(float a, float b) { return b > -0.5 && abs(a - b) < 0.5; }

void main() {
  vec3 n = normalize(vNormal);
  float light = 0.64 + 0.36 * max(dot(n, normalize(vec3(0.4, 0.8, 0.45))), 0.0);
  float surface = vLook.x;
  vec3 colour;
  if (surface > ${SURFACE.kerb}.0 - 0.5) {
    colour = (same(vPlace.z, uDistrict) ? uSignal : uKerb) * light;
  } else if (surface < ${SURFACE.ground}.5) {
    vec2 cell = fract(vPos.xz * 0.5) - 0.5;
    float spot = 1.0 - smoothstep(0.05, 0.1, length(cell));
    colour = mix(uGround, uDot, spot);
  } else if (surface < ${SURFACE.plate}.5) {
    colour = uPlate * light;
    if (same(vPlace.z, uDistrict)) colour = mix(colour, uSignal, 0.14);
  } else if (surface < ${SURFACE.block}.5) {
    colour = vLook.y < -0.5 ? vStorey : mix(uPlan, uOk, vLook.w);
    if (vLook.y >= -0.5 && n.y > 0.5) colour = mix(colour, uRoof, 0.3);
    colour *= light;
    if (same(vPlace.z, uDistrict)) colour = mix(colour, uSignal, 0.3);
  } else {
    bool side = abs(n.y) < 0.5;
    colour = (side ? uBody : uRoof) * light;
    float stripe = step(0.5, fract((vPos.x + vPos.y - vPos.z) * 1.4));
    if (vLook.y < -0.5) {
      colour = vStorey * light;
      if (same(vPlace.z, uDistrict)) colour = mix(colour, uSignal, 0.08);
    } else if (surface > ${SURFACE.planned}.5) {
      colour = mix(colour, uWarn, 0.16 + 0.24 * stripe);
    } else if (surface > ${SURFACE.floor}.5) {
      colour = mix(colour, uRest, 0.3 + 0.35 * stripe);
    }
    if (same(vPlace.x, uHover)) colour = mix(colour, uSignal, 0.08);
    if (same(vPlace.x, uBuilding)) colour = mix(colour, uSignal, 0.12);
    if (same(vPlace.y, uFloor)) colour = mix(colour, uSignal, 0.45);
    if (side) {
      // The seam between two storeys.
      colour *= mix(0.78, 1.0, step(0.06, vUv.y));
      // One window per scenario, coloured by its state. Drawn after the
      // selection tint: choosing a building never hides what its windows say.
      float count = vLook.y;
      if (count > 0.5) {
        float x = vUv.x * count;
        float index = floor(x);
        float f = fract(x);
        float inside = step(0.16, f) * step(f, 0.84) * step(0.24, vUv.y) * step(vUv.y, 0.78);
        vec3 pane = index < vLook.z - 0.5 ? uOk : (index < vLook.z + vLook.w - 0.5 ? uRest : uWarn);
        colour = mix(colour, pane, inside);
      }
    }
  }
  float fog = smoothstep(uFog * 0.5, uFog * 1.9, distance(vPos, uFocus)) * 0.8;
  gl_FragColor = vec4(mix(colour, uBg, fog), 1.0);
}
`;

const COLOURS: [string, keyof Palette][] = [
  ["uBg", "bg"],
  ["uGround", "ground"],
  ["uDot", "dot"],
  ["uPlate", "plate"],
  ["uKerb", "kerb"],
  ["uBody", "body"],
  ["uRoof", "roof"],
  ["uOk", "ok"],
  ["uPlan", "plan"],
  ["uWarn", "warn"],
  ["uSignal", "signal"],
  ["uRest", "rest"],
];

const ATTRIBUTES: [string, number, number][] = [
  ["aPos", 3, 0],
  ["aNormal", 3, 3],
  ["aUv", 2, 6],
  ["aPlace", 4, 8],
  ["aLook", 4, 12],
];

export type Frame = {
  matrix: Float32Array;
  palette: Palette;
  far: boolean;
  focus: Vec3;
  fog: number;
  /** Indices of what is chosen or under the pointer; −1 for nothing. */
  building: number;
  floor: number;
  district: number;
  hover: number;
};

export type Renderer = {
  /** Replaces the city's triangles: storeys (near) and blocks (far). */
  setMeshes(near: Float32Array, far: Float32Array): void;
  /** Draws one frame into a drawing buffer of `width` × `height` pixels. */
  draw(frame: Frame, width: number, height: number): void;
  /** Frees the buffers and the program, and gives the context back. */
  dispose(): void;
};

type Mesh = { buffer: WebGLBuffer | null; count: number };

/** A renderer on `canvas`, or null when the browser offers no WebGL or the
 * program does not build. Null is a state, not an error: the caller draws the
 * city another way. */

// @facet: registry/coverage/product-city
// @facet-role: related
export function createRenderer(canvas: HTMLCanvasElement): Renderer | null {
  let gl: WebGLRenderingContext | null = null;
  try {
    // The drawing buffer is kept, so a frame can be read back after it was shown.
    gl = (canvas.getContext("webgl", { antialias: true, preserveDrawingBuffer: true }) ??
      canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
  } catch {
    gl = null;
  }
  if (!gl || gl.isContextLost?.()) return null;
  const shader = (type: number, source: string) => {
    const s = gl!.createShader(type);
    if (!s) return null;
    gl!.shaderSource(s, source);
    gl!.compileShader(s);
    return s;
  };
  const vs = shader(gl.VERTEX_SHADER, VERTEX);
  const fs = shader(gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }
  const g = gl;
  const attributes = ATTRIBUTES.map(([name, size, offset]) => ({
    at: g.getAttribLocation(program, name),
    size,
    offset,
  }));
  const uniform = (name: string) => g.getUniformLocation(program, name);
  const colourAt = COLOURS.map(([name, key]) => ({ at: uniform(name), key }));
  const at = {
    matrix: uniform("uMatrix"),
    focus: uniform("uFocus"),
    storeys: uniform("uStoreys[0]"),
    fog: uniform("uFog"),
    building: uniform("uBuilding"),
    floor: uniform("uFloor"),
    district: uniform("uDistrict"),
    hover: uniform("uHover"),
  };
  g.enable(g.DEPTH_TEST);
  let near: Mesh = { buffer: null, count: 0 };
  let far: Mesh = { buffer: null, count: 0 };
  const upload = (data: Float32Array): Mesh => {
    const buffer = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, buffer);
    g.bufferData(g.ARRAY_BUFFER, data, g.STATIC_DRAW);
    return { buffer, count: data.length / STRIDE };
  };
  const release = () => {
    for (const m of [near, far]) if (m.buffer) g.deleteBuffer(m.buffer);
    near = { buffer: null, count: 0 };
    far = { buffer: null, count: 0 };
  };
  let alive = true;
  return {
    setMeshes(n, f) {
      if (!alive) return;
      release();
      near = upload(n);
      far = upload(f);
    },
    draw(frame, width, height) {
      if (!alive) return;
      const { palette: p } = frame;
      g.viewport(0, 0, width, height);
      g.clearColor(p.bg[0], p.bg[1], p.bg[2], 1);
      g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);
      const mesh = frame.far ? far : near;
      if (!mesh.buffer) return;
      g.useProgram(program);
      g.uniformMatrix4fv(at.matrix, false, frame.matrix);
      for (const c of colourAt) g.uniform3fv(c.at, p[c.key] as Rgb);
      g.uniform3fv(at.focus, frame.focus);
      g.uniform3fv(at.storeys, p.storeys.flat());
      g.uniform1f(at.fog, frame.fog);
      g.uniform1f(at.building, frame.building);
      g.uniform1f(at.floor, frame.floor);
      g.uniform1f(at.district, frame.district);
      g.uniform1f(at.hover, frame.hover);
      g.bindBuffer(g.ARRAY_BUFFER, mesh.buffer);
      for (const a of attributes) {
        if (a.at < 0) continue;
        g.enableVertexAttribArray(a.at);
        g.vertexAttribPointer(a.at, a.size, g.FLOAT, false, STRIDE * 4, a.offset * 4);
      }
      g.drawArrays(g.TRIANGLES, 0, mesh.count);
    },
    dispose() {
      if (!alive) return;
      alive = false;
      if (!g.isContextLost?.()) {
        release();
        g.deleteProgram(program);
        g.deleteShader(vs);
        g.deleteShader(fs);
        g.getExtension("WEBGL_lose_context")?.loseContext();
      }
    },
  };
}
