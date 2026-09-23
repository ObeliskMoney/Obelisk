"use client";

/**
 * Hero background: fluted glass + orange flow + film grain, WebGL1, written from scratch for Obelisk.
 * Inspired by the look of Hirael "Agency Landing", without the `shaders` package
 * (its commercial license is paid). No dependencies.
 *
 * - Stops rendering when the hero is off screen or the tab is hidden.
 * - prefers-reduced-motion: renders one still frame.
 * - No WebGL or a compile failure: the canvas stays hidden and the CSS background below shows.
 */
import { useEffect, useRef, useState } from "react";

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;   // 0..1, y up

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

// Color field "behind the glass": a swirling white base + flowing orange blobs.
vec3 field(vec2 p, float A, float t) {
  vec2 q = p * 1.4;
  float s = fbm(q + vec2(0.03 * t, -0.02 * t) + 0.8 * fbm(q * 1.6 - 0.04 * t));
  vec3 base = mix(vec3(0.925), vec3(1.0), smoothstep(0.25, 0.85, s));

  vec2 w = p + 0.32 * vec2(fbm(p * 1.2 + 0.05 * t), fbm(p * 1.2 - 0.05 * t + 7.3)) - 0.16;
  float o = 0.0;
  o += 1.00 * smoothstep(0.62, 0.0, length(w - vec2(0.70 * A + 0.06 * sin(0.11 * t), 0.72 + 0.08 * cos(0.13 * t))));
  o += 0.85 * smoothstep(0.55, 0.0, length(w - vec2(0.93 * A + 0.05 * cos(0.09 * t), 0.30 + 0.07 * sin(0.12 * t))));
  o += 0.45 * smoothstep(0.50, 0.0, length(w - vec2(0.48 * A + 0.07 * sin(0.07 * t + 1.0), 0.10)));
  o += 0.55 * smoothstep(0.35, 0.0, length(w - vec2(uMouse.x * A, uMouse.y)));
  o = clamp(o, 0.0, 1.0);
  o = o * o * (3.0 - 2.0 * o);

  vec3 orange = vec3(1.0, 0.373, 0.012);   // #FF5F03
  vec3 peach  = vec3(1.0, 0.70, 0.48);
  vec3 tint = mix(peach, orange, smoothstep(0.35, 0.95, o));
  return mix(base, tint, o * 0.78);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float A = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * A, uv.y);
  float t = uTime;

  // Glass flutes, tilted 31 degrees
  const float ang = 0.541;                 // 31 deg
  vec2 dir = vec2(cos(ang), sin(ang));
  vec2 nrm = vec2(-dir.y, dir.x);
  float coord = dot(p, nrm) * 8.0 + 0.15 * t;
  float f = fract(coord);
  float n = f * 2.0 - 1.0;
  float lens = n * abs(n);                 // rounded profile

  vec2 off = nrm * lens * 0.055;
  float ab = 0.18;                         // chromatic aberration
  vec3 col;
  col.r = field(p + off * (1.0 + ab), A, t).r;
  col.g = field(p + off, A, t).g;
  col.b = field(p + off * (1.0 - ab), A, t).b;

  // Thin highlights on flute edges + soft shading on their body
  float hi = pow(1.0 - f, 16.0) * 0.20 + pow(f, 60.0) * 0.12;
  col += hi;
  col *= 1.0 - 0.035 * n;

  // Film grain
  col += (hash(gl_FragCoord.xy + fract(t * 0.37) * 91.7) - 0.5) * 0.045;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(log ?? "shader compile error");
  }
  return s;
}

export function HeroShader() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
    if (!gl) return;

    let prog: WebGLProgram;
    try {
      prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link error");
    } catch (e) {
      console.warn("[hero-shader] falling back to CSS:", e);
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, "uRes");
    const uTime = gl.getUniformLocation(prog, "uTime");
    const uMouse = gl.getUniformLocation(prog, "uMouse");

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // The background is soft, so 0.75x resolution is enough and saves GPU.
    const scale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.75;
    const resize = () => {
      const w = Math.max(1, Math.round(canvas.clientWidth * scale));
      const h = Math.max(1, Math.round(canvas.clientHeight * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };

    const target = { x: 0.78, y: 0.6 };
    const mouse = { x: 0.78, y: 0.6 };
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      target.x = (e.clientX - r.left) / r.width;
      target.y = 1 - (e.clientY - r.top) / r.height;
    };

    let visible = true;
    let shown = false;
    let raf = 0;
    const start = performance.now();
    const frame = (now: number) => {
      resize();
      mouse.x += (target.x - mouse.x) * 0.04;
      mouse.y += (target.y - mouse.y) * 0.04;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, reduce ? 12 : (now - start) / 1000);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!shown) {
        shown = true;
        setReady(true);
      }
      if (!reduce && visible && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      cancelAnimationFrame(raf);
      if (visible && !document.hidden) raf = requestAnimationFrame(frame);
    };

    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      kick();
    });
    io.observe(canvas);
    document.addEventListener("visibilitychange", kick);
    window.addEventListener("resize", kick);
    if (!reduce) window.addEventListener("pointermove", onMove, { passive: true });
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", kick);
      window.removeEventListener("resize", kick);
      window.removeEventListener("pointermove", onMove);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return <canvas ref={ref} aria-hidden className={`hero-shader${ready ? " on" : ""}`} />;
}
