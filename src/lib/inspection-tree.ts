// Vehicle inspection matrix that drives the manual inspection wizard.
// Each system contains one or more grouped parts, and each part exposes
// the concrete checkpoints a technician should mark as OK / ATTENTION / FAULTY.

export type InspectionCategoryKey = "mechanical" | "electrical" | "bodywork" | "paint" | "service";
export type FindingStatus = "ok" | "attention" | "faulty";
export type Severity = "low" | "medium" | "high";

export interface InspectionPart {
  key: string;
  label: string;
  subparts: string[];
}

export interface InspectionSystem {
  key: string;
  label: string;
  icon: string;
  parts: InspectionPart[];
}

export interface Finding {
  id?: string;
  category?: InspectionCategoryKey | null;
  system: string;
  part: string;
  subpart?: string | null;
  status: FindingStatus;
  severity?: Severity | null;
  last_service?: string | null;
  next_due?: string | null;
  note?: string | null;
  action_required?: string | null;
  estimated_cost?: number | null;
  assigned_technician?: string | null;
  time_estimate_minutes?: number | null;
  client_authorized?: boolean | null;
  photo_url?: string | null;
}

export interface InspectionCategory {
  key: InspectionCategoryKey;
  label: string;
  description: string;
  icon: string;
  systems: string[];
}

export const FINDING_STATUS_OPTIONS: Array<{ value: FindingStatus; label: string }> = [
  { value: "ok", label: "OK" },
  { value: "attention", label: "ATTENTION" },
  { value: "faulty", label: "FAULTY" },
];

export const INSPECTION_TREE: InspectionSystem[] = [
  {
    key: "engine",
    label: "Engine",
    icon: "Wrench",
    parts: [
      {
        key: "engine-core",
        label: "Engine core",
        subparts: [
          "Engine block",
          "Cylinder head",
          "Head gasket",
          "Pistons & rings",
          "Crankshaft",
          "Camshaft",
          "Timing belt/chain",
          "Engine mounting",
        ],
      },
    ],
  },
  {
    key: "fuel-system",
    label: "Fuel System",
    icon: "Fuel",
    parts: [
      {
        key: "fuel-delivery",
        label: "Fuel delivery",
        subparts: [
          "Fuel pump",
          "Fuel injectors",
          "Fuel filter",
          "Fuel lines",
          "Throttle body",
        ],
      },
    ],
  },
  {
    key: "air-intake",
    label: "Air Intake",
    icon: "Wind",
    parts: [
      {
        key: "air-path",
        label: "Air intake path",
        subparts: [
          "Air filter",
          "Intake manifold",
          "MAF sensor",
          "Turbo/supercharger",
        ],
      },
    ],
  },
  {
    key: "cooling-system",
    label: "Cooling System",
    icon: "Fan",
    parts: [
      {
        key: "cooling-components",
        label: "Cooling components",
        subparts: [
          "Radiator",
          "Water pump",
          "Thermostat",
          "Cooling fan",
          "Hoses",
        ],
      },
    ],
  },
  {
    key: "lubrication",
    label: "Lubrication",
    icon: "Droplets",
    parts: [
      {
        key: "lubrication-check",
        label: "Lubrication check",
        subparts: [
          "Oil level/condition",
          "Oil pump",
          "Oil filter",
          "Oil leaks",
        ],
      },
    ],
  },
  {
    key: "transmission",
    label: "Transmission",
    icon: "Cog",
    parts: [
      {
        key: "transmission-components",
        label: "Transmission components",
        subparts: [
          "Clutch system",
          "Gearbox",
          "Transmission fluid",
          "Torque converter (auto)",
        ],
      },
    ],
  },
  {
    key: "drivetrain",
    label: "Drivetrain",
    icon: "Workflow",
    parts: [
      {
        key: "drivetrain-components",
        label: "Drivetrain components",
        subparts: [
          "Drive shaft",
          "Differential",
          "CV joints",
          "Axles",
        ],
      },
    ],
  },
  {
    key: "suspension",
    label: "Suspension",
    icon: "Disc",
    parts: [
      {
        key: "suspension-components",
        label: "Suspension components",
        subparts: [
          "Shock absorbers",
          "Struts",
          "Springs",
          "Control arms",
          "Bushings",
          "Ball joints",
        ],
      },
    ],
  },
  {
    key: "steering",
    label: "Steering",
    icon: "MoveHorizontal",
    parts: [
      {
        key: "steering-components",
        label: "Steering components",
        subparts: [
          "Steering rack",
          "Power steering pump",
          "Tie rods",
          "Steering fluid",
        ],
      },
    ],
  },
  {
    key: "braking-system",
    label: "Braking System",
    icon: "CircleDot",
    parts: [
      {
        key: "braking-components",
        label: "Braking components",
        subparts: [
          "Brake pads",
          "Brake discs",
          "Brake calipers",
          "Brake fluid",
          "Master cylinder",
          "ABS system",
        ],
      },
    ],
  },
  {
    key: "wheels-tyres",
    label: "Wheels & Tyres",
    icon: "Circle",
    parts: [
      {
        key: "wheel-check",
        label: "Wheels & tyres",
        subparts: [
          "Tyre condition",
          "Wheel alignment",
          "Wheel balancing",
          "Wheel bearings",
        ],
      },
    ],
  },
  {
    key: "service-engine",
    label: "Engine Service",
    icon: "Oil",
    parts: [
      {
        key: "service-engine-check",
        label: "Engine service",
        subparts: [
          "Engine oil level",
          "Engine oil condition",
          "Oil filter",
        ],
      },
    ],
  },
  {
    key: "service-air-intake",
    label: "Air & Intake Service",
    icon: "Wind",
    parts: [
      {
        key: "service-air-intake-check",
        label: "Air & intake service",
        subparts: [
          "Air filter",
          "Cabin filter",
          "Intake cleaning (throttle body)",
        ],
      },
    ],
  },
  {
    key: "service-fuel",
    label: "Fuel System Service",
    icon: "Fuel",
    parts: [
      {
        key: "service-fuel-check",
        label: "Fuel system service",
        subparts: [
          "Fuel filter",
          "Injector cleaning (if applicable)",
        ],
      },
    ],
  },
  {
    key: "service-cooling",
    label: "Cooling System Service",
    icon: "Fan",
    parts: [
      {
        key: "service-cooling-check",
        label: "Cooling system service",
        subparts: [
          "Coolant level",
          "Coolant condition",
          "Radiator flush status",
          "Hoses condition",
        ],
      },
    ],
  },
  {
    key: "service-transmission",
    label: "Transmission Service",
    icon: "Cog",
    parts: [
      {
        key: "service-transmission-check",
        label: "Transmission service",
        subparts: [
          "Transmission fluid level",
          "Transmission fluid condition",
          "Clutch fluid (if applicable)",
        ],
      },
    ],
  },
  {
    key: "service-brakes",
    label: "Brake Service",
    icon: "CircleDot",
    parts: [
      {
        key: "service-brakes-check",
        label: "Brake service",
        subparts: [
          "Brake fluid level",
          "Brake fluid condition",
          "Brake cleaning/service",
        ],
      },
    ],
  },
  {
    key: "service-battery",
    label: "Battery Service",
    icon: "BatteryCharging",
    parts: [
      {
        key: "service-battery-check",
        label: "Battery service",
        subparts: [
          "Battery health",
          "Terminal condition",
          "Charging test",
        ],
      },
    ],
  },
  {
    key: "service-tyres",
    label: "Tyre Service",
    icon: "Circle",
    parts: [
      {
        key: "service-tyres-check",
        label: "Tyre service",
        subparts: [
          "Tyre pressure",
          "Tyre rotation",
          "Wheel balancing",
          "Wheel alignment",
        ],
      },
    ],
  },
  {
    key: "service-lubrication",
    label: "General Lubrication",
    icon: "Droplets",
    parts: [
      {
        key: "service-lubrication-check",
        label: "General lubrication",
        subparts: [
          "Suspension joints lubrication",
          "Door hinges",
          "Locks",
        ],
      },
    ],
  },
  {
    key: "service-general-checks",
    label: "General Service Checks",
    icon: "ClipboardList",
    parts: [
      {
        key: "service-general-checks-list",
        label: "General service checks",
        subparts: [
          "Wiper blades",
          "Washer fluid",
          "Belts (auxiliary belts)",
        ],
      },
    ],
  },
  {
    key: "power-supply",
    label: "Power Supply",
    icon: "Battery",
    parts: [
      {
        key: "power-supply-check",
        label: "Power supply",
        subparts: [
          "Battery condition",
          "Terminals",
          "Grounding",
        ],
      },
    ],
  },
  {
    key: "charging-system",
    label: "Charging System",
    icon: "BatteryCharging",
    parts: [
      {
        key: "charging-check",
        label: "Charging system",
        subparts: [
          "Alternator",
          "Voltage regulator",
          "Charging rate",
        ],
      },
    ],
  },
  {
    key: "starting-system",
    label: "Starting System",
    icon: "Power",
    parts: [
      {
        key: "starting-check",
        label: "Starting system",
        subparts: [
          "Starter motor",
          "Ignition switch",
          "Starter relay",
        ],
      },
    ],
  },
  {
    key: "lighting",
    label: "Lighting",
    icon: "Lightbulb",
    parts: [
      {
        key: "lighting-check",
        label: "Lighting",
        subparts: [
          "Headlights",
          "Tail lights",
          "Brake lights",
          "Indicators",
          "Interior lights",
        ],
      },
    ],
  },
  {
    key: "wiring-protection",
    label: "Wiring & Protection",
    icon: "Cable",
    parts: [
      {
        key: "wiring-check",
        label: "Wiring & protection",
        subparts: [
          "Wiring harness",
          "Fuses",
          "Relays",
        ],
      },
    ],
  },
  {
    key: "engine-electronics",
    label: "Engine Electronics",
    icon: "Cpu",
    parts: [
      {
        key: "engine-electronics-check",
        label: "Engine electronics",
        subparts: [
          "ECU",
          "Sensors (O2, MAF, TPS, crank, cam)",
        ],
      },
    ],
  },
  {
    key: "dashboard",
    label: "Dashboard",
    icon: "Gauge",
    parts: [
      {
        key: "dashboard-check",
        label: "Dashboard",
        subparts: [
          "Speedometer",
          "Fuel gauge",
          "Warning lights",
        ],
      },
    ],
  },
  {
    key: "body-electrical",
    label: "Body Electrical",
    icon: "Zap",
    parts: [
      {
        key: "body-electrical-check",
        label: "Body electrical",
        subparts: [
          "Power windows",
          "Central locking",
          "Wipers",
          "Horn",
          "Side mirrors",
        ],
      },
    ],
  },
  {
    key: "hvac-electrical",
    label: "HVAC Electrical",
    icon: "AirVent",
    parts: [
      {
        key: "hvac-electrical-check",
        label: "HVAC electrical",
        subparts: [
          "Blower motor",
          "AC controls",
        ],
      },
    ],
  },
  {
    key: "safety-advanced-systems",
    label: "Safety & Advanced Systems",
    icon: "Shield",
    parts: [
      {
        key: "safety-systems-check",
        label: "Safety & advanced systems",
        subparts: [
          "ABS module",
          "Airbags",
          "Parking sensors",
          "Reverse camera",
        ],
      },
    ],
  },
  {
    key: "structural",
    label: "Structural",
    icon: "Frame",
    parts: [
      {
        key: "structural-check",
        label: "Structural components",
        subparts: [
          "Chassis/frame alignment",
          "Subframe",
          "Floor panel",
        ],
      },
    ],
  },
  {
    key: "exterior-panels",
    label: "Exterior Panels",
    icon: "Car",
    parts: [
      {
        key: "exterior-panels-check",
        label: "Exterior panels",
        subparts: [
          "Bonnet",
          "Doors",
          "Fenders",
          "Roof",
          "Boot",
          "Bumpers",
        ],
      },
    ],
  },
  {
    key: "glass",
    label: "Glass",
    icon: "ScanSearch",
    parts: [
      {
        key: "glass-check",
        label: "Glass",
        subparts: [
          "Windscreen",
          "Side windows",
          "Rear glass",
        ],
      },
    ],
  },
  {
    key: "trim-fittings",
    label: "Trim & Fittings",
    icon: "Grip",
    parts: [
      {
        key: "trim-fittings-check",
        label: "Trim & fittings",
        subparts: [
          "Door handles",
          "Side mirrors",
          "Grille",
          "Moldings",
        ],
      },
    ],
  },
  {
    key: "seals",
    label: "Seals",
    icon: "ShieldEllipsis",
    parts: [
      {
        key: "seals-check",
        label: "Seals",
        subparts: [
          "Door seals",
          "Window seals",
          "Boot seals",
        ],
      },
    ],
  },
  {
    key: "interior",
    label: "Interior",
    icon: "Armchair",
    parts: [
      {
        key: "interior-check",
        label: "Interior",
        subparts: [
          "Seats",
          "Dashboard",
          "Carpet",
          "Roof lining",
        ],
      },
    ],
  },
  {
    key: "paint-condition",
    label: "Paint Condition",
    icon: "Palette",
    parts: [
      {
        key: "paint-condition-check",
        label: "Paint condition",
        subparts: [
          "Overall paint condition",
          "Color uniformity",
          "Clear coat",
        ],
      },
    ],
  },
  {
    key: "damage-check",
    label: "Damage Check",
    icon: "ShieldAlert",
    parts: [
      {
        key: "damage-check-points",
        label: "Damage check",
        subparts: [
          "Scratches",
          "Dents",
          "Paint peeling",
          "Fading",
        ],
      },
    ],
  },
  {
    key: "repair-areas",
    label: "Repair Areas",
    icon: "Paintbrush",
    parts: [
      {
        key: "repair-areas-check",
        label: "Repair areas",
        subparts: [
          "Panel repaint quality",
          "Overspray",
          "Color match",
        ],
      },
    ],
  },
  {
    key: "rust-corrosion",
    label: "Rust & Corrosion",
    icon: "ShieldBan",
    parts: [
      {
        key: "rust-corrosion-check",
        label: "Rust & corrosion",
        subparts: [
          "Underbody rust",
          "Panel rust",
          "Rust spots",
        ],
      },
    ],
  },
  {
    key: "finishing",
    label: "Finishing",
    icon: "Sparkles",
    parts: [
      {
        key: "finishing-check",
        label: "Finishing",
        subparts: [
          "Polishing quality",
          "Surface smoothness",
        ],
      },
    ],
  },
];

export const INSPECTION_CATEGORIES: InspectionCategory[] = [
  {
    key: "mechanical",
    label: "Mechanical",
    description: "Engine, driveline, braking, suspension, and tyre checkpoints.",
    icon: "Wrench",
    systems: [
      "engine",
      "fuel-system",
      "air-intake",
      "cooling-system",
      "lubrication",
      "transmission",
      "drivetrain",
      "suspension",
      "steering",
      "braking-system",
      "wheels-tyres",
    ],
  },
  {
    key: "electrical",
    label: "Electrical",
    description: "Battery, starting, lighting, controls, and safety electronics.",
    icon: "Zap",
    systems: [
      "power-supply",
      "charging-system",
      "starting-system",
      "lighting",
      "wiring-protection",
      "engine-electronics",
      "dashboard",
      "body-electrical",
      "hvac-electrical",
      "safety-advanced-systems",
    ],
  },
  {
    key: "bodywork",
    label: "Body Work",
    description: "Structure, panels, glass, trims, seals, and interior condition.",
    icon: "Car",
    systems: [
      "structural",
      "exterior-panels",
      "glass",
      "trim-fittings",
      "seals",
      "interior",
    ],
  },
  {
    key: "paint",
    label: "Paint & Finish",
    description: "Paint quality, damage checks, corrosion, and finishing review.",
    icon: "Palette",
    systems: [
      "paint-condition",
      "damage-check",
      "repair-areas",
      "rust-corrosion",
      "finishing",
    ],
  },
  {
    key: "service",
    label: "Regular Service",
    description: "Preventive maintenance with last service and next due tracking.",
    icon: "ClipboardList",
    systems: [
      "service-engine",
      "service-air-intake",
      "service-fuel",
      "service-cooling",
      "service-transmission",
      "service-brakes",
      "service-battery",
      "service-tyres",
      "service-lubrication",
      "service-general-checks",
    ],
  },
];

export function getInspectionCategoryKeyForSystem(systemKey: string): InspectionCategoryKey | null {
  const category = INSPECTION_CATEGORIES.find((item) => item.systems.includes(systemKey));
  return category?.key ?? null;
}

export function getInspectionCategoryLabel(categoryKey: string | null | undefined): string {
  if (!categoryKey) return "Inspection";
  return INSPECTION_CATEGORIES.find((item) => item.key === categoryKey)?.label ?? categoryKey;
}

export function isServiceCategory(categoryKey: string | null | undefined): boolean {
  return categoryKey === "service";
}

export function isServiceSystem(systemKey: string): boolean {
  return getInspectionCategoryKeyForSystem(systemKey) === "service";
}

export function getInspectionSystemLabel(systemKey: string): string {
  return INSPECTION_TREE.find((system) => system.key === systemKey)?.label ?? systemKey;
}
