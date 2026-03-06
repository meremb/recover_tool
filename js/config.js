/**
 * config.js
 * =========
 * Application-wide constants: design modes, insulation presets,
 * pump library, valve catalogue, and physics constants.
 * No logic lives here — only data.
 */

// ---------------------------------------------------------------------------
//  Design modes
// ---------------------------------------------------------------------------
// Unified mode: supply temperature input is optional.
// - If fixedSupplyT is set → LT dimensioning (calculates extra power needed)
// - If fixedSupplyT is null → existing system (calculates required supply T)
const MODE_EXISTING  = 'existing';
const MODE_FIXED     = 'fixed';

// ---------------------------------------------------------------------------
//  Building envelope presets
// ---------------------------------------------------------------------------
const INSULATION_U = {
  'not insulated': { wall: 1.3, roof: 1.0, ground: 1.2 },
  'bit insulated':  { wall: 0.5, roof: 0.6, ground: 0.4 },
  'insulated well': { wall: 0.3, roof: 0.2, ground: 0.3 },
};

const GLAZING_U = {
  single: 5.0,
  double: 2.8,
  double HR: 1.1,
  triple: 0.8,
};

// ---------------------------------------------------------------------------
//  Room types
// ---------------------------------------------------------------------------
const ROOM_TYPES = ['Living', 'Kitchen', 'Bedroom', 'Laundry', 'Bathroom', 'Toilet'];

const NBN_BOUNDS = {
  Living:   { min: 75,  max: 150 },
  Kitchen:  { min: 50,  max: 75  },
  Bedroom:  { min: 25,  max: 72  },
  Study:    { min: 25,  max: 72  },
  Laundry:  { min: 50,  max: 75  },
  Bathroom: { min: 50,  max: 150 },
  Toilet:   { min: 25,  max: 25  },
  Hallway:  { min: 0,   max: 75  },
};

// ---------------------------------------------------------------------------
//  Physics constants
// ---------------------------------------------------------------------------
const BRIDGE_CORRECTION   = 0.05;
const GROUND_TEMP         = 10.0;
const GROUND_FACTOR       = 1.15 * 1.45;
const INFILTRATION_FACTOR = 0.34;
const WALL_OFFSET         = 0.3;

const VENT_ACH = { C: 0.5, D: 0.5 * 0.3 };

const T_FACTOR   = 49.83;
const EXPONENT_N = 1.34;

const POSSIBLE_DIAMETERS = [8, 10, 12, 13, 14, 16, 20, 22, 25, 28, 36, 50];
DELTA_T_REF = (75.0 + 65.0) / 2.0 - 20.0;

const HYDRAULIC_CONST  = 97180.0;
const LOCAL_LOSS       = 1.3;
const KV_RADIATOR      = 2.0;
const KV_COLLECTOR     = 14.66;
const PRESSURE_BOILER  = 350.0;
const WATER_DENSITY    = 1000.0;

const KV_A =  51626.0;
const KV_B = -417.39;
const KV_C =   1.5541;

const MAX_ITERATIONS = 60;
const TOLERANCE_PA   = 0.5;
const MIN_FLOW       = 0.01;

// ---------------------------------------------------------------------------
//  Pump library  (model → speed → [[flow kg/h, head kPa], ...])
// ---------------------------------------------------------------------------
const PUMP_LIBRARY = {
  'Grundfos UPM3 15-70': {
    speed_1: [[0,55],[200,50],[400,42],[600,30],[800,18],[1000,6],[1100,2]],
    speed_2: [[0,65],[250,60],[500,51],[750,38],[1000,24],[1150,12],[1250,5]],
    speed_3: [[0,75],[300,70],[600,60],[900,44],[1200,28],[1400,16],[1500,8]],
  },
  'Wilo Yonos PICO 25-1/6': {
    speed_1: [[0,50],[250,44],[500,36],[750,26],[1000,15],[1200,7]],
    speed_2: [[0,60],[300,54],[600,45],[900,33],[1200,20],[1400,12]],
    speed_3: [[0,70],[350,64],[700,54],[1050,40],[1400,26],[1600,15]],
  },
  'Generic 25-60': {
    speed_1: [[0,48],[250,42],[500,34],[750,24],[1000,13],[1200,6]],
    speed_2: [[0,58],[300,52],[600,44],[900,32],[1200,19],[1400,11]],
    speed_3: [[0,68],[350,62],[700,52],[1050,38],[1400,24],[1600,14]],
  },
};

// ---------------------------------------------------------------------------
//  Valve catalogue
// ---------------------------------------------------------------------------
const VALVE_CATALOGUE = {
  'Danfoss RA-N 10 (3/8)': {
    positions: 8,
    kv_values: [0.04, 0.08, 0.12, 0.19, 0.25, 0.33, 0.38, 0.56],
    description: 'Danfoss RA-N 10 (3/8) – 8-position TRV',
  },
  'Danfoss RA-N 15 (1/2)': {
    positions: 8,
    kv_values: [0.04, 0.08, 0.12, 0.20, 0.30, 0.40, 0.51, 0.73],
    description: 'Danfoss RA-N 15 (1/2) – 8-position TRV',
  },
  'Danfoss RA-N 20 (3/4)': {
    positions: 8,
    kv_values: [0.10, 0.15, 0.17, 0.26, 0.35, 0.46, 0.73, 1.04],
    description: 'Danfoss RA-N 20 (3/4) – 8-position TRV',
  },
  'Oventrop DN15 (1/2)': {
    positions: 9,
    kv_values: [0.05, 0.09, 0.14, 0.20, 0.26, 0.32, 0.43, 0.57, 0.67],
    description: 'Oventrop DN15 (1/2) – 9-position TRV',
  },
  'Heimeier (1/2)': {
    positions: 8,
    kv_values: [0.049, 0.09, 0.15, 0.265, 0.33, 0.47, 0.59, 0.67],
    description: 'Heimeier (1/2) – 8-position TRV',
  },
  'Vogel und Noot': {
    positions: 5,
    kv_values: [0.13, 0.30, 0.43, 0.58, 0.75],
    description: 'Vogel und Noot – 5-position TRV',
  },
  'Comap': {
    positions: 6,
    kv_values: [0.028, 0.08, 0.125, 0.24, 0.335, 0.49],
    description: 'Comap – 6-position TRV',
  },
};
