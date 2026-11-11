/** Face-screen expressions (index into the eye overlay textures). */
export const EXPRESSIONS = ['idle', 'blink', 'happy', 'hurt', 'alert', 'sad'] as const
export type Expression = (typeof EXPRESSIONS)[number]

/** Every animatable value of the catbot model. Angles in radians, offsets in model units. */
export interface Pose {
  /** Root rotation around Y; turns the catbot to face left/right at a 3/4 angle. */
  yaw: number
  /** Vertical offset of the whole body (hops, crouches, lying down). */
  bodyY: number
  /** Tilt of the whole body around Z (nose up/down; sitting). */
  bodyPitch: number
  /** 0 = upright, 1 = flopped on its side. */
  roll: number
  /** Vertical scale (squash and stretch), 1 = normal. */
  squash: number
  neckPitch: number
  neckYaw: number
  /** Head tilt (curious). */
  neckRoll: number
  /** Front-near, front-far, back-near, back-far leg swing around Z. */
  legs: [number, number, number, number]
  /** Ear angles (0 = upright, negative = flattened back). */
  earNear: number
  earFar: number
  /** Tail: lift of the base, curl along the segments, sideways sway. */
  tailLift: number
  tailCurl: number
  tailSway: number
  /** Index into EXPRESSIONS. */
  eyes: number
  /** 0..1 collar bell glow (well fed = bright). */
  glow: number
  /** 0..1 red flash. */
  tint: number
  /** 0 = no food on screen, else the food cube's remaining size (0..1). */
  food: number
}

export function expression(e: Expression): number {
  return EXPRESSIONS.indexOf(e)
}

export function neutralPose(): Pose {
  return {
    yaw: -0.75,
    bodyY: 0,
    bodyPitch: 0,
    roll: 0,
    squash: 1,
    neckPitch: 0,
    neckYaw: 0,
    neckRoll: 0,
    legs: [0, 0, 0, 0],
    earNear: 0,
    earFar: 0,
    tailLift: 0.6,
    tailCurl: 0.25,
    tailSway: 0,
    eyes: 0,
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
  return [
    p.yaw,
    p.bodyY,
    p.bodyPitch,
    p.roll,
    p.squash,
    p.neckPitch,
    p.neckYaw,
    p.neckRoll,
    ...p.legs,
    p.earNear,
    p.earFar,
    p.tailLift,
    p.tailCurl,
    p.tailSway,
    p.eyes,
    p.glow,
    p.tint,
    p.food
  ]
    .map(r)
    .join(',')
}
