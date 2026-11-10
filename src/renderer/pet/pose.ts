/** Every animatable value of the pet model. Angles are in radians, offsets in model units. */
export interface Pose {
  /** Root rotation around Y; turns the pet to face left/right at a 3/4 angle. */
  yaw: number
  /** Vertical offset of the whole body (hops, crouches, lying down). */
  bodyY: number
  /** Tilt of the whole body around Z (nose up/down). */
  bodyPitch: number
  /** 0 = upright, 1 = flopped on its side. */
  roll: number
  /** Vertical scale (squash and stretch), 1 = normal. */
  squash: number
  neckPitch: number
  neckYaw: number
  /** Front-near, front-far, back-near, back-far leg swing around Z. */
  legs: [number, number, number, number]
  antenna: number
  tip: number
  /** 1 = eyes open, 0 = closed. */
  eyes: number
  /** 0..1 antenna glow. */
  glow: number
  /** 0..1 red flash. */
  tint: number
  /** 0 = no food on screen, else the food cube's remaining size (0..1). */
  food: number
}

export function neutralPose(): Pose {
  return {
    yaw: -0.55,
    bodyY: 0,
    bodyPitch: 0,
    roll: 0,
    squash: 1,
    neckPitch: 0,
    neckYaw: 0,
    legs: [0, 0, 0, 0],
    antenna: 0,
    tip: 0,
    eyes: 1,
    glow: 1,
    tint: 0,
    food: 0
  }
}

/** Values that snap instead of easing (so blinks and flashes stay crisp). */
const SNAP: (keyof Pose)[] = ['eyes', 'tint', 'food']

/** Ease `cur` toward `target` in place. */
export function easePose(cur: Pose, target: Pose, dt: number, rate = 14): void {
  const k = 1 - Math.exp(-rate * dt)
  for (const key of Object.keys(target) as (keyof Pose)[]) {
    if (key === 'legs') {
      for (let i = 0; i < 4; i++) cur.legs[i] += (target.legs[i] - cur.legs[i]) * k
    } else if (SNAP.includes(key)) {
      ;(cur[key] as number) = target[key] as number
    } else {
      ;(cur[key] as number) += ((target[key] as number) - (cur[key] as number)) * k
    }
  }
}

/** Stable short string used to skip rendering when nothing has changed. */
export function poseKey(p: Pose): string {
  const r = (n: number) => Math.round(n * 200)
  return [p.yaw, p.bodyY, p.bodyPitch, p.roll, p.squash, p.neckPitch, p.neckYaw, ...p.legs, p.antenna, p.tip, p.eyes, p.glow, p.tint, p.food]
    .map(r)
    .join(',')
}
