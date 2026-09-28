import { useEffect, useRef } from 'react'

/**
 * Raw-WebGL aurora: a domain-warped simplex-fbm fragment shader tinted with the
 * five spectrum hues over the theme canvas. No three.js. Rendered at reduced
 * resolution (the CSS scales it up — soft light needs no sharpness), DPR
 * capped at 1.5, frame-capped, paused while hidden/offscreen, and resilient to
 * context loss. Loaded lazily by AuroraBackground.
 */

const VERT = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uPtr;
uniform vec3 uBase;
uniform float uStrength;
uniform vec3 uC0;uniform vec3 uC1;uniform vec3 uC2;uniform vec3 uC3;uniform vec3 uC4;

vec3 permute(vec3 x){return mod(((x*34.0)+1.0)*x,289.0);}
float snoise(vec2 v){
  const vec4 C=vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
  vec2 i=floor(v+dot(v,C.yy));
  vec2 x0=v-i+dot(i,C.xx);
  vec2 i1=(x0.x>x0.y)?vec2(1.0,0.0):vec2(0.0,1.0);
  vec4 x12=x0.xyxy+C.xxzz;
  x12.xy-=i1;
  i=mod(i,289.0);
  vec3 p=permute(permute(i.y+vec3(0.0,i1.y,1.0))+i.x+vec3(0.0,i1.x,1.0));
  vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.0);
  m=m*m;m=m*m;
  vec3 x=2.0*fract(p*C.www)-1.0;
  vec3 h=abs(x)-0.5;
  vec3 ox=floor(x+0.5);
  vec3 a0=x-ox;
  m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);
  vec3 g;
  g.x=a0.x*x0.x+h.x*x0.y;
  g.yz=a0.yz*x12.xz+h.yz*x12.yw;
  return 130.0*dot(m,g);
}
float fbm(vec2 p){
  float a=0.55;float s=0.0;
  for(int i=0;i<3;i++){s+=a*snoise(p);p=p*1.9+vec2(3.1,1.7);a*=0.42;}
  return s;
}
vec3 spectrum(float h){
  h=mod(h,5.0);
  vec3 c=mix(uC0,uC1,smoothstep(0.0,1.0,h));
  c=mix(c,uC2,smoothstep(1.0,2.0,h));
  c=mix(c,uC3,smoothstep(2.0,3.0,h));
  c=mix(c,uC4,smoothstep(3.0,4.0,h));
  c=mix(c,uC0,smoothstep(4.0,5.0,h));
  return c;
}
float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}

void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  float asp=uRes.x/uRes.y;
  vec2 p=(uv-0.5)*vec2(asp,1.0)*0.55;
  p+=(uPtr-0.5)*vec2(0.16,-0.1);
  float t=uTime*0.05;
  vec2 q=vec2(fbm(p+vec2(0.0,t)),fbm(p+vec2(5.2,1.3)-t));
  vec2 r=vec2(fbm(p+1.5*q+vec2(1.7,9.2)+t*1.3),fbm(p+1.5*q+vec2(8.3,2.8)-t*0.8));
  float f=fbm(p*0.9+1.6*r);
  float band=smoothstep(0.05,0.95,0.5+0.6*f);
  band=mix(band,band*band,0.5);
  band*=0.4+0.6*smoothstep(-0.7,0.7,r.y);
  float hue=(0.5+0.5*r.x)*2.6+p.x*0.5+p.y*0.4+t*2.0;
  vec3 tint=spectrum(hue);
  float vert=0.5+0.5*smoothstep(0.0,1.0,uv.y);
  float k=clamp(band*uStrength*vert,0.0,0.92);
  vec3 col=mix(uBase,tint,k);
  // soft vignette back to the base so page chrome always sits on calm color
  float vig=smoothstep(1.15,0.35,length((uv-0.5)*vec2(1.0,1.15)));
  col=mix(uBase,col,0.55+0.45*vig);
  col+=(hash(gl_FragCoord.xy+uTime)-0.5)/255.0;
  gl_FragColor=vec4(col,1.0);
}
`

export interface AuroraCanvasProps {
  /** 0–1.5; scales how much spectrum light mixes into the canvas color. */
  intensity: number
  parallax: boolean
  /** Internal render scale relative to CSS pixels (before the DPR cap). */
  resolution: number
  fps: number
  onReady: () => void
  onUnsupported: () => void
}

function readTriplet(style: CSSStyleDeclaration, name: string): [number, number, number] {
  const parts = style.getPropertyValue(name).trim().split(/\s+/).map(Number)
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return [0.05, 0.04, 0.07]
  return [parts[0] / 255, parts[1] / 255, parts[2] / 255]
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

export default function AuroraCanvas({ intensity, parallax, resolution, fps, onReady, onUnsupported }: AuroraCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cbRef = useRef({ onReady, onUnsupported })
  useEffect(() => {
    cbRef.current = { onReady, onUnsupported }
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const cvs: HTMLCanvasElement = canvas

    let gl: WebGLRenderingContext | null = null
    let program: WebGLProgram | null = null
    let uniforms: Record<string, WebGLUniformLocation | null> = {}
    let raf = 0
    let running = false
    let visible = true
    let inView = true
    let lost = false
    let disposed = false
    let last = 0
    let time = 8 + Math.random() * 40
    let readyFired = false
    const ptr = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 }
    const frameGap = 1000 / Math.max(6, fps)

    function setup(): boolean {
      gl = (cvs.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power', preserveDrawingBuffer: false }) as WebGLRenderingContext | null)
      if (!gl) return false
      const vs = compile(gl, gl.VERTEX_SHADER, VERT)
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
      if (!vs || !fs) return false
      program = gl.createProgram()
      if (!program) return false
      gl.attachShader(program, vs)
      gl.attachShader(program, fs)
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false
      gl.useProgram(program)
      const buffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
      const loc = gl.getAttribLocation(program, 'p')
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
      uniforms = {}
      for (const name of ['uRes', 'uTime', 'uPtr', 'uBase', 'uStrength', 'uC0', 'uC1', 'uC2', 'uC3', 'uC4']) {
        uniforms[name] = gl.getUniformLocation(program, name)
      }
      applyTheme()
      resize()
      return true
    }

    function applyTheme() {
      if (!gl) return
      const root = document.documentElement
      const style = getComputedStyle(root)
      const light = root.getAttribute('data-theme') === 'light'
      gl.uniform3fv(uniforms.uBase, readTriplet(style, '--canvas'))
      for (let i = 0; i < 5; i += 1) gl.uniform3fv(uniforms[`uC${i}`], readTriplet(style, `--aurora-${i + 1}`))
      // Dark: luminous light mixed in lightly. Light: pastel wash, even lighter.
      gl.uniform1f(uniforms.uStrength, (light ? 0.3 : 0.36) * intensity)
    }

    function resize() {
      if (!gl) return
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      const scale = Math.max(0.2, Math.min(1, resolution)) * dpr
      const w = Math.max(2, Math.round(cvs.clientWidth * scale))
      const h = Math.max(2, Math.round(cvs.clientHeight * scale))
      if (cvs.width !== w || cvs.height !== h) {
        cvs.width = w
        cvs.height = h
      }
      gl.viewport(0, 0, w, h)
      gl.uniform2f(uniforms.uRes, w, h)
    }

    function draw(now: number) {
      raf = 0
      if (!running || !gl || lost) return
      raf = requestAnimationFrame(draw)
      const dt = now - last
      if (dt < frameGap) return
      last = now
      time += Math.min(dt, 100) / 1000
      ptr.x += (ptr.tx - ptr.x) * 0.06
      ptr.y += (ptr.ty - ptr.y) * 0.06
      gl.uniform1f(uniforms.uTime, time)
      gl.uniform2f(uniforms.uPtr, ptr.x, ptr.y)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      if (!readyFired) {
        readyFired = true
        cbRef.current.onReady()
      }
    }

    function sync() {
      const shouldRun = visible && inView && !lost && !disposed
      if (shouldRun && !running) {
        running = true
        last = performance.now()
        raf = requestAnimationFrame(draw)
      } else if (!shouldRun && running) {
        running = false
        if (raf) cancelAnimationFrame(raf)
        raf = 0
      }
    }

    if (!setup()) {
      cbRef.current.onUnsupported()
      return
    }

    const onVisibility = () => {
      visible = !document.hidden
      sync()
    }
    const onPointer = (event: PointerEvent) => {
      ptr.tx = event.clientX / window.innerWidth
      ptr.ty = event.clientY / window.innerHeight
    }
    const onLost = (event: Event) => {
      event.preventDefault()
      lost = true
      sync()
    }
    const onRestored = () => {
      lost = false
      readyFired = false
      if (setup()) sync()
      else cbRef.current.onUnsupported()
    }

    document.addEventListener('visibilitychange', onVisibility)
    if (parallax) window.addEventListener('pointermove', onPointer, { passive: true })
    cvs.addEventListener('webglcontextlost', onLost)
    cvs.addEventListener('webglcontextrestored', onRestored)

    const ro = new ResizeObserver(() => {
      resize()
      // Repaint immediately so resizes never flash a cleared frame while paused.
      if (gl && !running && !lost) gl.drawArrays(gl.TRIANGLES, 0, 3)
    })
    ro.observe(cvs)
    const io = new IntersectionObserver((entries) => {
      inView = entries[entries.length - 1].isIntersecting
      sync()
    })
    io.observe(cvs)
    const mo = new MutationObserver(applyTheme)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    sync()

    return () => {
      disposed = true
      running = false
      if (raf) cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pointermove', onPointer)
      cvs.removeEventListener('webglcontextlost', onLost)
      cvs.removeEventListener('webglcontextrestored', onRestored)
      ro.disconnect()
      io.disconnect()
      mo.disconnect()
      const ext = gl?.getExtension('WEBGL_lose_context')
      ext?.loseContext()
    }
  }, [fps, intensity, parallax, resolution])

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
}
