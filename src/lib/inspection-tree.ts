// Vehicle inspection tree — drives the manual inspection wizard.
// Each system has parts, and parts can have subparts (checkable items).

export interface InspectionPart {
  key: string;
  label: string;
  subparts: string[]; // checkable items
}

export interface InspectionSystem {
  key: string;
  label: string;
  icon: string; // lucide-react icon name
  parts: InspectionPart[];
}

export const INSPECTION_TREE: InspectionSystem[] = [
  {
    key: "exterior",
    label: "Exterior walk-around",
    icon: "Car",
    parts: [
      { key: "body-condition", label: "Body condition", subparts: ["Overall (Good/Fair/Poor)", "Scratches", "Dents", "Rust"] },
      { key: "front", label: "Front", subparts: ["Bumper", "Grille", "Bonnet", "Front windscreen"] },
      { key: "rear", label: "Rear", subparts: ["Bumper", "Boot lid", "Rear windscreen", "Number plate"] },
      { key: "glass", label: "Glass — per window", subparts: ["Front Left window", "Front Right window", "Rear Left window", "Rear Right window"] },
      { key: "left-side", label: "Left side", subparts: ["Front fender", "Rear fender", "Sill"] },
      { key: "right-side", label: "Right side", subparts: ["Front fender", "Rear fender", "Sill"] },
      { key: "mirrors", label: "Side mirrors", subparts: ["Left mirror (OK/Broken/Loose/Missing)", "Right mirror (OK/Broken/Loose/Missing)"] },
      { key: "roof", label: "Roof", subparts: ["Paint", "Sunroof / Antenna"] },
    ],
  },
  {
    key: "body-panels",
    label: "Body panels (Repair / Replace / Paint)",
    icon: "Hammer",
    parts: [
      { key: "bumpers", label: "Bumpers", subparts: ["Front bumper", "Rear bumper"] },
      { key: "panels", label: "Panels", subparts: ["Bonnet", "Boot", "Roof", "Grille"] },
      { key: "fenders", label: "Fenders & quarters", subparts: ["FL Fender", "FR Fender", "RL Quarter", "RR Quarter"] },
      { key: "doors-body", label: "Doors (body)", subparts: ["FL Door", "FR Door", "RL Door", "RR Door"] },
      { key: "structural", label: "Structural", subparts: ["Chassis", "Frame", "Underbody", "Mounts"] },
    ],
  },
  {
    key: "doors",
    label: "Doors",
    icon: "DoorOpen",
    parts: [
      { key: "fl", label: "Front Left Door", subparts: ["Window", "Lock / Handle", "Mirror", "Trim panel", "Hinges"] },
      { key: "fr", label: "Front Right Door", subparts: ["Window", "Lock / Handle", "Mirror", "Trim panel", "Hinges"] },
      { key: "rl", label: "Rear Left Door", subparts: ["Window", "Lock / Handle", "Trim panel", "Child lock", "Hinges"] },
      { key: "rr", label: "Rear Right Door", subparts: ["Window", "Lock / Handle", "Trim panel", "Child lock", "Hinges"] },
    ],
  },
  {
    key: "interior",
    label: "Interior",
    icon: "Armchair",
    parts: [
      { key: "dashboard", label: "Dashboard", subparts: ["Warning lights", "Cluster display", "AC controls", "Infotainment"] },
      { key: "seats", label: "Seats", subparts: ["Driver", "Front passenger", "Rear bench", "Seat belts"] },
      { key: "ac", label: "Air conditioning", subparts: ["Cooling", "Heating", "Blower", "Smell"] },
      { key: "trim", label: "Trim & headliner", subparts: ["Carpet", "Headliner", "Mats"] },
    ],
  },
  {
    key: "underhood",
    label: "Under the hood",
    icon: "Wrench",
    parts: [
      { key: "engine", label: "Engine", subparts: ["Oil level", "Oil leaks", "Mounts", "Idle smoothness", "Smoke"] },
      { key: "cooling", label: "Cooling system", subparts: ["Radiator", "Coolant level", "Hoses", "Thermostat", "Fan"] },
      { key: "belts", label: "Belts & hoses", subparts: ["Drive belt", "Timing cover", "Vacuum hoses"] },
      { key: "battery", label: "Battery & charging", subparts: ["Battery voltage", "Terminals", "Alternator"] },
      { key: "fluids", label: "Fluids", subparts: ["Brake fluid", "Power steering", "Washer fluid", "Transmission"] },
    ],
  },
  {
    key: "brakes-suspension",
    label: "Brakes & suspension",
    icon: "Disc",
    parts: [
      { key: "brakes-front", label: "Front brakes", subparts: ["Pads", "Discs", "Calipers", "Lines"] },
      { key: "brakes-rear", label: "Rear brakes", subparts: ["Pads / Shoes", "Discs / Drums", "Handbrake"] },
      { key: "suspension-front", label: "Front suspension", subparts: ["Shocks", "Springs", "Bushes", "Ball joints"] },
      { key: "suspension-rear", label: "Rear suspension", subparts: ["Shocks", "Springs", "Bushes"] },
      { key: "steering", label: "Steering", subparts: ["Tie rods", "Rack", "Play in wheel"] },
    ],
  },
  {
    key: "wheels",
    label: "Wheels & tyres",
    icon: "Circle",
    parts: [
      { key: "wheel-fl", label: "Front Left Wheel", subparts: ["Tyre tread", "Tyre pressure", "Sidewall", "Rim", "Wheel nuts"] },
      { key: "wheel-fr", label: "Front Right Wheel", subparts: ["Tyre tread", "Tyre pressure", "Sidewall", "Rim", "Wheel nuts"] },
      { key: "wheel-rl", label: "Rear Left Wheel", subparts: ["Tyre tread", "Tyre pressure", "Sidewall", "Rim", "Wheel nuts"] },
      { key: "wheel-rr", label: "Rear Right Wheel", subparts: ["Tyre tread", "Tyre pressure", "Sidewall", "Rim", "Wheel nuts"] },
      { key: "spare", label: "Spare wheel", subparts: ["Tread", "Pressure", "Tools / Jack"] },
    ],
  },
  {
    key: "lights",
    label: "Lights & signals",
    icon: "Lightbulb",
    parts: [
      { key: "headlights", label: "Headlights", subparts: ["Front Left headlight", "Front Right headlight", "Low beam", "High beam"] },
      { key: "tail-lights", label: "Tail lights", subparts: ["Rear Left tail", "Rear Right tail", "Brake Left", "Brake Right", "Reverse"] },
      { key: "indicators", label: "Indicators", subparts: ["Front Left", "Front Right", "Rear Left", "Rear Right"] },
      { key: "fog-lights", label: "Fog lights", subparts: ["Front Left", "Front Right", "Rear Left", "Rear Right"] },
      { key: "interior-lights", label: "Interior lights", subparts: ["Dome", "Glove box", "Boot"] },
      { key: "horn", label: "Horn", subparts: ["Function"] },
    ],
  },
  {
    key: "electrical",
    label: "Electrical",
    icon: "Zap",
    parts: [
      { key: "wipers", label: "Wipers & washers", subparts: ["Front wipers", "Rear wipers", "Washer jets"] },
      { key: "windows", label: "Power windows", subparts: ["Driver switch panel", "Auto up/down"] },
      { key: "central-locking", label: "Central locking", subparts: ["Remote", "All doors lock/unlock"] },
      { key: "infotainment", label: "Infotainment", subparts: ["Radio", "Speakers", "Bluetooth", "Reverse camera"] },
    ],
  },
  {
    key: "road-test",
    label: "Road test",
    icon: "Gauge",
    parts: [
      { key: "acceleration", label: "Acceleration", subparts: ["Smoothness", "Power", "Hesitation"] },
      { key: "braking-test", label: "Braking", subparts: ["Pedal feel", "Pulling", "Noise", "ABS"] },
      { key: "handling", label: "Handling", subparts: ["Steering centred", "Vibration", "Pulling"] },
      { key: "transmission", label: "Transmission", subparts: ["Gear shifts", "Clutch", "Slipping"] },
      { key: "noise", label: "Unusual noises", subparts: ["Engine bay", "Suspension", "Exhaust", "Cabin"] },
    ],
  },
];

export type FindingStatus = "ok" | "attention" | "faulty";
export type Severity = "low" | "medium" | "high";

export interface Finding {
  id?: string;
  system: string;
  part: string;
  subpart?: string | null;
  status: FindingStatus;
  severity?: Severity | null;
  note?: string | null;
  photo_url?: string | null;
}

// 4-category landing for the wizard. Each category groups existing INSPECTION_TREE
// systems so the inspector picks a domain first, then drills in.
export interface InspectionCategory {
  key: "service" | "mechanical" | "electrical" | "body";
  label: string;
  description: string;
  icon: string; // lucide-react icon name
  systems: string[]; // keys from INSPECTION_TREE
}

export const INSPECTION_CATEGORIES: InspectionCategory[] = [
  {
    key: "service",
    label: "Service",
    description: "Engine bay fluids, belts, and a quick road test.",
    icon: "Wrench",
    systems: ["underhood", "road-test"],
  },
  {
    key: "mechanical",
    label: "Mechanical",
    description: "Brakes, suspension, steering, wheels & tyres.",
    icon: "Disc",
    systems: ["brakes-suspension", "wheels"],
  },
  {
    key: "electrical",
    label: "Electrical",
    description: "Lights, signals, wipers, windows, infotainment.",
    icon: "Zap",
    systems: ["lights", "electrical"],
  },
  {
    key: "body",
    label: "Body",
    description: "Exterior, panels, doors and interior trim.",
    icon: "Car",
    systems: ["exterior", "body-panels", "doors", "interior"],
  },
];
