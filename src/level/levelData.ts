export type SurfaceTag =
  | 'tactile_line'
  | 'tactile_dot'
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

/**
 * Z-shaped real urban street corridor:
 * - Foyer (X=0, Z=+1.5 -> -5.5) -> entry blister-dot pad
 * - Leg 1 (-Z straight 9.6m along X=0) -> Turn #1 blister-dot pad at (0, -15.6) -> turn 90° RIGHT (+X)
 * - Leg 2 (+X 14.0m along Z=-15.6) -> shared bikes at (4.8, -15.6) -> construction barrier at (9.2, -15.6)
 *         -> Turn #2 blister-dot pad at (14.0, -15.6) -> turn 90° LEFT (-Z)
 * - Leg 3 (-Z 13.8m along X=14.0) -> warm breakfast stall & tabby cat on left -> crosswalk dot pad at (14.0, -29.32)
 *         -> zebra crosswalk -> opposite safe curb & golden sunset finale at Z <= -40.4
 */
export const WAYPOINTS: LevelWaypoints = {
  playerStart: { x: 0, y: PLAYER_EYE_HEIGHT, z: 1.5 },
  canePickupPos: { x: 1.62, y: 0.0, z: -2.35 },
  foyerDoorZ: -5.5,
  firstTactileZ: -6.4,
  turn1Pos: { x: 0.0, z: -15.6 },
  bikesCenter: { x: 4.8, z: -15.6 },
  barrierCenter: { x: 9.2, z: -15.6 },
  turn2Pos: { x: 14.0, z: -15.6 },
  stallLightPos: { x: 11.55, y: 2.25, z: -23.6 },
  catPos: { x: 13.08, y: 0.08, z: -23.6 },
  signalPolePos: { x: 15.55, y: 0.08, z: -29.25 },
  crosswalkCenterX: 14.0,
  crosswalkPromptZ: -28.85,
  crosswalkCurbZ: -29.68,
  crosswalkHalfWidth: 1.85,
  pedestrianPos: { x: 14.0, y: 0.08, z: -40.7 },
  sunsetFinishZ: -40.4,
};

export function isOnTactilePath(x: number, z: number): boolean {
  // Entry dot pad + Leg 1 (-Z along X=0)
  if (z <= -5.6 && z >= -16.1 && Math.abs(x) < 0.52) return true;
  // Leg 2 (+X along Z=-15.6)
  if (x >= -0.48 && x <= 14.5 && Math.abs(z - -15.6) < 0.52) return true;
  // Leg 3 (-Z along X=14.0)
  if (z <= -15.1 && z >= -29.75 && Math.abs(x - 14.0) < 0.52) return true;
  // Wide crosswalk stop dot pad
  if (z <= -28.8 && z >= -29.82 && Math.abs(x - 14.0) < 1.85) return true;
  // Opposite curb dot pad & continuation
  if (z <= -39.8 && z >= -43.8 && Math.abs(x - 14.0) < 1.85) return true;
  return false;
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
      z: -34.0,
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
      maxX: 9.85,
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
      maxX: 17.05,
      minZ: -12.6,
      maxZ: -12.2,
      height: 1.2,
      tag: 'wall',
      enabled: true,
    },
    // Leg 3 West Building Facade (X = 9.85, Z = -18.2 to -30.0)
    {
      id: 'leg3_west_wall',
      minX: 9.35,
      maxX: 9.85,
      minZ: -30.0,
      maxZ: -18.2,
      height: 6.0,
      tag: 'wall',
      enabled: true,
    },
    // Leg 3 West Crosswalk & Plaza Bound (X = 9.85, Z = -30.0 to -44.2)
    {
      id: 'leg3_west_crosswalk_bound',
      minX: 9.35,
      maxX: 9.85,
      minZ: -44.2,
      maxZ: -30.0,
      height: 1.4,
      tag: 'wall',
      enabled: true,
    },
    // Leg 3 East Guardrail & Crosswalk East Bound (X = 16.65, Z = -12.2 to -44.2)
    {
      id: 'leg3_east_guardrail',
      minX: 16.65,
      maxX: 17.05,
      minZ: -44.2,
      maxZ: -12.2,
      height: 1.4,
      tag: 'wall',
      enabled: true,
    },
    // Opposite Safe Sidewalk Far End Boundary
    {
      id: 'street_end_boundary',
      minX: 9.35,
      maxX: 17.1,
      minZ: -44.3,
      maxZ: -43.8,
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
      minX: 8.8,
      maxX: 9.6,
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
      minX: 16.0,
      maxX: 16.3,
      minZ: -20.65,
      maxZ: -20.35,
      height: 4.2,
      tag: 'normal',
      enabled: true,
    },
    {
      id: 'street_lamp_4',
      minX: 16.0,
      maxX: 16.3,
      minZ: -26.85,
      maxZ: -26.55,
      height: 4.2,
      tag: 'normal',
      enabled: true,
    },
    {
      id: 'crosswalk_signal_pole',
      minX: 15.4,
      maxX: 15.7,
      minZ: -29.4,
      maxZ: -29.1,
      height: 3.4,
      tag: 'signal_pole',
      enabled: true,
    },

    // === Scene 3 (Leg 3): Warm Breakfast Stall & Tabby Cat ===
    {
      id: 'breakfast_stall_counter',
      minX: 9.85,
      maxX: 11.82,
      minZ: -25.3,
      maxZ: -21.9,
      height: 2.4,
      tag: 'stall',
      enabled: true,
    },
    {
      id: 'stall_stool_1',
      minX: 11.92,
      maxX: 12.32,
      minZ: -23.25,
      maxZ: -22.85,
      height: 0.48,
      tag: 'stall',
      enabled: true,
    },
    {
      id: 'stall_stool_2',
      minX: 11.92,
      maxX: 12.32,
      minZ: -24.35,
      maxZ: -23.95,
      height: 0.48,
      tag: 'stall',
      enabled: true,
    },
    {
      id: 'street_cat',
      minX: 12.86,
      maxX: 13.3,
      minZ: -23.82,
      maxZ: -23.38,
      height: 0.42,
      tag: 'cat',
      enabled: true,
    },

    // === Scene 4: Crosswalk Safety Air-Wall (Thick 1.2m so player stops cleanly on dot bricks!) ===
    {
      id: 'crosswalk_airwall',
      minX: 9.4,
      maxX: 18.6,
      minZ: -30.9,
      maxZ: WAYPOINTS.crosswalkCurbZ,
      height: 1.8,
      tag: 'tactile_dot',
      enabled: true,
    },
  ];
}
