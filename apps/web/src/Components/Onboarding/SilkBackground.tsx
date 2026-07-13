import React, { useEffect, useRef } from "react";

type SilkBackgroundProps = {
    brightness?: number;
    className?: string;
    damping?: number;
    hue?: number;
    mouseSensitivity?: number;
    saturation?: number;
    speed?: number;
    textureScale?: number;
};

type SilkRenderSettings = {
    brightness: number;
    damping: number;
    hue: number;
    mouseSensitivity: number;
    saturation: number;
    speed: number;
    textureScale: number;
};

const vertexShaderSource = `
attribute vec2 a_position;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const fragmentShaderSource = `
precision highp float;

uniform vec3 iResolution;
uniform float iTime;
uniform vec4 iMouse;
uniform float uHue;
uniform float uSaturation;
uniform float uBrightness;
uniform float uTextureScale;

#define INVERT 1

vec3 hsl2rgb(vec3 hsl) {
    vec3 rgb = clamp(abs(mod(hsl.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return hsl.z + hsl.y * (rgb - 0.5) * (1.0 - abs(2.0 * hsl.z - 1.0));
}

float noise(vec2 p) {
    return smoothstep(-0.5, 0.9, sin((p.x - p.y) * 555.0) * sin(p.y * 1444.0)) - 0.4;
}

float fabric(vec2 p) {
    const mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    float f = 0.4 * noise(p);
    f += 0.3 * noise(p = m * p);
    f += 0.2 * noise(p = m * p);
    return f + 0.1 * noise(m * p);
}

float silk(vec2 uv, float t) {
    float s = sin(5.0 * (uv.x + uv.y + cos(2.0 * uv.x + 5.0 * uv.y)) + sin(12.0 * (uv.x + uv.y)) - t);
    s = 0.7 + 0.3 * (s * s * 0.5 + s);
    s *= 0.92 + 0.45 * fabric(uv * min(iResolution.x, iResolution.y) * 0.00054);
    return s * 0.9 + 0.1;
}

float silkd(vec2 uv, float t) {
    float xy = uv.x + uv.y;
    float d = (5.0 * (1.0 - 2.0 * sin(2.0 * uv.x + 5.0 * uv.y)) + 12.0 * cos(12.0 * xy)) * cos(5.0 * (cos(2.0 * uv.x + 5.0 * uv.y) + xy) + sin(12.0 * xy) - t);
    return 0.005 * d * (sign(d) + 3.0);
}

void mainImage(out vec4 fragColor, vec2 fragCoord) {
    float mr = min(iResolution.x, iResolution.y);
    vec2 uv = fragCoord / mr;

    float t = iTime;
    uv.y += 0.03 * sin(8.0 * uv.x - t);

    if (iMouse.z > 1.0)
        uv += smoothstep(0.5, 0.0, distance(iMouse.xy / mr, uv)) * 0.08;

    vec2 silkUv = uv * uTextureScale;
    float s = sqrt(silk(silkUv, t));
    float d = silkd(silkUv, t);

    vec3 c = vec3(s);
    c += 0.7 * vec3(1.0, 0.83, 0.6) * d;
    c *= 1.0 - max(0.0, 0.8 * d);
#if INVERT
    c = pow(c, 0.3 / vec3(0.52, 0.5, 0.4));
    c = 1.0 - c;
#else
    c = pow(c, vec3(0.52, 0.5, 0.4));
#endif

    float luma = dot(c, vec3(0.299, 0.587, 0.114));
    float fold = clamp(d * 2.2 + 0.5, 0.0, 1.0);
    float highlight = max(d, 0.0);
    float hue = fract((uHue + mix(-12.0, 16.0, fold)) / 360.0);
    float lightness = clamp(0.1 + luma * 0.72 + highlight * 0.12, 0.0, 0.9);
    vec3 purpleSilk = hsl2rgb(vec3(hue, clamp(uSaturation * 0.95, 0.0, 1.0), lightness));
    vec3 deepViolet = hsl2rgb(vec3(fract((uHue - 20.0) / 360.0), clamp(uSaturation * 0.62, 0.0, 1.0), 0.075));

    vec2 vignetteUv = fragCoord / iResolution.xy;
    float vignette = smoothstep(0.94, 0.22, distance(vignetteUv, vec2(0.5, 0.48)));
    vec3 color = mix(deepViolet, purpleSilk, clamp(0.2 + luma * 0.9, 0.0, 1.0));
    color += highlight * hsl2rgb(vec3(fract((uHue + 26.0) / 360.0), 0.68, 0.68)) * 0.08;
    color *= mix(0.68, 1.08, vignette);
    color *= uBrightness;

    fragColor = vec4(color, 1.0);
}

void main() {
    vec4 color = vec4(0.0);
    mainImage(color, gl_FragCoord.xy);
    gl_FragColor = color;
}
`;

function createShader(gl: WebGLRenderingContext, type: number, source: string) {
    const shader = gl.createShader(type);
    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }

    return shader;
}

function createProgram(gl: WebGLRenderingContext) {
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    if (!vertexShader || !fragmentShader) return null;

    const program = gl.createProgram();
    if (!program) return null;

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error(gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
    }

    return program;
}

const addMediaQueryListener = (query: MediaQueryList, listener: () => void) => {
    if (typeof query.addEventListener === "function") {
        query.addEventListener("change", listener);
        return () => query.removeEventListener("change", listener);
    }

    query.addListener(listener);
    return () => query.removeListener(listener);
};

const SilkBackground: React.FC<SilkBackgroundProps> = ({
    brightness = 0.9,
    className,
    damping = 0.08,
    hue = 264,
    mouseSensitivity = 0.62,
    saturation = 0.74,
    speed = 0.42,
    textureScale = 1,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const contextLossTimerRef = useRef<number | null>(null);
    const targetSettingsRef = useRef<SilkRenderSettings>({
        brightness,
        damping,
        hue,
        mouseSensitivity,
        saturation,
        speed,
        textureScale,
    });
    const renderSettingsRef = useRef<SilkRenderSettings>({
        brightness,
        damping,
        hue,
        mouseSensitivity,
        saturation,
        speed,
        textureScale,
    });

    useEffect(() => {
        targetSettingsRef.current = {
            brightness,
            damping,
            hue,
            mouseSensitivity,
            saturation,
            speed,
            textureScale,
        };
    }, [brightness, damping, hue, mouseSensitivity, saturation, speed, textureScale]);

    useEffect(() => {
        if (contextLossTimerRef.current !== null) {
            window.clearTimeout(contextLossTimerRef.current);
            contextLossTimerRef.current = null;
        }

        const canvas = canvasRef.current;
        if (!canvas) return;

        const gl = canvas.getContext("webgl", {
            alpha: false,
            antialias: false,
            depth: false,
            premultipliedAlpha: false,
            stencil: false,
        });
        if (!gl) return;

        const program = createProgram(gl);
        if (!program) return;

        const positionLocation = gl.getAttribLocation(program, "a_position");
        const resolutionLocation = gl.getUniformLocation(program, "iResolution");
        const timeLocation = gl.getUniformLocation(program, "iTime");
        const mouseLocation = gl.getUniformLocation(program, "iMouse");
        const hueLocation = gl.getUniformLocation(program, "uHue");
        const saturationLocation = gl.getUniformLocation(program, "uSaturation");
        const brightnessLocation = gl.getUniformLocation(program, "uBrightness");
        const textureScaleLocation = gl.getUniformLocation(program, "uTextureScale");

        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

        let frameId = 0;
        let width = 0;
        let height = 0;
        let lastFrameTime = performance.now();
        let shaderTime = 0;
        const pointer = { x: 0, y: 0, active: 0 };
        const smoothPointer = { x: 0, y: 0, active: 0 };
        const reducedMotionQuery =
            typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

        const canAnimate = () => !reducedMotionQuery?.matches;

        const stopAnimation = () => {
            if (frameId) {
                cancelAnimationFrame(frameId);
                frameId = 0;
            }
        };

        const handlePointerMove = (event: PointerEvent) => {
            if (!canAnimate()) return;

            const rect = canvas.getBoundingClientRect();
            const isInsideCanvas =
                event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;

            if (!isInsideCanvas) {
                pointer.active = 0;
                return;
            }

            pointer.x = (event.clientX - rect.left) * (canvas.width / Math.max(rect.width, 1));
            pointer.y = canvas.height - (event.clientY - rect.top) * (canvas.height / Math.max(rect.height, 1));
            pointer.active = 2 * targetSettingsRef.current.mouseSensitivity;
        };

        const handlePointerLeave = () => {
            pointer.active = 0;
        };

        const renderFrame = (now: number) => {
            const targetSettings = targetSettingsRef.current;
            const renderSettings = renderSettingsRef.current;
            const easing = 0.055;
            const delta = Math.min(0.05, Math.max(0, (now - lastFrameTime) / 1000));

            lastFrameTime = now;
            renderSettings.hue += (targetSettings.hue - renderSettings.hue) * easing;
            renderSettings.saturation += (targetSettings.saturation - renderSettings.saturation) * easing;
            renderSettings.brightness += (targetSettings.brightness - renderSettings.brightness) * easing;
            renderSettings.textureScale += (targetSettings.textureScale - renderSettings.textureScale) * easing;
            renderSettings.speed += (targetSettings.speed - renderSettings.speed) * easing;
            renderSettings.damping += (targetSettings.damping - renderSettings.damping) * easing;
            shaderTime += delta * renderSettings.speed;

            smoothPointer.x += (pointer.x - smoothPointer.x) * renderSettings.damping;
            smoothPointer.y += (pointer.y - smoothPointer.y) * renderSettings.damping;
            smoothPointer.active += (pointer.active - smoothPointer.active) * renderSettings.damping;

            gl.useProgram(program);
            gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
            gl.enableVertexAttribArray(positionLocation);
            gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

            gl.uniform3f(resolutionLocation, width, height, 1);
            gl.uniform1f(timeLocation, shaderTime);
            gl.uniform4f(mouseLocation, smoothPointer.x, smoothPointer.y, smoothPointer.active, 0);
            gl.uniform1f(hueLocation, renderSettings.hue);
            gl.uniform1f(saturationLocation, renderSettings.saturation);
            gl.uniform1f(brightnessLocation, renderSettings.brightness);
            gl.uniform1f(textureScaleLocation, renderSettings.textureScale);

            gl.drawArrays(gl.TRIANGLES, 0, 6);
        };

        const renderLoop = (now: number) => {
            renderFrame(now);
            if (canAnimate()) {
                frameId = requestAnimationFrame(renderLoop);
            } else {
                frameId = 0;
            }
        };

        const renderStaticFrame = () => {
            stopAnimation();
            pointer.active = 0;
            smoothPointer.active = 0;
            lastFrameTime = performance.now();
            renderFrame(lastFrameTime);
        };

        const startAnimation = () => {
            if (frameId || !canAnimate()) return;

            lastFrameTime = performance.now();
            frameId = requestAnimationFrame(renderLoop);
        };

        const updateMotionPreference = () => {
            if (canAnimate()) {
                startAnimation();
                return;
            }

            renderStaticFrame();
        };

        const resize = () => {
            const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
            const rect = canvas.getBoundingClientRect();
            width = Math.max(1, Math.floor(rect.width * pixelRatio));
            height = Math.max(1, Math.floor(rect.height * pixelRatio));
            canvas.width = width;
            canvas.height = height;
            gl.viewport(0, 0, width, height);

            if (!canAnimate()) {
                renderStaticFrame();
            }
        };

        resize();
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerleave", handlePointerLeave);
        window.addEventListener("blur", handlePointerLeave);
        window.addEventListener("resize", resize);
        const removeReducedMotionQueryListener = reducedMotionQuery
            ? addMediaQueryListener(reducedMotionQuery, updateMotionPreference)
            : () => {};
        updateMotionPreference();

        return () => {
            stopAnimation();
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerleave", handlePointerLeave);
            window.removeEventListener("blur", handlePointerLeave);
            window.removeEventListener("resize", resize);
            removeReducedMotionQueryListener();
            gl.deleteBuffer(positionBuffer);
            gl.deleteProgram(program);
            const loseContext = gl.getExtension("WEBGL_lose_context");
            if (loseContext) {
                const lossTimer = window.setTimeout(() => {
                    if (contextLossTimerRef.current !== lossTimer) return;

                    loseContext.loseContext();
                    contextLossTimerRef.current = null;
                }, 0);
                contextLossTimerRef.current = lossTimer;
            }
        };
    }, []);

    return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
};

export default SilkBackground;
