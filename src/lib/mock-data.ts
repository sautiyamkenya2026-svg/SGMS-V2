// Mock data for the Golden Automotive Solutions Management System

export type JobStatus = "diagnosis" | "diagnosed" | "parts" | "repair" | "approval" | "completed";

export interface Job {
  id: string;
  plate: string;
  customer: string;
  phone: string;
  vehicle: string;
  complaint: string;
  mechanic: string;
  status: JobStatus;
  createdAt: string;
  elapsed: string;
  partsRequested: string[];
  estimate: number;
}

export const jobs: Job[] = [
  { id: "JOB-0442", plate: "KCA 123A", customer: "James Mwangi", phone: "+254 712 345 678", vehicle: "Toyota Premio 2014", complaint: "Squeaking sound when braking", mechanic: "John K.", status: "diagnosis", createdAt: "08:42", elapsed: "1h 12m", partsRequested: [], estimate: 0 },
  { id: "JOB-0443", plate: "KDE 882X", customer: "Aisha Noor", phone: "+254 722 998 100", vehicle: "Mazda Demio 2016", complaint: "Engine overheating", mechanic: "Peter O.", status: "parts", createdAt: "07:15", elapsed: "2h 39m", partsRequested: ["Radiator", "Thermostat"], estimate: 18500 },
  { id: "JOB-0444", plate: "KBZ 451Y", customer: "Daniel Otieno", phone: "+254 733 221 540", vehicle: "Subaru Forester 2012", complaint: "Steering pulls left", mechanic: "John K.", status: "repair", createdAt: "09:05", elapsed: "0h 49m", partsRequested: ["Tie rod end"], estimate: 6500 },
  { id: "JOB-0445", plate: "KMCA 99K", customer: "Grace Wanjiku", phone: "+254 700 112 233", vehicle: "Honda Fit 2018", complaint: "AC not cooling", mechanic: "Mary A.", status: "approval", createdAt: "06:55", elapsed: "3h 02m", partsRequested: ["AC compressor", "Refrigerant"], estimate: 32000 },
  { id: "JOB-0440", plate: "KCJ 778P", customer: "Brian Kim", phone: "+254 745 882 100", vehicle: "Nissan Note 2015", complaint: "Service + brake pads", mechanic: "Peter O.", status: "completed", createdAt: "Yesterday", elapsed: "Done", partsRequested: ["Brake pads", "Engine oil"], estimate: 9800 },
  { id: "JOB-0441", plate: "KDA 220C", customer: "Lucy Achieng", phone: "+254 711 564 220", vehicle: "Toyota Vitz 2013", complaint: "Battery replacement", mechanic: "Mary A.", status: "completed", createdAt: "Yesterday", elapsed: "Done", partsRequested: ["Battery 60Ah"], estimate: 12500 },
];

export const inventory = [
  { id: "P-001", name: "Brake Pads (Front)", sku: "BP-FR-001", qty: 24, min: 10, location: "A-12", price: 3500 },
  { id: "P-002", name: "Engine Oil 5W-30 4L", sku: "EO-5W30-4", qty: 8, min: 12, location: "B-04", price: 4200 },
  { id: "P-003", name: "Air Filter", sku: "AF-202", qty: 18, min: 8, location: "A-22", price: 1200 },
  { id: "P-004", name: "Radiator (Universal)", sku: "RD-UNI-7", qty: 3, min: 4, location: "C-01", price: 12500 },
  { id: "P-005", name: "Battery 60Ah", sku: "BT-60AH", qty: 6, min: 5, location: "C-09", price: 11000 },
  { id: "P-006", name: "Spark Plugs (set)", sku: "SP-SET-4", qty: 32, min: 20, location: "A-03", price: 1800 },
  { id: "P-007", name: "AC Compressor", sku: "AC-COMP-1", qty: 2, min: 2, location: "D-11", price: 28500 },
  { id: "P-008", name: "Tie Rod End", sku: "TR-END-2", qty: 14, min: 6, location: "B-19", price: 2400 },
];

export const tools = [
  { id: "T-01", name: "Diagnostic Scanner OBD-II", holder: "John K.", since: "08:30", status: "in-use" },
  { id: "T-02", name: "Hydraulic Jack 3T", holder: "Peter O.", since: "07:50", status: "in-use" },
  { id: "T-03", name: "Torque Wrench", holder: "Store", since: "—", status: "available" },
  { id: "T-04", name: "Impact Driver", holder: "Mary A.", since: "09:10", status: "in-use" },
  { id: "T-05", name: "Multimeter", holder: "Missing", since: "Yesterday 17:00", status: "missing" },
];

export const activityFeed = [
  { time: "Just now", text: "Invoice JOB-0440 paid via M-Pesa", type: "success" },
  { time: "2 min ago", text: "Brake pads issued to JOB-0444", type: "info" },
  { time: "8 min ago", text: "Mechanic John completed diagnosis on KCA 123A", type: "info" },
  { time: "15 min ago", text: "KDE 882X checked in — engine overheating", type: "info" },
  { time: "22 min ago", text: "Low stock alert: Engine Oil 5W-30 (8 left)", type: "warning" },
  { time: "40 min ago", text: "Customer approved repair on JOB-0445 (KSh 32,000)", type: "success" },
];

export const bookings = [
  { time: "10:30", plate: "KCB 884H", customer: "Mark Owino", service: "Service" },
  { time: "11:15", plate: "KDD 110A", customer: "Sandra Njeri", service: "Brake check" },
  { time: "13:00", plate: "KBT 902M", customer: "Tony Wafula", service: "Diagnostics" },
  { time: "15:30", plate: "KCE 776L", customer: "Ivy Kamau", service: "Oil change" },
];

export const mechanics = [
  { name: "John K.", jobs: 38, avgTime: "2h 14m", comebacks: 1, rating: 4.8 },
  { name: "Peter O.", jobs: 31, avgTime: "2h 42m", comebacks: 2, rating: 4.6 },
  { name: "Mary A.", jobs: 27, avgTime: "1h 58m", comebacks: 0, rating: 4.9 },
  { name: "Samuel L.", jobs: 22, avgTime: "3h 05m", comebacks: 3, rating: 4.3 },
];

export const revenueData = [
  { day: "Mon", revenue: 42000, parts: 18000, labor: 24000 },
  { day: "Tue", revenue: 56000, parts: 26000, labor: 30000 },
  { day: "Wed", revenue: 38000, parts: 14000, labor: 24000 },
  { day: "Thu", revenue: 71000, parts: 32000, labor: 39000 },
  { day: "Fri", revenue: 88000, parts: 40000, labor: 48000 },
  { day: "Sat", revenue: 95000, parts: 44000, labor: 51000 },
  { day: "Sun", revenue: 22000, parts: 8000, labor: 14000 },
];

export const auditLog = [
  { time: "10:42", user: "Reception (Anne)", action: "Created Job JOB-0445" },
  { time: "10:38", user: "Storekeeper (Eric)", action: "Issued Brake Pads x2 to JOB-0444" },
  { time: "10:21", user: "Mechanic (John)", action: "Updated diagnosis on JOB-0442" },
  { time: "09:55", user: "Admin (Vee)", action: "Updated labor rate to KSh 1,500/hr" },
  { time: "09:40", user: "Storekeeper (Eric)", action: "Restocked Air Filter +20" },
];

export const users = [
  { name: "Vee Mwangi", role: "Admin", email: "vee@garage.co", status: "Active" },
  { name: "Anne Wairimu", role: "Reception", email: "anne@garage.co", status: "Active" },
  { name: "John Kamau", role: "Mechanic", email: "john@garage.co", status: "Active" },
  { name: "Peter Onyango", role: "Mechanic", email: "peter@garage.co", status: "Active" },
  { name: "Mary Achieng", role: "Mechanic", email: "mary@garage.co", status: "Active" },
  { name: "Eric Mutua", role: "Storekeeper", email: "eric@garage.co", status: "Active" },
];
