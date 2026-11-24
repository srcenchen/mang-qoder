export type SurfaceTag =
  | 'tactile_line'
  | 'tactile_dot'
  | 'manhole' | 'puddle' | 'guardrail' | 'bus_stop'
  | 'bike'
  | 'barrier'
  | 'stall'
  | 'cat'
  | 'door'
  | 'cane_pickup'
  | 'signal_pole'
  | 'interior_tile'
  | 'crosswalk'
  | 'wall'
  | 'normal';

export interface ColliderBox {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
  tag: SurfaceTag;
  isObstacle?: boolean;
  enabled: boolean;
}

export interface AcousticBeacon {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  color: 'amber' | 'cyan' | 'alarm';
  radius: number;
  active: boolean;
}

export interface MicroInteraction {
  id: 'bike_report' | 'pet_cat' | 'signal_pole';
  promptText: string;
  brailleHint: string;
  x: number;
  z: number;
  radius: number;
  completed: boolean;
  unlocked: boolean;
}

export interface LevelWaypoints {
  playerStart: { x: number; y: number; z: number };
  canePickupPos: { x: number; y: number; z: number };
  foyerDoorZ: number;
  firstTactileZ: number;
  turn1Pos: { x: number; z: number };
  bikesCenter: { x: number; z: number };
  barrierCenter: { x: number; z: number };
  turn2Pos: { x: number; z: number };
  stallLightPos: { x: number; y: number; z: number };
  catPos: { x: number; y: number; z: number };
  signalPolePos: { x: number; y: number; z: number };
  crosswalkCenterX: number;
  crosswalkPromptZ: number;
  crosswalkCurbZ: number;
  crosswalkHalfWidth: number;
  pedestrianPos: { x: number; y: number; z: number };
  sunsetFinishZ: number;
}

export const PLAYER_EYE_HEIGHT = 1.6;
export const PLAYER_RADIUS = 0.32;

// Distances along the folded route. Move features rigidly and rebuild continuous
// floors, buildings and rails from the relocated endpoints.
const gapAfterBikes = 4.5;
const gapBeforePuddle = 4.5;
const approachToStop = -3.5;
const gapAfterStop = 5;

export function streetX(x: number): number {
  return x > 7.5 ? x + gapAfterBikes : x;
}

export function streetZ(z: number): number {
  if (z <= -40.75) return z - (gapBeforePuddle + approachToStop + gapAfterStop);
  if (z <= -32) return z - (gapBeforePuddle + approachToStop);
  if (z <= -20) return z - gapBeforePuddle;
  return z;
}

export const WAYPOINTS: LevelWaypoints = {
  playerStart: { x: 0, y: PLAYER_EYE_HEIGHT, z: 1.5 },
  canePickupPos: { x: 1.62, y: 0.0, z: -2.35 },
  foyerDoorZ: -5.5,
  firstTactileZ: -6.4,
  turn1Pos: { x: 0, z: -15.6 },
  bikesCenter: { x: 4.8, z: -15.6 },
  barrierCenter: { x: streetX(9.2), z: -15.6 },
  turn2Pos: { x: streetX(14), z: -15.6 },
  stallLightPos: { x: streetX(11.55), y: 2.25, z: streetZ(-23.6) },
  catPos: { x: streetX(12.83), y: 0.08, z: streetZ(-23.6) },
  signalPolePos: { x: streetX(15.55), y: 0.08, z: streetZ(-41.25) },
  crosswalkCenterX: streetX(14),
  crosswalkPromptZ: streetZ(-40.85),
  crosswalkCurbZ: streetZ(-41.68),
  crosswalkHalfWidth: 1.85 * 1.4,
  pedestrianPos: { x: streetX(14), y: 0.08, z: streetZ(-52.7) },
  sunsetFinishZ: streetZ(-52.4),
};

export const CROSSWALK_ROAD = {
  nearCurbZ: streetZ(-41.85),
  farCurbZ: streetZ(-51.75),
  eastboundZ: streetZ(-44.9),
  westboundZ: streetZ(-48.7),
  spawnOffsetX: 26,
  retireOffsetX: 30,
};

export const STREET = {
  manhole: { x: 0.244, z: -10.8, radius: 0.34 },
  puddle: { x: streetX(13.36), z: streetZ(-20.4), rx: 0.62, rz: 0.96 },
  gapStartX: streetX(9.6), gapEndZ: -18.2,
  stop: { minX: streetX(13.65), maxX: streetX(16.78), minZ: streetZ(-40.65), maxZ: streetZ(-36.2) },
  busLane: { x: streetX(18.05), stopZ: streetZ(-38.2) },
};

export function puddleRadius(angle: number): number {
  return 1 + 0.08 * Math.cos(3 * angle) + 0.065 * Math.sin(5 * angle) + 0.035 * Math.sin(8 * angle);
}

export function isNearPuddle(x: number, z: number, margin: number): boolean {
  const { puddle } = STREET;
  const u = (x - puddle.x) / (puddle.rx + margin);
  const v = (z - puddle.z) / (puddle.rz + margin);
  const distanceSquared = u * u + v * v;
  return distanceSquared < 1.44 && distanceSquared <= puddleRadius(Math.atan2(v, u)) ** 2;
}

export function groundFeature(x: number, z: number): 'manhole' | 'puddle' | null {
  const { manhole } = STREET;
  if ((x - manhole.x) ** 2 + (z - manhole.z) ** 2 <= manhole.radius ** 2) return 'manhole';
  return isNearPuddle(x, z, 0) ? 'puddle' : null;
}

export const streetFixtures = [
  { id: 'guide_rail_east', x: streetX(10.1), z: -17.35, width: 4.3, depth: 0.06, height: 0.9, tag: 'guardrail' },
  { id: 'guide_rail_north', x: streetX(12.25), z: -18.32, width: 0.06, depth: 2, height: 0.9, tag: 'guardrail' },
  { id: 'bus_post_a', x: streetX(15.12), z: streetZ(-37.25), width: 0.12, depth: 0.12, height: 2.35, tag: 'bus_stop' },
  { id: 'bus_back_panel', x: streetX(15.12), z: STREET.busLane.stopZ, width: 0.06, depth: 1.88, height: 1.45, tag: 'bus_stop' },
  { id: 'bus_post_b', x: streetX(15.12), z: streetZ(-39.15), width: 0.12, depth: 0.12, height: 2.35, tag: 'bus_stop' },
] as const;

export function isOnTactilePath(x: number, z: number): boolean {
  const offset = Math.abs(x - WAYPOINTS.crosswalkCenterX);
  if (z <= -5.6 && z >= -16.1 && Math.abs(x) < 0.52) return true;
  if (x >= -0.48 && x <= STREET.gapStartX && Math.abs(z + 15.6) < 0.52) return true;
  if (z <= STREET.gapEndZ && z >= streetZ(-41.75) && offset < 0.52) return true;
  if (z <= streetZ(-40.8) && z >= streetZ(-41.82) && offset < WAYPOINTS.crosswalkHalfWidth) return true;
  return z <= streetZ(-51.8) && z >= streetZ(-55.8) && offset < WAYPOINTS.crosswalkHalfWidth;
}

export function createInitialBeacons(): AcousticBeacon[] {
  return [
    {
      id: 'cane_beacon',
      label: '导盲杖',
      x: WAYPOINTS.canePickupPos.x,
      y: 0.5,
      z: WAYPOINTS.canePickupPos.z,
      color: 'cyan',
      radius: 8,
      active: true,
    },
    {
      id: 'door_breeze',
      label: '室外雨声',
      x: 0,
      y: 1.2,
      z: -5.8,
      color: 'cyan',
      radius: 9,
      active: false,
    },
    {
      id: 'turn1_corner',
      label: '街角转向砖',
      x: WAYPOINTS.turn1Pos.x,
      y: 0.3,
      z: WAYPOINTS.turn1Pos.z,
      color: 'amber',
      radius: 10,
      active: true,
    },
    {
      id: 'barrier_beacon',
      label: '施工警示灯',
      x: WAYPOINTS.barrierCenter.x,
      y: 1.15,
      z: WAYPOINTS.barrierCenter.z,
      color: 'amber',
      radius: 11,
      active: true,
    },
    {
      id: 'stall_sizzle',
      label: '早点摊蒸气',
      x: WAYPOINTS.stallLightPos.x,
      y: 1.3,
      z: WAYPOINTS.stallLightPos.z,
      color: 'amber',
      radius: 13,
      active: true,
    },
    {
      id: 'cat_purr',
      label: '街角小猫',
      x: WAYPOINTS.catPos.x,
      y: 0.3,
      z: WAYPOINTS.catPos.z,
      color: 'amber',
      radius: 7,
      active: true,
    },
    {
      id: 'crosswalk_traffic',
      label: '路口车流',
      x: WAYPOINTS.crosswalkCenterX,
      y: 0.8,
      z: streetZ(-46),
      color: 'amber',
      radius: 15,
      active: true,
    },
    {
      id: 'stranger_voice',
      label: '热心路人',
      x: WAYPOINTS.pedestrianPos.x,
      y: 1.5,
      z: WAYPOINTS.pedestrianPos.z,
      color: 'amber',
      radius: 20,
      active: false,
    },
  ];
}

export function createInitialMicroInteractions(): MicroInteraction[] {
  return [
    {
      id: 'bike_report',
      promptText: '标记违停占道点 [E]',
      brailleHint: '⠍⠁⠗⠅ ⠃⠊⠅⠑',
      x: WAYPOINTS.bikesCenter.x,
      z: WAYPOINTS.bikesCenter.z,
      radius: 2.45,
      completed: false,
      unlocked: true,
    },
    {
      id: 'pet_cat',
      promptText: '蹲下轻抚街角小猫 [E]',
      brailleHint: '⠏⠑⠞ ⠉⠁⠞',
      x: WAYPOINTS.catPos.x,
      z: WAYPOINTS.catPos.z,
      radius: 2.25,
      completed: false,
      unlocked: true,
    },
    {
      id: 'signal_pole',
      promptText: '触摸路口信号灯柱 [E]',
      brailleHint: '⠉⠓⠑⠉⠅ ⠏⠕⠇⠑',
      x: WAYPOINTS.signalPolePos.x,
      z: WAYPOINTS.signalPolePos.z,
      radius: 2.0,
      completed: false,
      unlocked: true,
    },
  ];
}

export function createInitialColliders(): ColliderBox[] {
  return [
    ...streetFixtures.map(f => ({
      id: f.id, minX: f.x - f.width / 2, maxX: f.x + f.width / 2,
      minZ: f.z - f.depth / 2, maxZ: f.z + f.depth / 2,
      height: f.height, tag: f.tag, enabled: true,
    })),
    { id: 'boarding_boundary', minX: streetX(9.4), maxX: streetX(18), minZ: STREET.stop.minZ - 0.15, maxZ: STREET.stop.minZ + 0.1,
      height: 1, tag: 'normal', enabled: true },
    // === Scene 1: Dim Foyer (Z = +2.4 to -5.5, X = -1.9 to +1.9) ===
    {
      id: 'foyer_back_wall',
      minX: -2.2,
      maxX: 2.2,
      minZ: 2.35,
      maxZ: 2.75,
      height: 2.8,
      tag: 'wall',
      enabled: true,
    },
    {
      id: 'foyer_left_wall',
      minX: -2.25,
      maxX: -1.9,
      minZ: -5.6,
      maxZ: 2.5,
      height: 2.8,
      tag: 'wall',
      enabled: true,
    },
    {
      id: 'foyer_right_wall',
      minX: 1.9,
      maxX: 2.25,
      minZ: -5.6,
      maxZ: 2.5,
      height: 2.8,
      tag: 'wall',
      enabled: true,
    },
    {
      id: 'foyer_shoe_cabinet',
      minX: -1.9,
      maxX: -1.32,
      minZ: -3.25,
      maxZ: -1.25,
      height: 1.08,
      tag: 'stall',
      enabled: true,
    },
    {
      id: 'foyer_door_jamb_left',
      minX: -4.2,
      maxX: -0.64,
      minZ: -5.68,
      maxZ: -5.36,
      height: 2.8,
      tag: 'wall',
      enabled: true,
    },
    {
      id: 'foyer_door_jamb_right',
      minX: 0.64,
      maxX: 3.1,
      minZ: -5.68,
      maxZ: -5.36,
      height: 2.8,
      tag: 'wall',
      enabled: true,
    },
    {
      id: 'foyer_security_door',
      minX: -0.66,
      maxX: 0.66,
      minZ: -5.62,
      maxZ: -5.4,
      height: 2.2,
      tag: 'door',
      enabled: true,
    },

    // === Z-Turn Street Outer Boundaries (Zero wall clipping, >= 1.68m bypass lanes) ===
    // Leg 1 West Building Facade (X = -3.85, Z = -5.4 to -18.5)
    {
      id: 'leg1_west_wall',
      minX: -4.4,
      maxX: -3.85,
      minZ: -18.6,
      maxZ: -5.4,
      height: 6.0,
      tag: 'wall',
      enabled: true,
    },
    // Leg 1 East Sidewalk Guardrail (stops at Z = -12.6 to open smoothly into Leg 2!)
    {
      id: 'leg1_east_guardrail',
      minX: 2.55,
      maxX: 2.95,
      minZ: -12.6,
      maxZ: -5.4,
      height: 1.2,
      tag: 'wall',
      enabled: true,
    },
    // Leg 2 North Building Facade (Z = -18.2, X = -4.2 to +9.85 — forms Corner #1 & Corner #2!)
    {
      id: 'leg2_north_wall',
      minX: -4.2,
      maxX: streetX(9.85),
      minZ: -18.65,
      maxZ: -18.2,
      height: 6.0,
      tag: 'wall',
      enabled: true,
    },
    // Leg 2 South Sidewalk Guardrail (Z = -12.6, X = 2.55 to 17.05)
    {
      id: 'leg2_south_guardrail',
      minX: 2.55,
      maxX: streetX(17.05),
      minZ: -12.6,
      maxZ: -12.2,
      height: 1.2,
      tag: 'wall',
      enabled: true,
    },
    // Leg 3 West Building Facade (X = 9.85, Z = -18.2 to -42.0)
    {
      id: 'leg3_west_wall',
      minX: streetX(9.35),
      maxX: streetX(9.85),
      minZ: streetZ(-42.0),
      maxZ: -18.2,
      height: 6.0,
      tag: 'wall',
      enabled: true,
    },
    // Leg 3 West Crosswalk & Plaza Bound (X = 9.85, Z = -42.0 to -56.2)
    {
      id: 'leg3_west_crosswalk_bound',
      minX: streetX(9.35),
      maxX: streetX(9.85),
      minZ: streetZ(-56.2),
      maxZ: streetZ(-42.0),
      height: 1.4,
      tag: 'wall',
      enabled: true,
    },
    // Leg 3 East Guardrail & Crosswalk East Bound (X = 16.65, Z = -12.2 to -56.2)
    {
      id: 'leg3_east_guardrail',
      minX: streetX(16.65),
      maxX: streetX(17.05),
      minZ: streetZ(-36.2),
      maxZ: -12.2,
      height: 1.4,
      tag: 'wall',
      enabled: true,
    },
    // Open rail at the shelter. The kerb edge still keeps walkers out of the live bus lane.
    { id: 'platform_kerb', minX: streetX(16.85), maxX: streetX(17.05), minZ: streetZ(-40.4), maxZ: streetZ(-36.2),
      height: 0.12, tag: 'normal', enabled: true },
    { id: 'crosswalk_east_bound', minX: streetX(16.65), maxX: streetX(17.05), minZ: streetZ(-56.2), maxZ: streetZ(-40.4),
      height: 1.2, tag: 'wall', enabled: true },
    // Opposite Safe Sidewalk Far End Boundary
    {
      id: 'street_end_boundary',
      minX: streetX(9.35),
      maxX: streetX(17.1),
      minZ: streetZ(-56.3),
      maxZ: streetZ(-55.8),
      height: 2.0,
      tag: 'wall',
      enabled: true,
    },

    // === Scene 2 (Leg 2): Occupied Tactile Path Obstacles ===
    // 2 Shared Bikes across X = 4.8, Z = -15.6 (North gap 1.78m, South gap 2.18m!)
    {
      id: 'shared_bikes',
      minX: 4.1,
      maxX: 5.5,
      minZ: -16.42,
      maxZ: -14.78,
      height: 1.12,
      tag: 'bike',
      isObstacle: true,
      enabled: true,
    },
    // Construction Barrier across X = 9.2, Z = -15.6 (North gap 1.68m, South gap 2.08m!)
    {
      id: 'construction_barrier',
      minX: streetX(8.8),
      maxX: streetX(9.6),
      minZ: -16.52,
      maxZ: -14.68,
      height: 1.15,
      tag: 'barrier',
      isObstacle: true,
      enabled: true,
    },

    // Streetlamp Poles (tucked near curbs so never blocking tactile path or bypass corridors)
    {
      id: 'street_lamp_1',
      minX: 2.1,
      maxX: 2.4,
      minZ: -10.35,
      maxZ: -10.05,
      height: 4.2,
      tag: 'normal',
      enabled: true,
    },
    {
      id: 'street_lamp_2',
      minX: 6.85,
      maxX: 7.15,
      minZ: -13.15,
      maxZ: -12.85,
      height: 4.2,
      tag: 'normal',
      enabled: true,
    },
    {
      id: 'street_lamp_3',
      minX: streetX(16.0),
      maxX: streetX(16.3),
      minZ: streetZ(-20.65),
      maxZ: streetZ(-20.35),
      height: 4.2,
      tag: 'normal',
      enabled: true,
    },
    {
      id: 'street_lamp_4',
      minX: streetX(16.0),
      maxX: streetX(16.3),
      minZ: streetZ(-26.85),
      maxZ: streetZ(-26.55),
      height: 4.2,
      tag: 'normal',
      enabled: true,
    },
    {
      id: 'crosswalk_signal_pole',
      minX: streetX(15.4),
      maxX: streetX(15.7),
      minZ: streetZ(-41.4),
      maxZ: streetZ(-41.1),
      height: 3.4,
      tag: 'signal_pole',
      enabled: true,
    },

    // === Scene 3 (Leg 3): Warm Breakfast Stall & Tabby Cat ===
    {
      id: 'breakfast_stall_counter',
      minX: streetX(9.85),
      maxX: streetX(11.82),
      minZ: streetZ(-25.3),
      maxZ: streetZ(-21.9),
      height: 2.4,
      tag: 'stall',
      enabled: true,
    },
    {
      id: 'stall_stool_1',
      minX: streetX(11.92),
      maxX: streetX(12.32),
      minZ: streetZ(-23.25),
      maxZ: streetZ(-22.85),
      height: 0.48,
      tag: 'stall',
      enabled: true,
    },
    {
      id: 'stall_stool_2',
      minX: streetX(11.92),
      maxX: streetX(12.32),
      minZ: streetZ(-24.35),
      maxZ: streetZ(-23.95),
      height: 0.48,
      tag: 'stall',
      enabled: true,
    },
    {
      id: 'street_cat',
      minX: WAYPOINTS.catPos.x - 0.22,
      maxX: WAYPOINTS.catPos.x + 0.22,
      minZ: streetZ(-23.82),
      maxZ: streetZ(-23.38),
      height: 0.42,
      tag: 'cat',
      enabled: true,
    },

    // === Scene 4: Crosswalk Safety Air-Wall (Thick 1.2m so player stops cleanly on dot bricks!) ===
    {
      id: 'crosswalk_airwall',
      minX: streetX(9.4),
      maxX: streetX(18.6),
      minZ: streetZ(-42.9),
      maxZ: WAYPOINTS.crosswalkCurbZ,
      height: 1.8,
      tag: 'tactile_dot',
      enabled: true,
    },
  ];
}
