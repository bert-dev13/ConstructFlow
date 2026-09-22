import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  type Auth,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import { deriveBarChartFromPdm } from '../src/lib/scheduleSync';
import { buildProgressSCurvePoints } from '../src/lib/firebase/sCurves';
import {
  buildSCurvePeriods,
  buildTheoreticalSCurvePeriods,
  intervalDays,
  type SCurveReportingInterval,
} from '../src/lib/sCurvePeriods';
import { computeSCurveCostSummary } from '../src/lib/sCurveItems';
import type { PdmActivity, PdmDependency } from '../src/types';

type Role = 'contractor' | 'engineer_1' | 'engineer_2' | 'engineer_3' | 'engineer_4';
type ProjectStatus = 'active' | 'completed' | 'on_hold';
type CurveType = 'pdm_based' | 'ideal_theoretical';
type IarStatus = 'draft' | 'pending_review' | 'with_engineer_3' | 'with_engineer_4' | 'approved' | 'rejected';

interface SeedUser {
  uid: string;
  email: string;
  fullName: string;
  role: Role;
}

interface ActivityTemplate {
  key: string;
  number: string;
  name: string;
  duration: number;
  quantity: number;
  unit: string;
  unitCost: number;
  predecessors: string[];
}

interface ProjectBlueprint {
  index: number;
  id: string;
  name: string;
  location: string;
  status: ProjectStatus;
  startDate: string;
  category: keyof typeof ACTIVITY_LIBRARY;
  quantityScale: number;
  unitCostScale: number;
  contractorEmail: string;
  engineer1Email: string;
  engineer2Emails: string[];
  reportingInterval: SCurveReportingInterval;
  curveType: CurveType;
  firstProgressPct: number;
  secondProgressPct: number;
  iarStatus: IarStatus;
}

interface SampleProjectRecord {
  projectId: string;
  name: string;
  startDate: string;
  plannedEndDate: string;
  contractAmount: number;
  projectStatus: ProjectStatus;
  reportingInterval: SCurveReportingInterval;
  curveType: CurveType;
  theoreticalTotalPeriods: number;
  contractor: SeedUser;
  engineer1: SeedUser;
  engineer2: SeedUser[];
  activities: PdmActivity[];
  dependencies: PdmDependency[];
  lineItems: Array<{
    id: string;
    itemNo: string;
    description: string;
    unit: string;
    programmedQty: number;
    unitPrice: number;
    previous: number;
    thisPeriod: number;
    remarks: string;
  }>;
  costItems: Array<{
    activityId: string;
    quantity: number;
    unitCost: number;
  }>;
  baselinePeriods: ReturnType<typeof buildSCurvePeriods>;
  points: ReturnType<typeof buildProgressSCurvePoints>;
  progressDates: [string, string];
  firstProgressPct: number;
  secondProgressPct: number;
  iarStatus: IarStatus;
  accessUserIds: string[];
}

interface MigrationSummary {
  projectsCreated: number;
  projectsSkipped: number;
  schedulesCreated: number;
  sCurvesCreated: number;
  sCurveSnapshotsCreated: number;
  projectAuditEntriesCreated: number;
  contractHistoryEntriesCreated: number;
  reportsCreated: number;
  reportAuditEntriesCreated: number;
  emailQueueEntriesCreated: number;
  activitiesCreated: number;
  usersUpdated: number;
}

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyCP8rGySmmAcy_i8UfQxnus5Cfc0wJVRN0',
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'constructflow-c82cd.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'constructflow-c82cd',
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'constructflow-c82cd.firebasestorage.app',
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '173177123241',
  appId:
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:173177123241:web:cb0aea82e4e8e9cf1cd4b8',
};

const LOGIN_ACCOUNTS: Record<string, { email: string; password: string }> = {
  contractor1: { email: 'constructflow.contractor.1@gmail.com', password: 'contractor123' },
  contractor2: { email: 'constructflow.contractor.2@gmail.com', password: 'contractor123' },
  contractor3: { email: 'constructflow.contractor.3@gmail.com', password: 'contractor123' },
  engineer1_1: { email: 'constructflow.engineer1.1@gmail.com', password: 'engineer123' },
  engineer1_2: { email: 'constructflow.engineer1.2@gmail.com', password: 'engineer123' },
  engineer1_3: { email: 'constructflow.engineer1.3@gmail.com', password: 'engineer123' },
  engineer2_1: { email: 'constructflow.engineer2.1@gmail.com', password: 'engineer123' },
  engineer2_2: { email: 'constructflow.engineer2.2@gmail.com', password: 'engineer123' },
  engineer2_3: { email: 'constructflow.engineer2.3@gmail.com', password: 'engineer123' },
  engineer3_1: { email: 'constructflow.engineer3.1@gmail.com', password: 'engineer123' },
  engineer4_1: { email: 'constructflow.engineer4.1@gmail.com', password: 'engineer123' },
};

const ACTIVITY_LIBRARY = {
  road: [
    { key: 'mobilization', number: '1.0', name: 'Mobilization and temporary facilities', duration: 5, quantity: 1, unit: 'lot', unitCost: 185000, predecessors: [] },
    { key: 'survey', number: '2.0', name: 'Survey staking and control points', duration: 12, quantity: 1, unit: 'lot', unitCost: 145000, predecessors: ['mobilization'] },
    { key: 'clearing', number: '3.0', name: 'Clearing, grubbing and excavation', duration: 18, quantity: 1200, unit: 'cu.m.', unitCost: 420, predecessors: ['survey'] },
    { key: 'subgrade', number: '4.0', name: 'Subgrade preparation and embankment', duration: 16, quantity: 1650, unit: 'cu.m.', unitCost: 510, predecessors: ['clearing'] },
    { key: 'drainage', number: '5.0', name: 'Pipe culvert and drainage structures', duration: 14, quantity: 160, unit: 'ln.m.', unitCost: 4800, predecessors: ['clearing'] },
    { key: 'basecourse', number: '6.0', name: 'Aggregate base course', duration: 20, quantity: 1450, unit: 'cu.m.', unitCost: 980, predecessors: ['subgrade', 'drainage'] },
    { key: 'pavement', number: '7.0', name: 'Portland cement concrete pavement', duration: 34, quantity: 3400, unit: 'sq.m.', unitCost: 1825, predecessors: ['basecourse'] },
    { key: 'shoulders', number: '8.0', name: 'Shoulder backing and slope protection', duration: 11, quantity: 2200, unit: 'sq.m.', unitCost: 285, predecessors: ['pavement'] },
    { key: 'markings', number: '9.0', name: 'Road markings, signs and demobilization', duration: 7, quantity: 1, unit: 'lot', unitCost: 235000, predecessors: ['shoulders'] },
  ],
  bridge: [
    { key: 'mobilization', number: '1.0', name: 'Mobilization and site preparation', duration: 5, quantity: 1, unit: 'lot', unitCost: 240000, predecessors: [] },
    { key: 'piling', number: '2.0', name: 'Bored piling and pile cap works', duration: 21, quantity: 24, unit: 'each', unitCost: 118000, predecessors: ['mobilization'] },
    { key: 'abutments', number: '3.0', name: 'Abutment excavation and concreting', duration: 18, quantity: 320, unit: 'cu.m.', unitCost: 7600, predecessors: ['piling'] },
    { key: 'piers', number: '4.0', name: 'Pier shafts and pier caps', duration: 24, quantity: 260, unit: 'cu.m.', unitCost: 8450, predecessors: ['piling'] },
    { key: 'girders', number: '5.0', name: 'Prestressed girder fabrication and erection', duration: 30, quantity: 14, unit: 'each', unitCost: 295000, predecessors: ['abutments', 'piers'] },
    { key: 'deck', number: '6.0', name: 'Deck slab, parapet and barrier rails', duration: 22, quantity: 890, unit: 'sq.m.', unitCost: 6900, predecessors: ['girders'] },
    { key: 'approaches', number: '7.0', name: 'Approach slab and transition fill', duration: 12, quantity: 420, unit: 'sq.m.', unitCost: 3450, predecessors: ['deck'] },
    { key: 'finishing', number: '8.0', name: 'Bridge lighting, painting and opening works', duration: 8, quantity: 1, unit: 'lot', unitCost: 380000, predecessors: ['approaches'] },
  ],
  drainage: [
    { key: 'mobilization', number: '1.0', name: 'Mobilization and layout', duration: 5, quantity: 1, unit: 'lot', unitCost: 120000, predecessors: [] },
    { key: 'excavation', number: '2.0', name: 'Trench excavation and disposal', duration: 12, quantity: 1850, unit: 'cu.m.', unitCost: 410, predecessors: ['mobilization'] },
    { key: 'bedding', number: '3.0', name: 'Sand bedding and lean concrete', duration: 9, quantity: 960, unit: 'cu.m.', unitCost: 1180, predecessors: ['excavation'] },
    { key: 'rcp', number: '4.0', name: 'Reinforced concrete pipe laying', duration: 18, quantity: 420, unit: 'ln.m.', unitCost: 4650, predecessors: ['bedding'] },
    { key: 'boxes', number: '5.0', name: 'Catch basins and manholes', duration: 14, quantity: 18, unit: 'each', unitCost: 65500, predecessors: ['rcp'] },
    { key: 'headwalls', number: '6.0', name: 'Headwalls and wing walls', duration: 16, quantity: 120, unit: 'cu.m.', unitCost: 7020, predecessors: ['boxes'] },
    { key: 'backfill', number: '7.0', name: 'Backfilling and compaction', duration: 10, quantity: 1600, unit: 'cu.m.', unitCost: 290, predecessors: ['headwalls'] },
    { key: 'restoration', number: '8.0', name: 'Surface restoration and punchlist', duration: 7, quantity: 1, unit: 'lot', unitCost: 145000, predecessors: ['backfill'] },
  ],
  building: [
    { key: 'mobilization', number: '1.0', name: 'Mobilization and temporary utilities', duration: 5, quantity: 1, unit: 'lot', unitCost: 210000, predecessors: [] },
    { key: 'earthworks', number: '2.0', name: 'Earthworks and layout', duration: 12, quantity: 1320, unit: 'cu.m.', unitCost: 520, predecessors: ['mobilization'] },
    { key: 'foundation', number: '3.0', name: 'Footings, tie beams and slab-on-grade', duration: 20, quantity: 410, unit: 'cu.m.', unitCost: 7200, predecessors: ['earthworks'] },
    { key: 'structure', number: '4.0', name: 'Columns, beams and suspended slab', duration: 30, quantity: 540, unit: 'cu.m.', unitCost: 9100, predecessors: ['foundation'] },
    { key: 'masonry', number: '5.0', name: 'CHB walling and plastering', duration: 22, quantity: 2450, unit: 'sq.m.', unitCost: 980, predecessors: ['structure'] },
    { key: 'roofing', number: '6.0', name: 'Roof framing and long-span roofing', duration: 14, quantity: 1680, unit: 'sq.m.', unitCost: 1580, predecessors: ['structure'] },
    { key: 'mepf', number: '7.0', name: 'Electrical, plumbing and fire protection', duration: 24, quantity: 1, unit: 'lot', unitCost: 2450000, predecessors: ['masonry', 'roofing'] },
    { key: 'finishes', number: '8.0', name: 'Flooring, ceilings, painting and turnover', duration: 18, quantity: 1, unit: 'lot', unitCost: 1680000, predecessors: ['mepf'] },
  ],
  water: [
    { key: 'mobilization', number: '1.0', name: 'Mobilization and permit coordination', duration: 5, quantity: 1, unit: 'lot', unitCost: 155000, predecessors: [] },
    { key: 'survey', number: '2.0', name: 'Pipeline staking and test pitting', duration: 12, quantity: 1, unit: 'lot', unitCost: 118000, predecessors: ['mobilization'] },
    { key: 'excavation', number: '3.0', name: 'Pipeline trench excavation', duration: 18, quantity: 2400, unit: 'cu.m.', unitCost: 395, predecessors: ['survey'] },
    { key: 'pipes', number: '4.0', name: 'HDPE / DI pipe laying', duration: 30, quantity: 1850, unit: 'ln.m.', unitCost: 2650, predecessors: ['excavation'] },
    { key: 'appurtenances', number: '5.0', name: 'Valves, fittings and thrust blocks', duration: 14, quantity: 96, unit: 'set', unitCost: 18500, predecessors: ['pipes'] },
    { key: 'reservoir', number: '6.0', name: 'Reservoir and pump house improvements', duration: 20, quantity: 1, unit: 'lot', unitCost: 1580000, predecessors: ['pipes'] },
    { key: 'testing', number: '7.0', name: 'Hydrotesting and disinfection', duration: 8, quantity: 1, unit: 'lot', unitCost: 185000, predecessors: ['appurtenances', 'reservoir'] },
    { key: 'restoration', number: '8.0', name: 'Backfilling, restoration and commissioning', duration: 11, quantity: 1, unit: 'lot', unitCost: 320000, predecessors: ['testing'] },
  ],
} as const satisfies Record<string, ActivityTemplate[]>;

const PROJECT_BLUEPRINTS: ProjectBlueprint[] = [
  { index: 1, id: 'sample-01-san-vicente-fmr', name: 'SAMPLE - San Vicente Farm-to-Market Road Phase 2', location: 'San Vicente, Alcala, Cagayan', status: 'active', startDate: '2026-01-06', category: 'road', quantityScale: 1.05, unitCostScale: 1.02, contractorEmail: LOGIN_ACCOUNTS.contractor1.email, engineer1Email: LOGIN_ACCOUNTS.engineer1_1.email, engineer2Emails: [LOGIN_ACCOUNTS.engineer2_1.email], reportingInterval: '10_day', curveType: 'pdm_based', firstProgressPct: 18, secondProgressPct: 41, iarStatus: 'approved' },
  { index: 2, id: 'sample-02-buguey-seawall', name: 'SAMPLE - Buguey Coastal Seawall Rehabilitation', location: 'Sta. Maria, Buguey, Cagayan', status: 'active', startDate: '2026-02-03', category: 'drainage', quantityScale: 1.12, unitCostScale: 1.08, contractorEmail: LOGIN_ACCOUNTS.contractor2.email, engineer1Email: LOGIN_ACCOUNTS.engineer1_2.email, engineer2Emails: [LOGIN_ACCOUNTS.engineer2_2.email], reportingInterval: '30_day', curveType: 'ideal_theoretical', firstProgressPct: 15, secondProgressPct: 33, iarStatus: 'pending_review' },
  { index: 3, id: 'sample-03-amulung-waterline', name: 'SAMPLE - Amulung Cluster Waterline Expansion', location: 'Centro, Amulung, Cagayan', status: 'active', startDate: '2026-01-20', category: 'water', quantityScale: 1.08, unitCostScale: 1.11, contractorEmail: LOGIN_ACCOUNTS.contractor3.email, engineer1Email: LOGIN_ACCOUNTS.engineer1_3.email, engineer2Emails: [LOGIN_ACCOUNTS.engineer2_3.email], reportingInterval: '10_day', curveType: 'pdm_based', firstProgressPct: 20, secondProgressPct: 48, iarStatus: 'with_engineer_3' },
  { index: 4, id: 'sample-04-aparri-evacuation', name: 'SAMPLE - Aparri Evacuation Center Annex', location: 'Macanaya, Aparri, Cagayan', status: 'active', startDate: '2026-03-02', category: 'building', quantityScale: 1.0, unitCostScale: 1.16, contractorEmail: LOGIN_ACCOUNTS.contractor1.email, engineer1Email: LOGIN_ACCOUNTS.engineer1_1.email, engineer2Emails: [LOGIN_ACCOUNTS.engineer2_2.email], reportingInterval: '30_day', curveType: 'ideal_theoretical', firstProgressPct: 12, secondProgressPct: 28, iarStatus: 'with_engineer_4' },
  { index: 5, id: 'sample-05-lasam-bridge', name: 'SAMPLE - Lasam River Bridge Strengthening', location: 'Centro East, Lasam, Cagayan', status: 'active', startDate: '2026-02-16', category: 'bridge', quantityScale: 1.1, unitCostScale: 1.09, contractorEmail: LOGIN_ACCOUNTS.contractor2.email, engineer1Email: LOGIN_ACCOUNTS.engineer1_2.email, engineer2Emails: [LOGIN_ACCOUNTS.engineer2_1.email], reportingInterval: '10_day', curveType: 'pdm_based', firstProgressPct: 14, secondProgressPct: 36, iarStatus: 'rejected' },
  { index: 6, id: 'sample-06-tuao-drainage', name: 'SAMPLE - Tuao Poblacion Drainage Upgrade', location: 'Poblacion East, Tuao, Cagayan', status: 'active', startDate: '2026-01-13', category: 'drainage', quantityScale: 0.94, unitCostScale: 1.04, contractorEmail: LOGIN_ACCOUNTS.contractor3.email, engineer1Email: LOGIN_ACCOUNTS.engineer1_3.email, engineer2Emails: [LOGIN_ACCOUNTS.engineer2_3.email], reportingInterval: '30_day', curveType: 'pdm_based', firstProgressPct: 17, secondProgressPct: 39, iarStatus: 'draft' },
  { index: 7, id: 'sample-07-penablanca-road', name: 'SAMPLE - Peñablanca Upland Access Road', location: 'Manga, Peñablanca, Cagayan', status: 'active', startDate: '2026-04-07', category: 'road', quantityScale: 1.21, unitCostScale: 1.07, contractorEmail: LOGIN_ACCOUNTS.contractor1.email, engineer1Email: LOGIN_ACCOUNTS.engineer1_1.email, engineer2Emails: [LOGIN_ACCOUNTS.engineer2_1.email, LOGIN_ACCOUNTS.engineer2_2.email], reportingInterval: '10_day', curveType: 'ideal_theoretical', firstProgressPct: 10, secondProgressPct: 26, iarStatus: 'approved' },
  { index: 8, id: 'sample-08-sanchez-mira-school', name: 'SAMPLE - Sanchez Mira Public School Workshop Building', location: 'Masisit, Sanchez Mira, Cagayan', status: 'active', startDate: '2026-03-18', category: 'building', quantityScale: 1.07, unitCostScale: 1.13, contractorEmail: LOGIN_ACCOUNTS.contractor2.email, engineer1Email: LOGIN_ACCOUNTS.engineer1_2.email, engineer2Emails: [LOGIN_ACCOUNTS.engineer2_2.email], reportingInterval: '30_day', curveType: 'pdm_based', firstProgressPct: 16, secondProgressPct: 31, iarStatus: 'pending_review' },
  { index: 9, id: 'sample-09-claveria-water', name: 'SAMPLE - Claveria Potable Water Supply Looping', location: 'Taggat Norte, Claveria, Cagayan', status: 'active', startDate: '2026-02-24', category: 'water', quantityScale: 1.16, unitCostScale: 1.05, contractorEmail: LOGIN_ACCOUNTS.contractor3.email, engineer1Email: LOGIN_ACCOUNTS.engineer1_3.email, engineer2Emails: [LOGIN_ACCOUNTS.engineer2_3.email], reportingInterval: '10_day', curveType: 'ideal_theoretical', firstProgressPct: 22, secondProgressPct: 52, iarStatus: 'with_engineer_3' },
  { index: 10, id: 'sample-10-ballesteros-bridge', name: 'SAMPLE - Ballesteros Creek Bridge Widening', location: 'Santa Cruz, Ballesteros, Cagayan', status: 'active', startDate: '2026-01-27', category: 'bridge', quantityScale: 0.98, unitCostScale: 1.18, contractorEmail: LOGIN_ACCOUNTS.contractor1.email, engineer1Email: LOGIN_ACCOUNTS.engineer1_1.email, engineer2Emails: [LOGIN_ACCOUNTS.engineer2_1.email], reportingInterval: '30_day', curveType: 'pdm_based', firstProgressPct: 13, secondProgressPct: 27, iarStatus: 'with_engineer_4' },
  { index: 11, id: 'sample-11-allacapan-riprap', name: 'SAMPLE - Allacapan Riverbank Riprap Protection', location: 'Bessang, Allacapan, Cagayan', status: 'on_hold', startDate: '2025-11-05', category: 'drainage', quantityScale: 1.14, unitCostScale: 1.06, contractorEmail: LOGIN_ACCOUNTS.contractor2.email, engineer1Email: LOGIN_ACCOUNTS.engineer1_2.email, engineer2Emails: [LOGIN_ACCOUNTS.engineer2_2.email], reportingInterval: '10_day', curveType: 'pdm_based', firstProgressPct: 24, secondProgressPct: 47, iarStatus: 'rejected' },
  { index: 12, id: 'sample-12-gattaran-road', name: 'SAMPLE - Gattaran Diversion Road Concrete Overlay', location: 'Poblacion, Gattaran, Cagayan', status: 'on_hold', startDate: '2025-12-01', category: 'road', quantityScale: 0.97, unitCostScale: 1.02, contractorEmail: LOGIN_ACCOUNTS.contractor3.email, engineer1Email: LOGIN_ACCOUNTS.engineer1_3.email, engineer2Emails: [LOGIN_ACCOUNTS.engineer2_3.email], reportingInterval: '30_day', curveType: 'ideal_theoretical', firstProgressPct: 19, secondProgressPct: 38, iarStatus: 'draft' },
  { index: 13, id: 'sample-13-lal-lo-water', name: 'SAMPLE - Lal-lo Municipal Water Reservoir Rehab', location: 'Magapit, Lal-lo, Cagayan', status: 'completed', startDate: '2025-08-04', category: 'water', quantityScale: 0.88, unitCostScale: 1.09, contractorEmail: LOGIN_ACCOUNTS.contractor1.email, engineer1Email: LOGIN_ACCOUNTS.engineer1_1.email, engineer2Emails: [LOGIN_ACCOUNTS.engineer2_1.email], reportingInterval: '10_day', curveType: 'pdm_based', firstProgressPct: 30, secondProgressPct: 100, iarStatus: 'approved' },
  { index: 14, id: 'sample-14-rizal-multipurpose', name: 'SAMPLE - Rizal Multi-Purpose Hall Completion', location: 'Mauanan, Rizal, Cagayan', status: 'completed', startDate: '2025-07-21', category: 'building', quantityScale: 0.92, unitCostScale: 1.14, contractorEmail: LOGIN_ACCOUNTS.contractor2.email, engineer1Email: LOGIN_ACCOUNTS.engineer1_2.email, engineer2Emails: [LOGIN_ACCOUNTS.engineer2_2.email], reportingInterval: '30_day', curveType: 'ideal_theoretical', firstProgressPct: 35, secondProgressPct: 100, iarStatus: 'pending_review' },
  { index: 15, id: 'sample-15-piat-bridge', name: 'SAMPLE - Piat Floodway Bridge Rehabilitation', location: 'Baung, Piat, Cagayan', status: 'completed', startDate: '2025-06-17', category: 'bridge', quantityScale: 0.91, unitCostScale: 1.2, contractorEmail: LOGIN_ACCOUNTS.contractor3.email, engineer1Email: LOGIN_ACCOUNTS.engineer1_3.email, engineer2Emails: [LOGIN_ACCOUNTS.engineer2_3.email], reportingInterval: '10_day', curveType: 'pdm_based', firstProgressPct: 28, secondProgressPct: 100, iarStatus: 'with_engineer_3' },
  { index: 16, id: 'sample-16-solana-drainage', name: 'SAMPLE - Solana Market Drainage Rehabilitation', location: 'Centro, Solana, Cagayan', status: 'completed', startDate: '2025-05-12', category: 'drainage', quantityScale: 0.9, unitCostScale: 1.01, contractorEmail: LOGIN_ACCOUNTS.contractor1.email, engineer1Email: LOGIN_ACCOUNTS.engineer1_1.email, engineer2Emails: [LOGIN_ACCOUNTS.engineer2_1.email], reportingInterval: '30_day', curveType: 'pdm_based', firstProgressPct: 32, secondProgressPct: 100, iarStatus: 'with_engineer_4' },
  { index: 17, id: 'sample-17-baggao-road', name: 'SAMPLE - Baggao Mountain Barangay Access Road', location: 'Carupian, Baggao, Cagayan', status: 'active', startDate: '2026-04-28', category: 'road', quantityScale: 1.24, unitCostScale: 1.15, contractorEmail: LOGIN_ACCOUNTS.contractor2.email, engineer1Email: LOGIN_ACCOUNTS.engineer1_2.email, engineer2Emails: [LOGIN_ACCOUNTS.engineer2_2.email, LOGIN_ACCOUNTS.engineer2_3.email], reportingInterval: '10_day', curveType: 'ideal_theoretical', firstProgressPct: 8, secondProgressPct: 21, iarStatus: 'rejected' },
  { index: 18, id: 'sample-18-pamplona-clinic', name: 'SAMPLE - Pamplona Rural Health Unit Annex', location: 'Buluan, Pamplona, Cagayan', status: 'active', startDate: '2026-05-14', category: 'building', quantityScale: 1.03, unitCostScale: 1.09, contractorEmail: LOGIN_ACCOUNTS.contractor3.email, engineer1Email: LOGIN_ACCOUNTS.engineer1_3.email, engineer2Emails: [LOGIN_ACCOUNTS.engineer2_1.email], reportingInterval: '30_day', curveType: 'pdm_based', firstProgressPct: 9, secondProgressPct: 24, iarStatus: 'draft' },
  { index: 19, id: 'sample-19-santa-praxedes-water', name: 'SAMPLE - Santa Praxedes Water Distribution Extension', location: 'Capinatan, Santa Praxedes, Cagayan', status: 'active', startDate: '2026-03-31', category: 'water', quantityScale: 1.19, unitCostScale: 1.08, contractorEmail: LOGIN_ACCOUNTS.contractor1.email, engineer1Email: LOGIN_ACCOUNTS.engineer1_1.email, engineer2Emails: [LOGIN_ACCOUNTS.engineer2_2.email], reportingInterval: '10_day', curveType: 'ideal_theoretical', firstProgressPct: 11, secondProgressPct: 29, iarStatus: 'approved' },
  { index: 20, id: 'sample-debug-project', name: 'SAMPLE - Abulug Floodwall and Outfall Improvement', location: 'Banguian, Abulug, Cagayan', status: 'active', startDate: '2026-05-05', category: 'drainage', quantityScale: 1.18, unitCostScale: 1.1, contractorEmail: LOGIN_ACCOUNTS.contractor2.email, engineer1Email: LOGIN_ACCOUNTS.engineer1_2.email, engineer2Emails: [LOGIN_ACCOUNTS.engineer2_3.email], reportingInterval: '30_day', curveType: 'pdm_based', firstProgressPct: 7, secondProgressPct: 19, iarStatus: 'pending_review' },
];

function nowIso() {
  return new Date().toISOString();
}

function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function round3(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function cleanForFirestore<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const sessionCache = new Map<
  string,
  Promise<{ auth: Auth; db: Firestore }>
>();

async function runAs<T>(
  _auth: Auth,
  account: { email: string; password: string },
  task: (session: { auth: Auth; db: Firestore }) => Promise<T>,
) {
  let sessionPromise = sessionCache.get(account.email);
  if (!sessionPromise) {
    const appName = `sample-migration-${account.email.replace(/[^a-z0-9]+/gi, '-')}`;
    sessionPromise = (async () => {
      const app = initializeApp(firebaseConfig, appName);
      const auth = getAuth(app);
      await signInWithEmailAndPassword(auth, account.email, account.password);
      return {
        auth,
        db: getFirestore(app),
      };
    })();
    sessionCache.set(account.email, sessionPromise);
  }
  const session = await sessionPromise;
  return task(session);
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

async function loadUsers(db: Firestore) {
  const snap = await getDocs(collection(db, 'users'));
  const users = new Map<string, SeedUser>();
  for (const userDoc of snap.docs) {
    const data = userDoc.data() as Record<string, unknown>;
    const email = String(data.email ?? '');
    if (!email) continue;
    users.set(email, {
      uid: userDoc.id,
      email,
      fullName: String(data.fullName ?? data.name ?? email),
      role: String(data.role ?? '') as Role,
    });
  }
  return users;
}

function buildSampleProjectRecord(
  blueprint: ProjectBlueprint,
  usersByEmail: Map<string, SeedUser>,
  migrationActor: SeedUser,
): SampleProjectRecord {
  const contractor = usersByEmail.get(blueprint.contractorEmail);
  const engineer1 = usersByEmail.get(blueprint.engineer1Email);
  const engineer2 = blueprint.engineer2Emails
    .map((email) => usersByEmail.get(email))
    .filter((value): value is SeedUser => Boolean(value));

  assert(contractor, `Missing contractor user ${blueprint.contractorEmail}`);
  assert(engineer1, `Missing engineer user ${blueprint.engineer1Email}`);
  assert(engineer2.length > 0, `Missing Engineer II for ${blueprint.id}`);

  const template = ACTIVITY_LIBRARY[blueprint.category];
  const activities: PdmActivity[] = [];
  const dependencies: PdmDependency[] = [];
  const lineItems: SampleProjectRecord['lineItems'] = [];
  const costItems: SampleProjectRecord['costItems'] = [];

  for (const activity of template) {
    const activityId = `${blueprint.id}-${activity.key}`;
    const quantity = round2(activity.quantity * blueprint.quantityScale);
    const unitCost = round2(activity.unitCost * blueprint.unitCostScale);
    activities.push({
      id: activityId,
      number: activity.number,
      name: activity.name,
      duration: activity.duration,
    });
    costItems.push({
      activityId,
      quantity,
      unitCost,
    });
    lineItems.push({
      id: `li-${activityId}`,
      itemNo: activity.number,
      description: activity.name,
      unit: activity.unit,
      programmedQty: quantity,
      unitPrice: unitCost,
      previous: 0,
      thisPeriod: 0,
      remarks: blueprint.status === 'completed' ? 'COMPLETED.' : 'ON-GOING.',
    });
    for (const predecessor of activity.predecessors) {
      dependencies.push({
        id: `${activityId}-${predecessor}`,
        fromId: `${blueprint.id}-${predecessor}`,
        toId: activityId,
        type: 'FS',
      });
    }
  }

  const derived = deriveBarChartFromPdm(activities, dependencies);
  const plannedEndDate = addDays(blueprint.startDate, derived.projectDuration);
  const costSummary = computeSCurveCostSummary(
    activities.map((activity, index) => ({
      activityId: activity.id,
      itemNo: activity.number,
      description: activity.name,
      quantity: costItems[index]!.quantity,
      unitCost: costItems[index]!.unitCost,
    })),
  );
  const firstProgressDate = addDays(
    blueprint.startDate,
    Math.max(10, Math.round(derived.projectDuration * 0.32)),
  );
  const secondProgressDate = blueprint.status === 'completed'
    ? plannedEndDate
    : addDays(blueprint.startDate, Math.max(24, Math.round(derived.projectDuration * 0.62)));

  const baselinePeriods = buildSCurvePeriods({
    startDate: blueprint.startDate,
    projectDuration: derived.projectDuration,
    activities: derived.activities,
    costItems: costSummary.items,
    totalContractAmount: costSummary.totalContractAmount,
    reportingInterval: blueprint.reportingInterval,
  });

  const points = buildProgressSCurvePoints(
    blueprint.startDate,
    baselinePeriods,
    [
      {
        date: firstProgressDate,
        percent: blueprint.firstProgressPct,
        label: `SWA SAMPLE ${blueprint.index}-1`,
      },
      {
        date: secondProgressDate,
        percent: blueprint.secondProgressPct,
        label: `STEWA SAMPLE ${blueprint.index}-2`,
      },
    ],
    blueprint.reportingInterval,
  );

  const theoreticalTotalPeriods = Math.max(
    3,
    Math.ceil(derived.projectDuration / intervalDays(blueprint.reportingInterval)) + 1,
  );

  return {
    projectId: blueprint.id,
    name: blueprint.name,
    startDate: blueprint.startDate,
    plannedEndDate,
    contractAmount: costSummary.totalContractAmount,
    projectStatus: blueprint.status,
    reportingInterval: blueprint.reportingInterval,
    curveType: blueprint.curveType,
    theoreticalTotalPeriods,
    contractor,
    engineer1,
    engineer2,
    activities: derived.activities,
    dependencies,
    lineItems,
    costItems,
    baselinePeriods,
    points,
    progressDates: [firstProgressDate, secondProgressDate],
    firstProgressPct: blueprint.firstProgressPct,
    secondProgressPct: blueprint.secondProgressPct,
    iarStatus: blueprint.iarStatus,
    accessUserIds: uniqueStrings([
      contractor.uid,
      migrationActor.uid,
      engineer1.uid,
      ...engineer2.map((user) => user.uid),
    ]),
  };
}

async function ensureProject(
  db: Firestore,
  auth: Auth,
  record: SampleProjectRecord,
  migrationActor: SeedUser,
  summary: MigrationSummary,
) {
  const created = await runAs(auth, LOGIN_ACCOUNTS.engineer1_1, async ({ db }) => {
    const existing = await getDoc(doc(db, 'projects', record.projectId));
    const existed = existing.exists();
    const createdAt = nowIso();
    console.log(`  project doc -> ${record.projectId}`);
    await setDoc(doc(db, 'projects', record.projectId), {
      name: record.name,
      location: PROJECT_BLUEPRINTS.find((project) => project.id === record.projectId)!.location,
      status: record.projectStatus,
      lifecycleState: 'active',
      contractorId: record.contractor.uid,
      contractorName: record.contractor.fullName,
      assignedUserIds: uniqueStrings([migrationActor.uid, record.engineer1.uid]),
      involvedUserIds: uniqueStrings(record.engineer2.map((user) => user.uid)),
      accessUserIds: record.accessUserIds,
      contractAmount: record.contractAmount,
      startDate: record.startDate,
      plannedEndDate: record.plannedEndDate,
      createdAt,
      updatedAt: createdAt,
    });

    console.log(`  project audit -> ${record.projectId}`);
    await setDoc(doc(db, 'projects', record.projectId, 'auditLog', 'initial-status'), {
      fieldName: 'sampleMigration',
      oldValue: null,
      newValue: `Created ${record.name}`,
      actorName: migrationActor.fullName,
      createdAt,
    });
    console.log(`  contract history -> ${record.projectId}`);
    await setDoc(doc(db, 'projects', record.projectId, 'contractHistory', 'initial-contract'), {
      contractAmount: record.contractAmount,
      effectiveDate: record.startDate,
      voReference: null,
      notes: 'Initial sample migration contract amount',
      createdAt,
      createdByName: migrationActor.fullName,
    });

    console.log(`  schedule -> ${record.projectId}`);
    await setDoc(doc(db, 'schedules', record.projectId), cleanForFirestore({
      projectId: record.projectId,
      activities: record.activities,
      dependencies: record.dependencies,
      barChartTasks: deriveBarChartFromPdm(record.activities, record.dependencies).barChartTasks,
      barChartTotalDays: deriveBarChartFromPdm(record.activities, record.dependencies).projectDuration,
      barChartTimeNow: 0,
      projectDuration: deriveBarChartFromPdm(record.activities, record.dependencies).projectDuration,
      criticalPath: deriveBarChartFromPdm(record.activities, record.dependencies).criticalPath,
      pdmError: null,
      updatedAt: createdAt,
    }));

    console.log(`  sCurve -> ${record.projectId}`);
    await setDoc(doc(db, 'sCurves', record.projectId), cleanForFirestore({
      projectId: record.projectId,
      costItems: record.costItems,
      activeCurveType: record.curveType,
      reportingInterval: record.reportingInterval,
      theoreticalTotalPeriods: record.theoreticalTotalPeriods,
      points: record.points,
      targetPlanPct: record.firstProgressPct,
      actualPlanPct: record.secondProgressPct,
      updatedAt: createdAt,
    }));
    console.log(`  sCurve snapshot -> ${record.projectId}`);
    await setDoc(doc(db, 'sCurves', record.projectId, 'snapshots', 'initial-baseline'), cleanForFirestore({
      points: record.points,
      capturedAt: createdAt,
      triggerType: 'sample_migration',
      triggerLabel: 'Initial sample baseline',
      scheduleStatus: record.projectStatus === 'completed' ? 'on_schedule' : 'target_only',
      plannedPct: record.firstProgressPct,
      actualPct: record.secondProgressPct,
      slippagePct: round2(record.secondProgressPct - record.firstProgressPct),
    }));
    return !existed;
  });

  if (!created) {
    summary.projectsSkipped += 1;
  }

  summary.projectsCreated += created ? 1 : 0;
  summary.schedulesCreated += 1;
  summary.sCurvesCreated += 1;
  summary.sCurveSnapshotsCreated += 1;
  summary.projectAuditEntriesCreated += 1;
  summary.contractHistoryEntriesCreated += 1;
  summary.activitiesCreated += record.activities.length;
  return true;
}

function reportDocId(projectId: string, kind: 'swa' | 'stewa' | 'iar') {
  return `${projectId}-${kind}`;
}

function reportNumber(projectId: string, kind: 'SWA' | 'STEWA' | 'IAR', suffix: string) {
  return `SAMPLE-${kind}-${projectId.toUpperCase()}-${suffix}`;
}

async function createDraftReports(
  db: Firestore,
  auth: Auth,
  record: SampleProjectRecord,
  summary: MigrationSummary,
) {
  const createdAt = nowIso();
  const [firstProgressDate, secondProgressDate] = record.progressDates;
  const projectLocation = PROJECT_BLUEPRINTS.find((project) => project.id === record.projectId)!.location;

  await runAs(auth, LOGIN_ACCOUNTS.engineer1_1, async ({ db }) => {
    const commonFields = {
      projectId: record.projectId,
      projectName: record.name,
      accessUserIds: record.accessUserIds,
      editUserIds: uniqueStrings([record.contractor.uid, record.engineer1.uid, LOGIN_ACCOUNTS.engineer1_1.email === record.engineer1.email ? undefined : record.engineer1.uid, record.contractor.uid]),
      createdBy: record.engineer1.uid,
      createdAt,
      updatedAt: createdAt,
      publicUrl: `/reports/view`,
    };

    const swaId = reportDocId(record.projectId, 'swa');
    const stewaId = reportDocId(record.projectId, 'stewa');
    const iarId = reportDocId(record.projectId, 'iar');

    await setDoc(doc(db, 'reports', swaId), {
      ...commonFields,
      reportNumber: reportNumber(record.projectId, 'SWA', '01'),
      reportType: 'SWA',
      reportData: {
        report_date: firstProgressDate,
        project_name: record.name,
        project_title: record.name,
        location: projectLocation,
        contract_amount: String(record.contractAmount),
        contractor: record.contractor.fullName,
        week_covered: `${firstProgressDate} to ${addDays(firstProgressDate, 6)}`,
        problems_remarks: record.projectStatus === 'on_hold' ? 'Mobilization slowed by right-of-way clearance.' : 'Work fronts active and progressing.',
        percent_actual: record.firstProgressPct,
        percent_planned: record.firstProgressPct,
        submitted_by_name: record.contractor.fullName,
        submitted_by_title: 'Contractor Representative',
      },
      lineItems: record.lineItems,
      contractorChanges: [],
      status: 'draft',
      approvalFlow: null,
      releaseState: null,
    });

    await setDoc(doc(db, 'reports', stewaId), {
      ...commonFields,
      reportNumber: reportNumber(record.projectId, 'STEWA', '02'),
      reportType: 'STEWA',
      reportData: {
        report_date: secondProgressDate,
        period_covered: secondProgressDate,
        contract_duration: deriveBarChartFromPdm(record.activities, record.dependencies).projectDuration,
        notice_to_proceed: record.startDate,
        expiry_date: record.plannedEndDate,
        approved_time_extension: 0,
        approved_time_suspension: '',
        total_time_extension: 0,
        revised_contract_duration: deriveBarChartFromPdm(record.activities, record.dependencies).projectDuration,
        revised_expiry_date: record.plannedEndDate,
        calendar_days_elapsed: Math.max(1, Math.round(deriveBarChartFromPdm(record.activities, record.dependencies).projectDuration * 0.62)),
        percent_actual: record.secondProgressPct,
        percent_planned: record.firstProgressPct,
        remarks:
          record.secondProgressPct >= record.firstProgressPct
            ? 'Actual accomplishment is within planned trajectory.'
            : 'Actual accomplishment is below baseline target.',
        submitted_by_name: record.engineer1.fullName,
        submitted_by_title: 'Engineer I',
        noted_by_name: 'KATHLEEN MEI P. BAGASIN',
        noted_by_title: 'Engineer IV',
      },
      lineItems: [],
      contractorChanges: [],
      status: 'draft',
      approvalFlow: null,
      releaseState: null,
    });

    await setDoc(doc(db, 'reports', iarId), {
      ...commonFields,
      reportNumber: reportNumber(record.projectId, 'IAR', '03'),
      reportType: 'IAR',
      reportData: {
        report_date: secondProgressDate,
        project_name: record.name,
        location: projectLocation,
        contractor: record.contractor.fullName,
        contract_amount: String(record.contractAmount),
        acceptance_status: record.projectStatus === 'completed' ? 'Accepted' : 'For inspection',
        submitted_by_name: record.engineer1.fullName,
        submitted_by_title: 'Engineer I',
        inspected_by_name: record.engineer2[0]!.fullName,
        inspected_by_title: 'Engineer II',
        prepared_by_name: record.engineer1.fullName,
        prepared_by_title: 'Engineer I',
        checked_by_name: 'KATHLEEN MEI P. BAGASIN',
        checked_by_title: 'Chief of Construction Division',
        recommending_name: 'KINGSTON JAMES S. DELA CRUZ',
        recommending_title: 'Provincial Engineer',
        approved_by_name: 'GEN. EDGAR B. AGLIPAY (RET.)',
        approved_by_title: 'Governor',
        contractor_representative: record.contractor.fullName,
        orig_target: String(record.firstProgressPct),
        rev_target: String(record.firstProgressPct),
        actual_progress: String(record.secondProgressPct),
        variance: String(round2(record.secondProgressPct - record.firstProgressPct)),
        activities_text: record.activities.map((activity) => `${activity.number} ${activity.name}`).join('\n'),
        field_instructions_text: 'Sample migrated IAR for end-to-end workflow validation.',
        accomplishment_items: record.lineItems.slice(0, 3).map((item, index) => ({
          id: `iar-item-${record.projectId}-${index + 1}`,
          itemNo: item.itemNo,
          description: item.description,
          location: projectLocation,
          physicalQty: round2(item.programmedQty * 0.5),
          billableQty: round2(item.programmedQty * 0.48),
          unit: item.unit,
        })),
        variation_items: [
          {
            id: `iar-variation-${record.projectId}`,
            itemNo: record.lineItems[0]!.itemNo,
            description: 'Minor alignment adjustment',
            quantity: 1,
            unit: 'lot',
            additive: '25000.00',
            deductive: '',
            newItem: '',
          },
        ],
        manpower: [
          { id: `iar-mp-${record.projectId}-1`, description: 'Foreman', quantity: 1 },
          { id: `iar-mp-${record.projectId}-2`, description: 'Skilled workers', quantity: 8 },
        ],
        equipment: [
          { id: `iar-eq-${record.projectId}-1`, description: 'Dump truck', quantity: 2 },
          { id: `iar-eq-${record.projectId}-2`, description: 'Concrete mixer', quantity: 1 },
        ],
      },
      lineItems: [],
      contractorChanges: [],
      status: 'draft',
      approvalFlow: {
        contractorConfirmation: null,
        engineer2: null,
        engineer3: null,
        engineer4: null,
        currentStage: 'draft',
        correctionCycle: 0,
        lastCorrectionReason: null,
        lastCorrectionBy: null,
        lastCorrectionRole: null,
      },
      releaseState: null,
    });

    for (const [reportId, action, kind] of [
      [swaId, 'created', 'SWA'],
      [stewaId, 'created', 'STEWA'],
      [iarId, 'created', 'IAR'],
    ] as const) {
      await setDoc(doc(db, 'reports', reportId, 'audit', 'created'), {
        action,
        details: { source: 'sample_migration', reportType: kind },
        actorName: record.engineer1.fullName,
        createdAt,
      });
    }
  });

  summary.reportsCreated += 3;
  summary.reportAuditEntriesCreated += 3;
}

async function hasSeedReports(db: Firestore, auth: Auth, record: SampleProjectRecord) {
  return runAs(auth, LOGIN_ACCOUNTS.engineer1_1, async ({ db }) => {
    const ids = [
      reportDocId(record.projectId, 'swa'),
      reportDocId(record.projectId, 'stewa'),
      reportDocId(record.projectId, 'iar'),
    ];
    const snaps = await Promise.all(ids.map((id) => getDoc(doc(db, 'reports', id))));
    return snaps.every((snap) => snap.exists());
  });
}

async function advanceNonIarToApproved(
  db: Firestore,
  auth: Auth,
  record: SampleProjectRecord,
  reportId: string,
  reportType: 'SWA' | 'STEWA',
  percent: number,
  reportDate: string,
  summary: MigrationSummary,
) {
  await runAs(auth, LOGIN_ACCOUNTS.engineer1_1, async ({ db }) => {
    const ref = doc(db, 'reports', reportId);
    console.log(`    ${reportType}: engineer1 -> pending_contractor`);
    await updateDoc(ref, {
      status: 'pending_contractor',
      updatedAt: nowIso(),
      contractorChanges: [],
      editUserIds: uniqueStrings([record.contractor.uid, record.engineer1.uid]),
    });
    await setDoc(doc(db, 'reports', reportId, 'audit', 'sent-to-contractor'), {
      action: 'sent_to_contractor',
      details: { source: 'sample_migration' },
      actorName: record.engineer1.fullName,
      createdAt: nowIso(),
    });
  });
  summary.reportAuditEntriesCreated += 1;

  await runAs(auth, LOGIN_ACCOUNTS[`contractor${record.contractor.email.endsWith('1@gmail.com') ? '1' : record.contractor.email.endsWith('2@gmail.com') ? '2' : '3'}`], async ({ db }) => {
    const ref = doc(db, 'reports', reportId);
    console.log(`    ${reportType}: contractor -> contractor_confirmed`);
    await updateDoc(ref, {
      status: 'contractor_confirmed',
      updatedAt: nowIso(),
    });
  });

  await runAs(auth, LOGIN_ACCOUNTS.engineer1_1, async ({ db }) => {
    const ref = doc(db, 'reports', reportId);
    console.log(`    ${reportType}: engineer1 -> pending_review`);
    await updateDoc(ref, {
      status: 'pending_review',
      updatedAt: nowIso(),
    });
  });

  await runAs(auth, LOGIN_ACCOUNTS[`engineer2_${record.engineer2[0]!.email.endsWith('1@gmail.com') ? '1' : record.engineer2[0]!.email.endsWith('2@gmail.com') ? '2' : '3'}`], async ({ db }) => {
    const ref = doc(db, 'reports', reportId);
    console.log(`    ${reportType}: engineer2 -> with_engineer_3`);
    await updateDoc(ref, {
      status: 'with_engineer_3',
      updatedAt: nowIso(),
    });
  });

  await runAs(auth, LOGIN_ACCOUNTS.engineer3_1, async ({ db }) => {
    const ref = doc(db, 'reports', reportId);
    console.log(`    ${reportType}: engineer3 -> with_engineer_4`);
    await updateDoc(ref, {
      status: 'with_engineer_4',
      updatedAt: nowIso(),
    });
  });

  await runAs(auth, LOGIN_ACCOUNTS.engineer4_1, async ({ db }) => {
    const ref = doc(db, 'reports', reportId);
    console.log(`    ${reportType}: engineer4 -> approved`);
    await updateDoc(ref, {
      status: 'approved',
      updatedAt: nowIso(),
    });
    await setDoc(doc(db, 'emailQueue', `${reportId}-approved`), {
      reportId,
      event: 'sample_approved',
      status: 'queued',
      createdAt: nowIso(),
      metadata: {
        reportType,
        reportDate,
        percent,
      },
    });
  });

  summary.emailQueueEntriesCreated += 1;
}

async function advanceIarReport(
  db: Firestore,
  auth: Auth,
  record: SampleProjectRecord,
  summary: MigrationSummary,
) {
  const reportId = reportDocId(record.projectId, 'iar');
  const contractorAccount =
    LOGIN_ACCOUNTS[
      record.contractor.email.endsWith('1@gmail.com')
        ? 'contractor1'
        : record.contractor.email.endsWith('2@gmail.com')
          ? 'contractor2'
          : 'contractor3'
    ];
  const engineer2Account =
    LOGIN_ACCOUNTS[
      record.engineer2[0]!.email.endsWith('1@gmail.com')
        ? 'engineer2_1'
        : record.engineer2[0]!.email.endsWith('2@gmail.com')
          ? 'engineer2_2'
          : 'engineer2_3'
    ];

  if (record.iarStatus === 'draft') {
    return;
  }

  await runAs(auth, LOGIN_ACCOUNTS.engineer1_1, async ({ db }) => {
    const ref = doc(db, 'reports', reportId);
    await updateDoc(ref, {
      status: 'pending_contractor',
      contractorBaseline: {
        report_date: record.progressDates[1],
      },
      contractorChanges: [],
      rejectionReason: null,
      editUserIds: uniqueStrings([record.contractor.uid, record.engineer1.uid]),
      approvalFlow: {
        contractorConfirmation: null,
        engineer2: null,
        engineer3: null,
        engineer4: null,
        currentStage: 'contractor_confirmation',
        correctionCycle: 0,
        lastCorrectionReason: null,
        lastCorrectionBy: null,
        lastCorrectionRole: null,
      },
      updatedAt: nowIso(),
    });
  });

  await runAs(auth, contractorAccount, async ({ db }) => {
    const ref = doc(db, 'reports', reportId);
    await updateDoc(ref, {
      status: 'contractor_confirmed',
      approvalFlow: {
        contractorConfirmation: {
          confirmedBy: record.contractor.uid,
          confirmedRole: 'contractor',
          confirmedAt: nowIso(),
          confirmsSwa: true,
          confirmsIar: true,
        },
        engineer2: null,
        engineer3: null,
        engineer4: null,
        currentStage: 'engineer_2',
        correctionCycle: 0,
        lastCorrectionReason: null,
        lastCorrectionBy: null,
        lastCorrectionRole: null,
      },
      updatedAt: nowIso(),
    });
  });

  await runAs(auth, LOGIN_ACCOUNTS.engineer1_1, async ({ db }) => {
    const ref = doc(db, 'reports', reportId);
    await updateDoc(ref, {
      status: 'pending_review',
      approvalFlow: {
        contractorConfirmation: {
          confirmedBy: record.contractor.uid,
          confirmedRole: 'contractor',
          confirmedAt: nowIso(),
          confirmsSwa: true,
          confirmsIar: true,
        },
        engineer2: null,
        engineer3: null,
        engineer4: null,
        currentStage: 'engineer_2',
        correctionCycle: 0,
        lastCorrectionReason: null,
        lastCorrectionBy: null,
        lastCorrectionRole: null,
      },
      updatedAt: nowIso(),
    });
  });

  if (record.iarStatus === 'pending_review') {
    return;
  }

  if (record.iarStatus === 'rejected') {
    await runAs(auth, engineer2Account, async ({ db }) => {
      const ref = doc(db, 'reports', reportId);
      await updateDoc(ref, {
        status: 'rejected',
        rejectionReason: 'Sample revision request for document completeness.',
        editUserIds: uniqueStrings([record.contractor.uid, record.engineer1.uid]),
        approvalFlow: {
          contractorConfirmation: null,
          engineer2: null,
          engineer3: null,
          engineer4: null,
          currentStage: 'draft',
          correctionCycle: 1,
          lastCorrectionReason: 'Sample revision request for document completeness.',
          lastCorrectionBy: record.engineer2[0]!.uid,
          lastCorrectionRole: 'engineer_2',
        },
        updatedAt: nowIso(),
      });
    });
    return;
  }

  await runAs(auth, engineer2Account, async ({ db }) => {
    const ref = doc(db, 'reports', reportId);
    await updateDoc(ref, {
      status: 'with_engineer_3',
      approvalFlow: {
        contractorConfirmation: {
          confirmedBy: record.contractor.uid,
          confirmedRole: 'contractor',
          confirmedAt: nowIso(),
          confirmsSwa: true,
          confirmsIar: true,
        },
        engineer2: {
          approvedBy: record.engineer2[0]!.uid,
          approvedRole: 'engineer_2',
          approvedAt: nowIso(),
        },
        engineer3: null,
        engineer4: null,
        currentStage: 'engineer_3',
        correctionCycle: 0,
        lastCorrectionReason: null,
        lastCorrectionBy: null,
        lastCorrectionRole: null,
      },
      updatedAt: nowIso(),
    });
  });

  if (record.iarStatus === 'with_engineer_3') {
    return;
  }

  await runAs(auth, LOGIN_ACCOUNTS.engineer3_1, async ({ db }) => {
    const ref = doc(db, 'reports', reportId);
    await updateDoc(ref, {
      status: 'with_engineer_4',
      approvalFlow: {
        contractorConfirmation: {
          confirmedBy: record.contractor.uid,
          confirmedRole: 'contractor',
          confirmedAt: nowIso(),
          confirmsSwa: true,
          confirmsIar: true,
        },
        engineer2: {
          approvedBy: record.engineer2[0]!.uid,
          approvedRole: 'engineer_2',
          approvedAt: nowIso(),
        },
        engineer3: {
          approvedBy: usersByRole.engineer_3[0]!.uid,
          approvedRole: 'engineer_3',
          approvedAt: nowIso(),
        },
        engineer4: null,
        currentStage: 'engineer_4',
        correctionCycle: 0,
        lastCorrectionReason: null,
        lastCorrectionBy: null,
        lastCorrectionRole: null,
      },
      updatedAt: nowIso(),
    });
  });

  if (record.iarStatus === 'with_engineer_4') {
    return;
  }

  await runAs(auth, LOGIN_ACCOUNTS.engineer4_1, async ({ db }) => {
    const ref = doc(db, 'reports', reportId);
    await updateDoc(ref, {
      status: 'approved',
      approvalFlow: {
        contractorConfirmation: {
          confirmedBy: record.contractor.uid,
          confirmedRole: 'contractor',
          confirmedAt: nowIso(),
          confirmsSwa: true,
          confirmsIar: true,
        },
        engineer2: {
          approvedBy: record.engineer2[0]!.uid,
          approvedRole: 'engineer_2',
          approvedAt: nowIso(),
        },
        engineer3: {
          approvedBy: usersByRole.engineer_3[0]!.uid,
          approvedRole: 'engineer_3',
          approvedAt: nowIso(),
        },
        engineer4: {
          approvedBy: usersByRole.engineer_4[0]!.uid,
          approvedRole: 'engineer_4',
          approvedAt: nowIso(),
        },
        currentStage: 'engineer_4',
        correctionCycle: 0,
        lastCorrectionReason: null,
        lastCorrectionBy: null,
        lastCorrectionRole: null,
      },
      releaseState: {
        optionalAttachments: ['pdm', 'bar_chart', 's_curve', 'swa', 'stewa'],
        attachmentsReleasedAt: null,
        releasedBy: usersByRole.engineer_4[0]!.uid,
        releasedRole: 'engineer_4',
        emailSentAt: null,
      },
      updatedAt: nowIso(),
    });
  });
}

const usersByRole: Record<Role, SeedUser[]> = {
  contractor: [],
  engineer_1: [],
  engineer_2: [],
  engineer_3: [],
  engineer_4: [],
};

async function updateUserProjectPointers(db: Firestore, auth: Auth, records: SampleProjectRecord[], summary: MigrationSummary) {
  await runAs(auth, LOGIN_ACCOUNTS.engineer4_1, async ({ db }) => {
    for (const role of Object.keys(usersByRole) as Role[]) {
      for (const user of usersByRole[role]) {
        const assignedProjectIds = records
          .filter((record) => role === 'contractor'
            ? record.contractor.uid === user.uid
            : role === 'engineer_1'
              ? uniqueStrings([record.engineer1.uid, LOGIN_ACCOUNTS.engineer1_1.email === user.email ? user.uid : null]).includes(user.uid)
              : false)
          .map((record) => record.projectId);
        const involvedProjectIds = records
          .filter((record) => record.engineer2.some((engineer) => engineer.uid === user.uid))
          .map((record) => record.projectId);
        const accessibleProjectIds =
          role === 'engineer_3' || role === 'engineer_4'
            ? records.map((record) => record.projectId)
            : uniqueStrings([...assignedProjectIds, ...involvedProjectIds]);
        const ref = doc(db, 'users', user.uid);
        const current = await getDoc(ref);
        if (!current.exists()) continue;
        const data = current.data() as Record<string, unknown>;
        await updateDoc(ref, {
          assignedProjectIds: uniqueStrings([
            ...(Array.isArray(data.assignedProjectIds) ? data.assignedProjectIds.map(String) : []),
            ...assignedProjectIds,
          ]),
          involvedProjectIds: uniqueStrings([
            ...(Array.isArray(data.involvedProjectIds) ? data.involvedProjectIds.map(String) : []),
            ...involvedProjectIds,
          ]),
          accessibleProjectIds: uniqueStrings([
            ...(Array.isArray(data.accessibleProjectIds) ? data.accessibleProjectIds.map(String) : []),
            ...accessibleProjectIds,
          ]),
          updatedAt: nowIso(),
        });
        summary.usersUpdated += 1;
      }
    }
  });
}

async function verifySampleData(db: Firestore, records: SampleProjectRecord[]) {
  const projectSnap = await getDocs(collection(db, 'projects'));
  const targetIds = new Set(records.map((record) => record.projectId));
  const sampleProjects = projectSnap.docs.filter((projectDoc) => targetIds.has(projectDoc.id));
  const projectIdChunks = [records.slice(0, 10), records.slice(10)].filter((chunk) => chunk.length > 0);
  const reportDocs = [];
  for (const chunk of projectIdChunks) {
    const snap = await getDocs(
      query(
        collection(db, 'reports'),
        where(
          'projectId',
          'in',
          chunk.map((record) => record.projectId),
        ),
      ),
    );
    reportDocs.push(...snap.docs);
  }
  const reports = reportDocs;

  let activityCount = 0;
  let schedules = 0;
  let sCurves = 0;
  let snapshots = 0;
  let contractHistory = 0;
  let projectAudit = 0;
  let scheduleIssues = 0;
  let costIssues = 0;
  let reportsByType = { SWA: 0, STEWA: 0, IAR: 0 };

  for (const record of records) {
    const schedule = await getDoc(doc(db, 'schedules', record.projectId));
    const sCurve = await getDoc(doc(db, 'sCurves', record.projectId));
    const snapshotDocs = await getDocs(collection(db, 'sCurves', record.projectId, 'snapshots'));
    const historyDocs = await getDocs(collection(db, 'projects', record.projectId, 'contractHistory'));
    const auditDocs = await getDocs(collection(db, 'projects', record.projectId, 'auditLog'));

    if (schedule.exists()) {
      schedules += 1;
      const data = schedule.data() as Record<string, unknown>;
      const activities = (data.activities as PdmActivity[]) ?? [];
      activityCount += activities.length;
      const derived = deriveBarChartFromPdm(
        activities,
        ((data.dependencies as PdmDependency[]) ?? []),
      );
      if (Number(data.projectDuration ?? 0) !== derived.projectDuration) {
        scheduleIssues += 1;
      }
    }

    if (sCurve.exists()) {
      sCurves += 1;
      const data = sCurve.data() as Record<string, unknown>;
      const summary = computeSCurveCostSummary(
        record.activities.map((activity) => {
          const costItem = ((data.costItems as Array<{ activityId: string; quantity: number; unitCost: number }>) ?? [])
            .find((item) => item.activityId === activity.id);
          return {
            activityId: activity.id,
            itemNo: activity.number,
            description: activity.name,
            quantity: Number(costItem?.quantity ?? 0),
            unitCost: Number(costItem?.unitCost ?? 0),
          };
        }),
      );
      if (Math.abs(summary.totalContractAmount - record.contractAmount) > 1 || Math.abs(summary.totalWeightPct - 100) > 0.05) {
        costIssues += 1;
      }
    }

    snapshots += snapshotDocs.size;
    contractHistory += historyDocs.size;
    projectAudit += auditDocs.size;
  }

  for (const reportDoc of reports) {
    const type = String(reportDoc.data().reportType ?? '') as keyof typeof reportsByType;
    if (type in reportsByType) reportsByType[type] += 1;
  }

  const hasPdmBased = records.some((record) => record.curveType === 'pdm_based');
  const hasIdeal = records.some((record) => record.curveType === 'ideal_theoretical');
  const has10Day = records.some((record) => record.reportingInterval === '10_day');
  const has30Day = records.some((record) => record.reportingInterval === '30_day');

  return {
    projects: sampleProjects.length,
    activities: activityCount,
    schedules,
    sCurves,
    snapshots,
    contractHistory,
    projectAudit,
    reports: reports.length,
    reportsByType,
    scheduleIssues,
    costIssues,
    hasPdmBased,
    hasIdeal,
    has10Day,
    has30Day,
  };
}

async function main() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const summary: MigrationSummary = {
    projectsCreated: 0,
    projectsSkipped: 0,
    schedulesCreated: 0,
    sCurvesCreated: 0,
    sCurveSnapshotsCreated: 0,
    projectAuditEntriesCreated: 0,
    contractHistoryEntriesCreated: 0,
    reportsCreated: 0,
    reportAuditEntriesCreated: 0,
    emailQueueEntriesCreated: 0,
    activitiesCreated: 0,
    usersUpdated: 0,
  };

  const usersByEmail = await runAs(auth, LOGIN_ACCOUNTS.engineer1_1, async ({ db }) => loadUsers(db));
  for (const user of usersByEmail.values()) {
    usersByRole[user.role].push(user);
  }

  assert(usersByRole.contractor.length >= 3, 'Expected at least 3 contractor accounts.');
  assert(usersByRole.engineer_1.length >= 3, 'Expected at least 3 Engineer I accounts.');
  assert(usersByRole.engineer_2.length >= 3, 'Expected at least 3 Engineer II accounts.');
  assert(usersByRole.engineer_3.length >= 1, 'Expected at least 1 Engineer III account.');
  assert(usersByRole.engineer_4.length >= 1, 'Expected at least 1 Engineer IV account.');

  const migrationActor = usersByEmail.get(LOGIN_ACCOUNTS.engineer1_1.email);
  assert(migrationActor, 'Migration actor Engineer I not found in users collection.');
  const projectLimit = Math.max(1, Math.min(PROJECT_BLUEPRINTS.length, Number(process.env.SAMPLE_LIMIT ?? PROJECT_BLUEPRINTS.length)));

  const records = PROJECT_BLUEPRINTS.slice(0, projectLimit).map((blueprint) =>
    buildSampleProjectRecord(blueprint, usersByEmail, migrationActor),
  );
  console.log(`Preparing ${records.length} sample projects in Firebase project ${firebaseConfig.projectId}`);

  for (const record of records) {
    console.log(`Seeding ${record.projectId}`);
    const created = await ensureProject(db, auth, record, migrationActor, summary);
    const alreadySeeded = await hasSeedReports(db, auth, record);
    if (!created && alreadySeeded) {
      console.log(`Skipping ${record.projectId} because reports already exist.`);
      continue;
    }
    console.log(`Creating reports for ${record.projectId}`);
    await createDraftReports(db, auth, record, summary);
    console.log(`Approving SWA for ${record.projectId}`);
    await advanceNonIarToApproved(
      db,
      auth,
      record,
      reportDocId(record.projectId, 'swa'),
      'SWA',
      record.firstProgressPct,
      record.progressDates[0],
      summary,
    );
    console.log(`Approving STEWA for ${record.projectId}`);
    await advanceNonIarToApproved(
      db,
      auth,
      record,
      reportDocId(record.projectId, 'stewa'),
      'STEWA',
      record.secondProgressPct,
      record.progressDates[1],
      summary,
    );
    console.log(`Advancing IAR for ${record.projectId} to ${record.iarStatus}`);
    await advanceIarReport(db, auth, record, summary);
  }

  await updateUserProjectPointers(db, auth, records, summary);

  const verification = await runAs(auth, LOGIN_ACCOUNTS.engineer4_1, async ({ db }) =>
    verifySampleData(db, records),
  );

  console.log(
    JSON.stringify(
      {
        firebaseProjectId: firebaseConfig.projectId,
        summary,
        verification,
        note:
          'Sample data uses fixed sample-* IDs and SAMPLE-prefixed project names. Existing non-sample records were not overwritten.',
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
