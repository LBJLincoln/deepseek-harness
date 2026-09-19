/**
 * The additive materials the process pipeline is lit with.
 *
 * Every one of them is a single draw call over a buffer the scene writes from
 * `useFrame`: the rails are one mesh for all lanes, the comet trails are one
 * mesh for the whole flight pool, and a gate's glass, floor pool and time plane
 * animate through uniforms rather than through React. None writes depth, so the
 * layer order alone decides what reads in front of what.
 */

import { AdditiveBlending, Color, DoubleSide, ShaderMaterial, type IUniform } from 'three'

/** A material whose brightness the scene rewrites every frame. */
export interface DimmedMaterial {
  material: ShaderMaterial
  /** The `uGain` uniform, held directly so the frame loop never looks it up. */
  gain: IUniform<number>
}

/**
 * The comet trail material: one camera-facing ribbon per flight.
 *
 * The ribbon is widened in view space, so a trail keeps its thickness whatever
 * angle the camera holds and no geometry has to be rebuilt when it turns.
 * `aTangent` is the path direction at the vertex, `aSide` which of the ribbon's
 * two edges the vertex is, and `aGain` how bright that point of the trail is.
 * @returns A new trail material; each layer owns its own instance.
 */
export function createTrailMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms: {},
    vertexShader: /* glsl */`
      attribute vec3 aTangent;
      attribute float aSide;
      attribute float aWidth;
      attribute vec3 aColor;
      attribute float aGain;
      varying vec3 vColor;
      varying float vGain;
      varying float vSide;
      void main() {
        vColor = aColor;
        vGain = aGain;
        vSide = aSide;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 ahead = (modelViewMatrix * vec4(position + aTangent, 1.0)).xyz - mv.xyz;
        float run = length(ahead);
        vec3 across = run > 0.0001
          ? normalize(cross(ahead / run, vec3(0.0, 0.0, 1.0)))
          : vec3(1.0, 0.0, 0.0);
        mv.xyz += across * aSide * aWidth;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vColor;
      varying float vGain;
      varying float vSide;
      void main() {
        float body = smoothstep(1.0, 0.0, abs(vSide));
        gl_FragColor = vec4(vColor, body * body * vGain);
      }
    `,
  })
}

/**
 * The lane rail material: one strip and one wider halo per lane.
 *
 * `aAxis` runs `0..1` from the left edge of the pipeline to the right, and is
 * what fades a rail out rather than cutting it; `aGain` is the lane's current
 * brightness, which the scene raises while the lane's agents are acting.
 * @returns A new rail material; the rail layer owns one instance.
 */
export function createRailMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms: {},
    vertexShader: /* glsl */`
      attribute vec3 aColor;
      attribute float aGain;
      attribute float aAxis;
      attribute float aAcross;
      attribute float aHalo;
      varying vec3 vColor;
      varying float vGain;
      varying float vAxis;
      varying float vAcross;
      varying float vHalo;
      void main() {
        vColor = aColor;
        vGain = aGain;
        vAxis = aAxis;
        vAcross = aAcross;
        vHalo = aHalo;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vColor;
      varying float vGain;
      varying float vAxis;
      varying float vAcross;
      varying float vHalo;
      void main() {
        float body = smoothstep(1.0, 0.25, abs(vAcross));
        float ends = smoothstep(0.0, 0.07, vAxis) * smoothstep(1.0, 0.84, vAxis);
        gl_FragColor = vec4(vColor, body * ends * mix(1.0, 0.17, vHalo) * vGain);
      }
    `,
  })
}

/**
 * A gate's glass pane: frame-hugging sheen, fine mullions, a sill-lit gradient.
 * @param color - The gate's hex colour.
 * @returns A new pane material; each gate owns its own instance.
 */
export function createPaneMaterial(color: string): DimmedMaterial {
  const gain: IUniform<number> = { value: 1 }
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms: { uColor: { value: new Color(color) }, uGain: gain },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      uniform float uGain;
      varying vec2 vUv;
      void main() {
        float acrossEdge = 1.0 - abs((vUv.x * 2.0) - 1.0);
        float upEdge = 1.0 - abs((vUv.y * 2.0) - 1.0);
        float frame = pow(1.0 - acrossEdge, 4.0) + pow(1.0 - upEdge, 4.0);
        float sill = pow(1.0 - vUv.y, 2.5) * 0.16;
        float mullions = 0.018 * (0.5 + (0.5 * sin(vUv.x * 30.0)));
        gl_FragColor = vec4(uColor, ((frame * 0.2) + sill + mullions) * uGain);
      }
    `,
  })
  return { material, gain }
}

/**
 * The pool of light a gate casts on the floor.
 * @param color - The gate's hex colour.
 * @returns A new pool material; each gate owns its own instance.
 */
export function createPoolMaterial(color: string): DimmedMaterial {
  const gain: IUniform<number> = { value: 1 }
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms: { uColor: { value: new Color(color) }, uGain: gain },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      uniform float uGain;
      varying vec2 vUv;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float across = pow(max(0.0, 1.0 - abs(p.x)), 3.0);
        float along = 1.0 - smoothstep(0.45, 1.0, abs(p.y));
        gl_FragColor = vec4(uColor, across * along * uGain);
      }
    `,
  })
  return { material, gain }
}

/**
 * The time plane the timeline scrubber drags along the pipeline.
 * @returns A new time-plane material; the plane owns one instance.
 */
export function createTimePlaneMaterial(): DimmedMaterial {
  const gain: IUniform<number> = { value: 0 }
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms: { uColor: { value: new Color('#9fd6ff') }, uGain: gain },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      uniform float uGain;
      varying vec2 vUv;
      void main() {
        float across = smoothstep(0.0, 0.22, 1.0 - abs((vUv.x * 2.0) - 1.0));
        float up = smoothstep(1.0, 0.18, vUv.y);
        float rule = 0.5 + (0.5 * sin(vUv.y * 150.0));
        float sill = pow(1.0 - vUv.y, 6.0) * 0.26;
        gl_FragColor = vec4(uColor, (0.032 + (0.03 * rule) + sill) * across * up * uGain);
      }
    `,
  })
  return { material, gain }
}
