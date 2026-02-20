/**
 * config.js
 * =========
 * Application-wide constants: design modes, insulation presets,
 * pump library, valve catalogue, and physics constants.
 * No logic lives here — only data.
 *
 * Mirrors: config.py  +  domain/valve.py (_CATALOGUE)  +  domain/hydraulics.py (constants)
 */

// ---------------------------------------------------------------------------
//  Design modes
// ---------------------------------------------------------------------------
const MODE_EXISTING  = 'existing';   // Calc required supply T for current rads
const MODE_FIXED     = 'fixed';      // Fixed supply T → extra power needed
const MODE_PUMP      = 'pump';       // Pump curve determines flow
const MODE_BALANCING = 'balancing';  // TRV positioning / balancing

const MODE_HELP = {
  [MODE_EXISTING]:  'Calculate required supply temperature for current radiators.',
  [MODE_FIXED]:     'Choose a fixed supply temperature; tool calculates extra radiator power needed.',
  [MODE_PUMP]:      'Selected pump/speed determines achievable flow via ΔT iteration.',
  [MODE_BALANCING]: 'Determine TRV positions and flow distribution for balancing.',
};

// ---------------------------------------------------------------------------
//  Building envelope presets
// ---------------------------------------------------------------------------
const INSULATION_U = {
  'not insulated': { wall: 1.3, roof: 1.0, ground: 1.2 },
  'bit insulated':  { wall: 0.6, roof: 0.4, ground: 0.5 },
  'insulated well': { wall: 0.3, roof: 0.2, ground: 0.3 },
};

const GLAZING_U = {
  single: 5.0,
  double: 2.8,
  triple: 0.8,
};

// ---------------------------------------------------------------------------
//  Room types
// ---------------------------------------------------------------------------
const ROOM_TYPES = ['Living', 'Kitchen', 'Bedroom', 'Laundry', 'Bathroom', 'Toilet'];

/** NBN-D-50-001 ventilation flow bounds [m³/h] per room type */
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
const BRIDGE_CORRECTION   = 0.05;        // Thermal bridge addition [W/(m²K)]
const GROUND_TEMP         = 10.0;        // Assumed ground temp [°C]
const GROUND_FACTOR       = 1.15 * 1.45; // EN 12831 ground area factors
const INFILTRATION_FACTOR = 0.34;        // ρ·cp for air [Wh/(m³K)]
const WALL_OFFSET         = 0.3;         // Half-thickness estimate [m]

const VENT_ACH = { C: 0.5, D: 0.5 * 0.3 }; // Air changes/hour by system type

const T_FACTOR   = 49.83; // EN 442 radiator characteristic temperature [K]
const EXPONENT_N = 1.34;  // EN 442 radiator exponent

const POSSIBLE_DIAMETERS = [8, 10, 12, 13, 14, 16, 20, 22, 25, 28, 36, 50]; // mm

// Hydraulic constants
const HYDRAULIC_CONST  = 97180.0; // Pa at (kg/s / kv)²
const LOCAL_LOSS       = 1.3;     // Fitting & bend factor
const KV_RADIATOR      = 2.0;     // Radiator body kv [m³/h]
const KV_COLLECTOR     = 14.66;   // Collector manifold kv [m³/h]
const PRESSURE_BOILER  = 350.0;   // Fixed boiler/manifold loss [Pa]
const WATER_DENSITY    = 1000.0;  // kg/m³

// Pipe kv polynomial: kv = A·d² + B·d + C  (d in metres)
const KV_A =  51626.0;
const KV_B = -417.39;
const KV_C =   1.5541;

// Valve override solver
const MAX_ITERATIONS = 60;
const TOLERANCE_PA   = 0.5;
const MIN_FLOW       = 0.01; // kg/h floor

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
//  Valve catalogue  (domain/valve.py _CATALOGUE)
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
