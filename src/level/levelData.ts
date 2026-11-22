export type SurfaceTag =
  | 'tactile_line'
  | 'tactile_dot'
  | 'bike'
  | 'barrier'
  | 'stall'
  | 'cat'
  | 'door'
  | 'cane_pickup'
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
  /** Height for debug wireframe visualization */
  height: number;
  tag: SurfaceTag;
  /** True if bumping into this triggers obstacle setback audio/haptics/counter */
  isObstacle?: boolean;
  /** Allows dynamic toggling (e.g. foyer door & crosswalk safety air-wall) */
  enabled: boolean;
}

export interface LevelWaypoints {
  playerStart: { x: number; y: number; z: number };
  canePickupPos: { x: number; y: number; z: number };
  foyerDoorZ: number;
  firstTactileZ: number;
  bikesCenter: { x: number; z: number };
  barrierCenter: { x: number; z: number };
  stallLightPos: { x: number; y: number; z: number };
  catPos: { x: number; y: number; z: number };
  crosswalkPromptZ: number;
  pedestrianPos: { x: number; y: number; z: number };
  sunsetFinishZ: number;
}

export const PLAYER_EYE_HEIGHT = 1.6;
export const PLAYER_RADIUS = 0.32;

export const WAYPOINTS: LevelWaypoints = {
  playerStart: { x: 0, y: PLAYER_EYE_HEIGHT, z: 1.5 },
  canePickupPos: { x: 1.62, y: 0.0, z: -2.35 },
  foyerDoorZ: -5.5,
  firstTactileZ: -6.4,
  bikesCenter: { x: 0.05, z: -13.5 },
  barrierCenter: { x: 0.0, z: -21.5 },
  stallLightPos: { x: -2.55, y: 2.25, z: -24.6 },
  catPos: { x: -0.92, y: 0.08, z: -24.6 },
  crosswalkPromptZ: -31.5,
  pedestrianPos: { x: 0.0, y: 0.08, z: -43.2 },
  sunsetFinishZ: -43.0,
};

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
      minX: -4.6,
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
      maxX: 4.6,
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
      enabled: true, // Opens automatically when approaching with cane
    },

    // === Street Outer Corridor Bounds (X = -4.3 to +4.3, Z = -5.5 to -45.5) ===
    {
      id: 'street_left_wall',
      minX: -4.65,
      maxX: -4.25,
      minZ: -45.5,
      maxZ: -5.5,
      height: 3.5,
      tag: 'wall',
      enabled: true,
    },
    {
      id: 'street_right_boundary',
      minX: 4.25,
      maxX: 4.65,
      minZ: -45.5,
      maxZ: -5.5,
      height: 1.2,
      tag: 'wall',
      enabled: true,
    },
    {
      id: 'street_end_boundary',
      minX: -4.65,
      maxX: 4.65,
      minZ: -45.6,
      maxZ: -45.1,
      height: 2.0,
      tag: 'wall',
      enabled: true,
    },

    // === Scene 2: Occupied Tactile Path Obstacles ===
    {
      id: 'shared_bikes',
      minX: -0.88,
      maxX: 0.92,
      minZ: -14.2,
      maxZ: -12.8,
      height: 1.12,
      tag: 'bike',
      isObstacle: true,
      enabled: true,
    },
    {
      id: 'construction_barrier',
      minX: -1.05,
      maxX: 1.05,
      minZ: -21.92,
      maxZ: -21.08,
      height: 1.15,
      tag: 'barrier',
      isObstacle: true,
      enabled: true,
    },
    {
      id: 'street_lamp_1',
      minX: 1.22,
      maxX: 1.48,
      minZ: -16.95,
      maxZ: -16.65,
      height: 3.6,
      tag: 'normal',
      enabled: true,
    },
    {
      id: 'street_lamp_2',
      minX: 1.22,
      maxX: 1.48,
      minZ: -28.35,
      maxZ: -28.05,
      height: 3.6,
      tag: 'normal',
      enabled: true,
    },
    {
      id: 'tree_pit_1',
      minX: 2.55,
      maxX: 3.15,
      minZ: -10.5,
      maxZ: -9.9,
      height: 2.6,
      tag: 'normal',
      enabled: true,
    },
    {
      id: 'tree_pit_2',
      minX: 2.55,
      maxX: 3.15,
      minZ: -18.9,
      maxZ: -18.3,
      height: 2.6,
      tag: 'normal',
      enabled: true,
    },

    // === Scene 3: Warm Breakfast Stall & Cat (Z = -24.6, Left Sidewalk) ===
    {
      id: 'breakfast_stall_counter',
      minX: -4.25,
      maxX: -2.18,
      minZ: -26.3,
      maxZ: -22.9,
      height: 2.4,
      tag: 'stall',
      enabled: true,
    },
    {
      id: 'stall_stool_1',
      minX: -2.08,
      maxX: -1.68,
      minZ: -24.25,
      maxZ: -23.85,
      height: 0.48,
      tag: 'stall',
      enabled: true,
    },
    {
      id: 'stall_stool_2',
      minX: -2.08,
      maxX: -1.68,
      minZ: -25.35,
      maxZ: -24.95,
      height: 0.48,
      tag: 'stall',
      enabled: true,
    },
    {
      id: 'street_cat',
      minX: -1.14,
      maxX: -0.7,
      minZ: -24.82,
      maxZ: -24.38,
      height: 0.42,
      tag: 'cat',
      enabled: true,
    },

    // === Scene 4: Crosswalk Safety Air-Wall (Released on 3rd Help Call) ===
    {
      id: 'crosswalk_airwall',
      minX: -4.6,
      maxX: 4.6,
      minZ: -33.4,
      maxZ: -32.18,
      height: 1.8,
      tag: 'tactile_dot',
      enabled: true,
    },
  ];
}
