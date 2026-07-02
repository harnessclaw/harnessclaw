import { useEffect, useRef, useState } from 'react'

// Full-screen quad in clip space.
const VERTEX_SRC = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

// Organic flowing orange background. Adapted to WebGL1 (GLSL ES 1.0) from a
// design-tool export: the original mixed `textureSize()` (WebGL2) with
// `gl_FragColor` (WebGL1), which can't compile together. Since `u_texture`
// was only used to read the resolution, it's replaced by a `u_resolution`
// uniform; everything else (colors / params / noise) is kept verbatim.
const FRAGMENT_SRC = `
precision highp float;

uniform float u_time;
uniform vec2 u_resolution;

// 动画速度：[0.1, 2.0]
const float SPEED = 0.5;

// 有机扭曲强度：[0.0, 1.0]
const float DISTORTION = 0.6000000000000001;

// 旋涡扭曲强度：[0.0, 1.0]
const float SWIRL = 0.4;

// 色彩数量：[2, 6]
const int COLOR_COUNT = 2;

// 色彩聚合度：[1.5, 6.0]
const float DIST_POWER = 5.1000000000000005;

// 色彩边缘颗粒：[0.0, 1.0]
const float GRAIN_MIXER = 0.5;

// 全屏颗粒叠加：[0.0, 1.0]
const float GRAIN_OVERLAY = 0.2;

// 色彩1
const vec4 COLOR_0 = vec4(1.0000, 0.9542, 0.8385, 1.0000);
// 色彩2
const vec4 COLOR_1 = vec4(1.0000, 0.5691, 0.0059, 1.0000);
// 色彩3
const vec4 COLOR_2 = vec4(1.00, 1.00, 1.00, 1.00);
// 色彩4
const vec4 COLOR_3 = vec4(1.00, 1.00, 1.00, 1.00);
// 色彩5
const vec4 COLOR_4 = vec4(1.00, 1.00, 1.00, 1.00);
// 色彩6
const vec4 COLOR_5 = vec4(1.00, 1.00, 1.00, 1.00);

float hash21(vec2 p) {
    p = fract(p * vec2(0.3183099, 0.3678794)) + 0.1;
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
}

float valueNoise(vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

vec2 rotate(vec2 uv, float th) {
    return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv;
}

vec2 getPosition(int i, float t) {
    float fi = float(i);
    float a = fi * 0.37;
    float b = 0.6 + fract(fi / 3.0) * 0.9;
    float c = 0.8 + fract((fi + 1.0) / 4.0);
    float x = sin(t * b + a);
    float y = cos(t * c + a * 1.5);
    return 0.5 + 0.5 * vec2(x, y);
}

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;

    float t = (u_time * 0.001 + 41.5) * SPEED;

    vec2 grainUV = uv * 1000.0;
    float grain = valueNoise(grainUV);
    float mixerGrain = 0.4 * GRAIN_MIXER * (grain - 0.5);

    float radius = smoothstep(0.0, 1.0, length(uv - 0.5));
    float center = 1.0 - radius;

    for (float i = 1.0; i <= 2.0; i++) {
        uv.x += DISTORTION * center / i
            * sin(t + i * 0.4 * smoothstep(0.0, 1.0, uv.y))
            * cos(0.2 * t + i * 2.4 * smoothstep(0.0, 1.0, uv.y));
        uv.y += DISTORTION * center / i
            * cos(t + i * 2.0 * smoothstep(0.0, 1.0, uv.x));
    }

    vec2 uvRotated = uv - 0.5;
    float angle = 3.0 * SWIRL * radius;
    uvRotated = rotate(uvRotated, -angle);
    uvRotated += 0.5;

    vec3 color = vec3(0.0);
    float opacity = 0.0;
    float totalWeight = 0.0;

    for (int i = 0; i < 6; i++) {
        if (i >= COLOR_COUNT) break;

        vec4 c;
        if      (i == 0) c = COLOR_0;
        else if (i == 1) c = COLOR_1;
        else if (i == 2) c = COLOR_2;
        else if (i == 3) c = COLOR_3;
        else if (i == 4) c = COLOR_4;
        else             c = COLOR_5;

        vec2 pos = getPosition(i, t) + mixerGrain;

        float dist = length(uvRotated - pos);
        dist = pow(dist, DIST_POWER);
        float weight = 1.0 / (dist + 1e-3);

        color   += c.rgb * c.a * weight;
        opacity += c.a * weight;
        totalWeight += weight;
    }

    color   /= max(1e-4, totalWeight);
    opacity /= max(1e-4, totalWeight);

    float grainOverlay = valueNoise(rotate(grainUV, 1.0) + vec2(3.0));
    grainOverlay = mix(grainOverlay,
        valueNoise(rotate(grainUV, 2.0) + vec2(-1.0)), 0.5);
    grainOverlay = pow(grainOverlay, 1.3);
    float grainOverlayV = grainOverlay * 2.0 - 1.0;
    vec3  grainOverlayColor = vec3(step(0.0, grainOverlayV));
    float grainOverlayStrength = GRAIN_OVERLAY * abs(grainOverlayV);
    grainOverlayStrength = pow(grainOverlayStrength, 0.8);

    color    = mix(color, grainOverlayColor, 0.35 * grainOverlayStrength);
    opacity += 0.5 * grainOverlayStrength;
    opacity  = clamp(opacity, 0.0, 1.0);

    gl_FragColor = vec4(color, opacity);
}
`

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('[WelcomeShaderBackground] shader compile error:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

/**
 * Animated flowing-orange background rendered via WebGL. Drop it in as an
 * absolutely-positioned layer behind the modal content. Rendering is paused
 * while the tab is hidden and fully torn down on unmount, so it never spins
 * in the background once onboarding closes.
 */
export function WelcomeShaderBackground({
  className,
  style,
  fragmentSrc,
}: {
  className?: string
  style?: React.CSSProperties
  /** Override the built-in fragment shader (must be WebGL1/GLSL ES 1.0,
   *  using `u_time` + `u_resolution` uniforms). Defaults to the flowing
   *  cream/orange welcome shader. */
  fragmentSrc?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // WebGL 上下文丢失恢复:频繁 resize / GPU 压力(Windows 常见)会丢失上下文,
  // canvas 变白且不再渲染。丢失时 bump 这个 key,让 canvas 整体重挂,effect 重跑
  // 拿到全新上下文,自动复活。
  const [contextKey, setContextKey] = useState(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl', {
      premultipliedAlpha: false,
      alpha: true,
      antialias: true,
    })
    if (!gl) {
      console.error('[WelcomeShaderBackground] WebGL unavailable')
      return
    }

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC)
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc ?? FRAGMENT_SRC)
    if (!vs || !fs) return

    const program = gl.createProgram()
    if (!program) return
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[WelcomeShaderBackground] program link error:', gl.getProgramInfoLog(program))
      return
    }
    gl.useProgram(program)

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const aPosition = gl.getAttribLocation(program, 'a_position')
    gl.enableVertexAttribArray(aPosition)
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0)

    const uTime = gl.getUniformLocation(program, 'u_time')
    const uResolution = gl.getUniformLocation(program, 'u_resolution')

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.uniform2f(uResolution, canvas.width, canvas.height)
    }
    resize()

    let raf = 0
    let running = true
    const render = (time: number) => {
      if (!running) return
      gl.uniform1f(uTime, time)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)

    const onVisibility = () => {
      if (document.hidden) {
        running = false
        cancelAnimationFrame(raf)
      } else if (!running) {
        running = true
        raf = requestAnimationFrame(render)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    // 上下文丢失(频繁 resize / GPU 压力)时,阻止默认放弃行为并 bump key 重挂
    // canvas,useEffect 重跑拿到全新上下文,避免永久变白。
    const onContextLost = (e: Event) => {
      e.preventDefault()
      running = false
      cancelAnimationFrame(raf)
      setContextKey((k) => k + 1)
    }
    canvas.addEventListener('webglcontextlost', onContextLost)

    const observer = new ResizeObserver(() => resize())
    observer.observe(canvas)

    return () => {
      running = false
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      observer.disconnect()
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      // NB: deliberately NOT calling WEBGL_lose_context.loseContext() here.
      // Under React 18 StrictMode (dev) the effect runs mount→cleanup→mount on
      // the SAME canvas; losing the context permanently poisons it, so the
      // second mount silently gets a dead context and renders nothing (white).
      // The context is released when the canvas is GC'd on real unmount.
    }
  }, [fragmentSrc, contextKey])

  return <canvas key={contextKey} ref={canvasRef} className={className} style={style} aria-hidden="true" />
}
