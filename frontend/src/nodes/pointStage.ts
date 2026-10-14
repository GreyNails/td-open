import * as THREE from "three";
import type { GraphNode } from "../types";
import type { PointCloudSpec, Dance } from "./pointPerformance";
const vertex = `
attribute float phase;
uniform float uTime,uSize,uHeight,uVoice,uDrums,uHit,uBass,uOther,uPulse,uScale,uRipple,uColorMix;
uniform vec3 uWarm,uCool,uAccent;
varying vec3 vColor;varying float vAlpha;
void main(){
 vec3 p=position;float t=uTime;
 float push=uPulse*(uHit*.9+uDrums*.16)*(.45+.55*pow(sin(p.y*6.-t*3.+phase*6.28),2.));
 p+=normal*push;
 p.x+=uOther*uRipple*sin(position.y*4.+t*.7+phase*4.);
 p.y+=uOther*uRipple*.45*sin(position.x*5.+t*.9+phase*6.);
 p.z+=uOther*uRipple*.65*cos(position.y*3.-t*.6+phase*5.);
 p*=1.+uBass*uScale;
 float yaw=.16+sin(t*.12)*.19;mat2 turn=mat2(cos(yaw),-sin(yaw),sin(yaw),cos(yaw));p.xz=turn*p.xz;
 vec4 view=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*view;
 gl_PointSize=clamp(uSize*(uHeight/720.)*(5.5/max(2.,-view.z))*(.75+phase*.7+uHit*.24),1.,12.);
 float band=.5+.5*sin(position.y*2.7+phase*.8+t*.09);
 float voice=clamp(uVoice*uColorMix*.72+band*.23,0.,1.);
 vColor=mix(uWarm,uCool,voice);vColor=mix(vColor,uAccent,pow(phase,8.)*.7);
 vColor=mix(vColor,vec3(1.,.96,.86),max(0.,normal.z)*.2);
 vec3 viewNormal=normalize(normalMatrix*vec3(turn*normal.xz,normal.y).xzy);
 vAlpha=(.5+phase*.46+.15*uDrums)*(.3+.7*smoothstep(-.1,.65,viewNormal.z));
}`;
const fragment = `
uniform float uGlow;varying vec3 vColor;varying float vAlpha;
void main(){vec2 p=gl_PointCoord-.5;float r=dot(p,p)*4.;if(r>1.)discard;
 float intensity=(exp(-r*15.)*.83+exp(-r*3.8)*.21)*vAlpha*uGlow;
 gl_FragColor=vec4(vColor,intensity);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;
const silent: Dance = {
  time: 0,
  vocals: 0,
  drums: 0,
  hit: 0,
  bass: 0,
  other: 0,
  pulse: 0.12,
  scale: 0.14,
  ripple: 0.075,
  colorMix: 0.75,
};
export class PointStage {
  private canvas = document.createElement("canvas");
  private background = document.createElement("canvas");
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 30);
  private material: THREE.ShaderMaterial;
  private geometry?: THREE.BufferGeometry;
  private points?: THREE.Points;
  private mesh?: PointCloudSpec["mesh"];
  private backgroundKey = "";
  constructor() {
    this.camera.position.set(0, 0.1, 6.6);
    this.camera.lookAt(0, 0.04, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: 2.8 },
        uHeight: { value: 720 },
        uGlow: { value: 1.1 },
        uVoice: { value: 0 },
        uDrums: { value: 0 },
        uHit: { value: 0 },
        uBass: { value: 0 },
        uOther: { value: 0 },
        uPulse: { value: 0.12 },
        uScale: { value: 0.14 },
        uRipple: { value: 0.075 },
        uColorMix: { value: 0.75 },
        uWarm: { value: new THREE.Color("#ffdda9") },
        uCool: { value: new THREE.Color("#71e7e1") },
        uAccent: { value: new THREE.Color("#bba1ff") },
      },
    });
  }
  dispose() {
    this.geometry?.dispose();
    this.material.dispose();
    this.scene.clear();
  }
  private upload(spec: PointCloudSpec) {
    if (spec.mesh === this.mesh) return;
    this.mesh = spec.mesh;
    this.geometry?.dispose();
    if (this.points) this.scene.remove(this.points);
    this.geometry = new THREE.BufferGeometry();
    const mesh = spec.mesh;
    if (!mesh?.positions.length) {
      this.points = undefined;
      return;
    }
    this.geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(mesh.positions.flat(), 3),
    );
    this.geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(
        (mesh.pointAttributes?.N || mesh.positions.map(() => [0, 1, 0])).flat(),
        3,
      ),
    );
    this.geometry.setAttribute(
      "phase",
      new THREE.Float32BufferAttribute(
        (
          mesh.pointAttributes?.phase ||
          mesh.positions.map((_, i) => [(i * 0.6180339) % 1])
        ).flat(),
        1,
      ),
    );
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }
  render(
    spec: PointCloudSpec,
    node: GraphNode,
    renderer: THREE.WebGLRenderer,
    thumbnail = false,
  ): HTMLCanvasElement {
    const p = node.data.params,
      w = thumbnail
        ? 320
        : Math.max(640, Math.min(1920, Number(p.width) || 1280)),
      h = thumbnail
        ? 180
        : Math.max(360, Math.min(1080, Number(p.height) || 720));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const ctx = this.canvas.getContext("2d")!,
      d = spec.pointDance || silent;
    this.upload(spec);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const u = this.material.uniforms;
    for (const [key, val] of Object.entries({
      uTime: d.time,
      uVoice: d.vocals,
      uDrums: d.drums,
      uHit: d.hit,
      uBass: d.bass,
      uOther: d.other,
      uPulse: d.pulse,
      uScale: d.scale,
      uRipple: d.ripple,
      uColorMix: d.colorMix,
      uHeight: h,
      uSize: Number(p.point_size) || 2.8,
      uGlow: Number(p.glow) || 1.15,
    }))
      u[key].value = val;
    for (const [key, param, defaultColor] of [
      ["uWarm", "warm", "#ffdda9"],
      ["uCool", "cool", "#71e7e1"],
      ["uAccent", "accent", "#bba1ff"],
    ])
      u[key].value.set(String(p[param] || defaultColor));
    const key = w + ":" + h;
    if (this.backgroundKey !== key) {
      this.backgroundKey = key;
      this.background.width = w;
      this.background.height = h;
      const b = this.background.getContext("2d")!;
      b.fillStyle = "#040b13";
      b.fillRect(0, 0, w, h);
      for (const [x, y, r, color] of [
        [0.51, 0.47, 0.64, "rgba(35,102,108,0.16)"],
        [0.68, 0.63, 0.44, "rgba(73,36,99,0.15)"],
        [0.36, 0.3, 0.38, "rgba(137,83,50,0.09)"],
      ] as [number, number, number, string][]) {
        const gradient = b.createRadialGradient(
          w * x,
          h * y,
          0,
          w * x,
          h * y,
          h * r,
        );
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        b.fillStyle = gradient;
        b.fillRect(0, 0, w, h);
      }
      for (let i = 0; i < 160; i++) {
        const x = (((Math.sin(i * 37.2) * 43758.5) % 1) + 1) % 1,
          y = (((Math.sin(i * 17.9) * 9315.1) % 1) + 1) % 1;
        b.fillStyle = `rgba(167,210,208,${0.08 + (i % 7) * 0.018})`;
        b.fillRect(x * w, y * h, i % 13 === 0 ? 1.5 : 1, 1);
      }
    }
    ctx.drawImage(this.background, 0, 0);
    ctx.save();
    ctx.translate(w * 0.5, h * 0.48);
    ctx.strokeStyle = "rgba(105,181,184,.095)";
    ctx.lineWidth = w / 1280;
    ctx.rotate(-0.17);
    ctx.beginPath();
    ctx.ellipse(0, 0, h * 0.39, h * 0.43, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(196,158,111,.11)";
    ctx.beginPath();
    ctx.ellipse(0, 0, h * 0.48, h * 0.17, 0.28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    if (this.points) {
      this.geometry!.setDrawRange(
        0,
        thumbnail
          ? Math.min(4500, this.mesh!.positions.length)
          : this.mesh!.positions.length,
      );
      const clear = renderer.getClearColor(new THREE.Color()),
        alpha = renderer.getClearAlpha();
      try {
        renderer.setSize(w, h, false);
        renderer.setClearColor("#000000", 0);
        renderer.render(this.scene, this.camera);
        ctx.drawImage(renderer.domElement, 0, 0, w, h);
      } finally {
        renderer.setClearColor(clear, alpha);
      }
    }
    if (!thumbnail) {
      const scale = w / 1280;
      ctx.save();
      ctx.scale(scale, scale);
      const H = h / scale;
      ctx.strokeStyle = "rgba(166,209,203,.16)";
      ctx.lineWidth = 1;
      ctx.strokeRect(32, 28, 1216, H - 56);
      ctx.fillStyle = "#b4c2bd";
      ctx.font = "11px sans-serif";
      ctx.letterSpacing = "3px";
      ctx.fillText("AUDIO SCULPTURE / 01", 57, 55);
      ctx.letterSpacing = "0px";
      ctx.fillStyle = "#f4e3c8";
      ctx.font = "28px sans-serif";
      ctx.fillText(String(p.title || "潮汐之像"), 58, H - 70);
      ctx.font = "10px sans-serif";
      ctx.letterSpacing = "2px";
      ctx.fillStyle = "#8aaca9";
      ctx.fillText(
        String(p.subtitle || "TIDAL MUSE · WHERE SOUND BECOMES FORM"),
        59,
        H - 47,
      );
      ctx.letterSpacing = "0px";
      const tracks = [
        ["VOICE", d.vocals, "#f0ceb0"],
        ["DRUMS", Math.max(d.drums, d.hit), "#92e0d7"],
        ["BASS", d.bass, "#b89dde"],
        ["AIR", d.other, "#9eaacb"],
      ] as [string, number, string][];
      tracks.forEach(([label, energy, color], i) => {
        const x = 900 + i * 77;
        ctx.fillStyle = "#748d91";
        ctx.font = "9px sans-serif";
        ctx.fillText(label, x, H - 73);
        ctx.fillStyle = "rgba(93,128,134,.17)";
        ctx.fillRect(x, H - 57, 49, 2);
        ctx.fillStyle = color;
        ctx.fillRect(x, H - 57, 49 * energy, 2);
      });
      if (!this.points) {
        ctx.textAlign = "center";
        ctx.fillStyle = "#91a2a4";
        ctx.font = "14px sans-serif";
        ctx.fillText(
          "生成图片 · 三维 · 音乐 · 分轨，随后启用声景演出",
          640,
          H * 0.49,
        );
      }
      ctx.restore();
    }
    return this.canvas;
  }
}
