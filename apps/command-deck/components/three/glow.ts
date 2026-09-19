import { AdditiveBlending, ShaderMaterial } from 'three'

/**
 * The material every luminous point layer in the deck uses.
 *
 * Points, not billboarded quads: a point sprite always faces the camera and
 * the whole layer is one draw call, which is what keeps 147 pulsing agents and
 * a hundred finding markers inside the frame budget. Size and brightness are
 * per-point attributes, so a scene animates a typed array rather than a scene
 * graph.
 * @returns A new additive point material; each layer owns its own instance.
 */
export function createGlowMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {},
    vertexShader: /* glsl */`
      attribute float aSize;
      attribute vec3 aColor;
      attribute float aGain;
      varying vec3 vColor;
      varying float vGain;
      void main() {
        vColor = aColor;
        vGain = aGain;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (320.0 / max(-mv.z, 0.001));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vColor;
      varying float vGain;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        float core = smoothstep(0.5, 0.06, d);
        float halo = smoothstep(0.5, 0.0, d) * 0.45;
        gl_FragColor = vec4(vColor * (core + halo), (core + halo) * vGain);
      }
    `,
  })
}
