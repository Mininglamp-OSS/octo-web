import { Color, Mesh, Program, Renderer, Triangle } from "ogl";
import { type CSSProperties, useEffect, useRef } from "react";
import "./Strands.css";

const MAX_STRANDS = 12;
const MAX_COLORS = 8;

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uColors[${MAX_COLORS}];
uniform int uColorCount;
uniform int uStrandCount;
uniform float uSpeed;
uniform float uAmplitude;
uniform float uWaviness;
uniform float uThickness;
uniform float uGlow;
uniform float uTaper;
uniform float uSpread;
uniform float uHueShift;
uniform float uIntensity;
uniform float uOpacity;
uniform float uScale;
uniform float uSaturation;

out vec4 fragColor;

const float PI = 3.14159265;

vec3 spectrum(float t) {
  return 0.5 + 0.5 * cos(2.0 * PI * (t + vec3(0.00, 0.33, 0.67)));
}

vec3 samplePalette(float t) {
  t = fract(t);
  float scaled = t * float(uColorCount);
  int idx = int(floor(scaled));
  float blend = fract(scaled);
  int nextIdx = idx + 1;
  if (nextIdx >= uColorCount) nextIdx = 0;
  return mix(uColors[idx], uColors[nextIdx], blend);
}

vec3 strandColor(float t) {
  if (uColorCount > 0) return samplePalette(t);
  return spectrum(t);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  uv /= max(uScale, 0.0001);
  float centeredX = gl_FragCoord.x / uResolution.x * 2.0 - 1.0;
  float edgeY = abs(gl_FragCoord.y / uResolution.y * 2.0 - 1.0);
  float verticalMask = 1.0 - smoothstep(0.56, 0.96, edgeY);

  float e = 0.06 + uIntensity * 0.94;
  float env = pow(max(cos(centeredX * PI * 0.5), 0.0), uTaper);

  vec3 col = vec3(0.0);

  for (int i = 0; i < ${MAX_STRANDS}; i++) {
    if (i >= uStrandCount) break;

    float fi = float(i);
    float ph = fi * 1.7 * uSpread;
    float freq = (2.0 + fi * 0.35) * uWaviness;
    float spd = 1.4 + fi * 1.2;

    float tt = uTime * uSpeed;
    float w = sin(uv.x * freq + tt * spd + ph) * 0.60
            + sin(uv.x * freq * 1.1 - tt * spd * 0.7 + ph * 1.7) * 0.40;

    float amp = (0.1 + 0.02 * e) * env * uAmplitude;
    float y = w * amp;

    float d = abs(uv.y - y);
    float thick = (0.001 + 0.05 * e) * (0.35 + env) * uThickness;
    float g = thick / (d + thick * 0.45);
    g = g * g;

    float h = fi / float(uStrandCount) + uv.x * 0.30 + uTime * 0.04 + uHueShift;
    col += strandColor(h) * g * env;
  }

  col *= 0.45 + 0.7 * e;
  col = 1.0 - exp(-col * uGlow);

  float gray = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(gray), col, uSaturation), 0.0);

  float lum = max(max(col.r, col.g), col.b);
  float alpha = clamp(lum, 0.0, 1.0) * uOpacity * verticalMask;

  fragColor = vec4(col * alpha, alpha);
}
`;

type StrandsRuntimeProps = {
    colors: string[];
    count: number;
    speed: number;
    amplitude: number;
    waviness: number;
    thickness: number;
    glow: number;
    taper: number;
    spread: number;
    hueShift: number;
    intensity: number;
    saturation: number;
    opacity: number;
    scale: number;
};

type StrandsProps = Partial<StrandsRuntimeProps> & {
    className?: string;
    style?: CSSProperties;
};

function buildPalette(colors: string[]) {
    const filled = colors && colors.length ? colors : ["#ffffff"];
    const padded = [];

    for (let i = 0; i < MAX_COLORS; i++) {
        const hex = filled[i] ?? filled[filled.length - 1];
        const color = new Color(hex);
        padded.push([color.r, color.g, color.b]);
    }

    return padded;
}

export default function Strands({
    colors = ["#F8FAFC", "#7F3BF5", "#06B6D4"],
    count = 4,
    speed = 0.42,
    amplitude = 0.82,
    waviness = 1,
    thickness = 0.62,
    glow = 2.15,
    taper = 3,
    spread = 1,
    hueShift = 0,
    intensity = 0.55,
    saturation = 1.08,
    opacity = 0.9,
    scale = 1.32,
    className = "",
    style,
}: StrandsProps) {
    const propsRef = useRef<StrandsRuntimeProps>({
        colors,
        count,
        speed,
        amplitude,
        waviness,
        thickness,
        glow,
        taper,
        spread,
        hueShift,
        intensity,
        saturation,
        opacity,
        scale,
    });
    const containerRef = useRef<HTMLDivElement | null>(null);

    propsRef.current = {
        colors,
        count,
        speed,
        amplitude,
        waviness,
        thickness,
        glow,
        taper,
        spread,
        hueShift,
        intensity,
        saturation,
        opacity,
        scale,
    };

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const renderer = new Renderer({
            alpha: true,
            premultipliedAlpha: true,
            antialias: true,
        });
        const gl = renderer.gl;
        gl.clearColor(0, 0, 0, 0);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.canvas.style.backgroundColor = "transparent";

        const geometry = new Triangle(gl);
        if (geometry.attributes.uv) {
            delete geometry.attributes.uv;
        }

        const program = new Program(gl, {
            vertex: VERT,
            fragment: FRAG,
            uniforms: {
                uTime: { value: 0 },
                uResolution: { value: [container.offsetWidth, container.offsetHeight] },
                uColors: { value: buildPalette(propsRef.current.colors) },
                uColorCount: { value: Math.min(propsRef.current.colors.length, MAX_COLORS) },
                uStrandCount: { value: Math.min(propsRef.current.count, MAX_STRANDS) },
                uSpeed: { value: propsRef.current.speed },
                uAmplitude: { value: propsRef.current.amplitude },
                uWaviness: { value: propsRef.current.waviness },
                uThickness: { value: propsRef.current.thickness },
                uGlow: { value: propsRef.current.glow },
                uTaper: { value: propsRef.current.taper },
                uSpread: { value: propsRef.current.spread },
                uHueShift: { value: propsRef.current.hueShift },
                uIntensity: { value: propsRef.current.intensity },
                uOpacity: { value: propsRef.current.opacity },
                uScale: { value: propsRef.current.scale },
                uSaturation: { value: propsRef.current.saturation },
            },
        });

        const mesh = new Mesh(gl, { geometry, program });
        container.appendChild(gl.canvas);

        function resize() {
            const width = container.offsetWidth;
            const height = container.offsetHeight;
            renderer.setSize(width, height);
            program.uniforms.uResolution.value = [width, height];
        }

        window.addEventListener("resize", resize);
        resize();

        let animationFrame = 0;
        const update = (time: number) => {
            animationFrame = requestAnimationFrame(update);
            const current = propsRef.current;

            program.uniforms.uTime.value = time * 0.001;
            program.uniforms.uColors.value = buildPalette(current.colors);
            program.uniforms.uColorCount.value = Math.min(current.colors.length, MAX_COLORS);
            program.uniforms.uStrandCount.value = Math.min(Math.max(Math.round(current.count), 1), MAX_STRANDS);
            program.uniforms.uSpeed.value = current.speed;
            program.uniforms.uAmplitude.value = current.amplitude;
            program.uniforms.uWaviness.value = current.waviness;
            program.uniforms.uThickness.value = current.thickness;
            program.uniforms.uGlow.value = current.glow;
            program.uniforms.uTaper.value = current.taper;
            program.uniforms.uSpread.value = current.spread;
            program.uniforms.uHueShift.value = current.hueShift;
            program.uniforms.uIntensity.value = current.intensity;
            program.uniforms.uOpacity.value = current.opacity;
            program.uniforms.uScale.value = current.scale;
            program.uniforms.uSaturation.value = current.saturation;

            renderer.render({ scene: mesh });
        };

        animationFrame = requestAnimationFrame(update);

        return () => {
            cancelAnimationFrame(animationFrame);
            window.removeEventListener("resize", resize);
            if (gl.canvas.parentNode === container) {
                container.removeChild(gl.canvas);
            }
            gl.getExtension("WEBGL_lose_context")?.loseContext();
        };
    }, []);

    return <div ref={containerRef} className={`wk-strands ${className}`} style={style} />;
}
