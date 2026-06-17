import React, { useState, useEffect, useMemo } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import {
  getFirestore,
  collection,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  writeBatch,
  Firestore,
} from "firebase/firestore";
import {
  MapPin,
  User,
  Upload,
  Search,
  CheckCircle,
  AlertTriangle,
  Shield,
  Map as MapIcon,
  Trash2,
  Plus,
  Save,
  Pencil,
  Download,
  X,
  Filter,
} from "lucide-react";

// --- YOUR FIREBASE CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyBKfRfDYlWoCjWSozT4dJhLStlAU-Auuxo",
  authDomain: "scheduler-49bbf.firebaseapp.com",
  projectId: "scheduler-49bbf",
  storageBucket: "scheduler-49bbf.firebasestorage.app",
  messagingSenderId: "903464714027",
  appId: "1:903464714027:web:683319612184162144cf6e",
  measurementId: "G-SZMTG5FMGB",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- Domain types ---
interface Engineer {
  id: string;
  name: string;
  areas: string[];
  skills: string[];
}
interface NamedDoc {
  id: string;
  name: string;
}
type Area = NamedDoc;
type TaskDoc = NamedDoc;

interface ScoredEngineer extends Engineer {
  matchedTasks: string[];
  missingTasks: string[];
  matchScore: number;
  totalRequired: number;
}

// --- Helpers ---
const slugify = (s: string) => s.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();

const byName = (a: NamedDoc, b: NamedDoc) =>
  (a.name || "").localeCompare(b.name || "");

const initialOf = (name?: string) =>
  name && name.trim() ? name.trim().charAt(0).toUpperCase() : "?";

// Parse a single CSV line respecting double-quoted fields (incl. escaped "").
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((p) => p.trim());
}

const csvCell = (value: string) =>
  /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

function downloadCsv(filename: string, rows: string[][]) {
  const content = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Comprehensive UK Regions & Counties List
const UK_REGIONS = [
  "Aberdeen",
  "Aberdeenshire",
  "Anglesey",
  "Angus",
  "Antrim",
  "Argyll and Bute",
  "Armagh",
  "Bedfordshire",
  "Berkshire",
  "Bristol",
  "Buckinghamshire",
  "Cambridgeshire",
  "Carmarthenshire",
  "Ceredigion",
  "Cheshire",
  "City of London",
  "Clackmannanshire",
  "Conwy",
  "Cornwall",
  "Cumbria",
  "Denbighshire",
  "Derbyshire",
  "Devon",
  "Dorset",
  "Down",
  "Dumfries and Galloway",
  "Dundee",
  "Durham",
  "East Ayrshire",
  "East Dunbartonshire",
  "East Lothian",
  "East Midlands",
  "East of England",
  "East Renfrewshire",
  "East Riding of Yorkshire",
  "East Sussex",
  "Edinburgh",
  "Essex",
  "Falkirk",
  "Fermanagh",
  "Fife",
  "Flintshire",
  "Glamorgan",
  "Glasgow",
  "Gloucestershire",
  "Greater London",
  "Greater Manchester",
  "Gwynedd",
  "Hampshire",
  "Herefordshire",
  "Hertfordshire",
  "Highland",
  "Inverclyde",
  "Isle of Wight",
  "Kent",
  "Lancashire",
  "Leicestershire",
  "Lincolnshire",
  "London",
  "Londonderry",
  "Merseyside",
  "Midlothian",
  "Midlands",
  "Monmouthshire",
  "Moray",
  "Norfolk",
  "North",
  "North Ayrshire",
  "North East",
  "North Lanarkshire",
  "North West",
  "North Yorkshire",
  "Northamptonshire",
  "Northern Ireland",
  "Northumberland",
  "Nottinghamshire",
  "Orkney",
  "Oxfordshire",
  "Pembrokeshire",
  "Perth and Kinross",
  "Powys",
  "Renfrewshire",
  "Rutland",
  "Scotland",
  "Scottish Borders",
  "Shetland",
  "Shropshire",
  "Somerset",
  "South",
  "South Ayrshire",
  "South East",
  "South Lanarkshire",
  "South West",
  "South Yorkshire",
  "Staffordshire",
  "Stirling",
  "Suffolk",
  "Surrey",
  "Tyne and Wear",
  "Tyrone",
  "Wales",
  "Warwickshire",
  "West Dunbartonshire",
  "West Lothian",
  "West Midlands",
  "West Sussex",
  "West Yorkshire",
  "Western Isles",
  "Wiltshire",
  "Worcestershire",
  "Wrexham",
  "Yorkshire and The Humber",
];

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [activeTab, setActiveTab] = useState<"dispatch" | "admin">("dispatch");
  const [loading, setLoading] = useState(true);

  // Data states
  const [engineers, setEngineers] = useState<Engineer[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [tasks, setTasks] = useState<TaskDoc[]>([]);

  // Auth Effect
  useEffect(() => {
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        console.error("Auth error:", err);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Data Fetching Effect
  useEffect(() => {
    if (!user) return;

    const unsubEngineers = onSnapshot(
      collection(db, "engineers"),
      (snap) => {
        const engs: Engineer[] = [];
        snap.forEach((d) => {
          const data = d.data() as Partial<Engineer>;
          engs.push({
            id: d.id,
            name: data.name || "",
            areas: data.areas || [],
            skills: data.skills || [],
          });
        });
        setEngineers(engs.sort(byName));
      },
      (err) => console.error("Error fetching engineers:", err)
    );

    const unsubAreas = onSnapshot(
      collection(db, "areas"),
      (snap) => {
        const ars: Area[] = [];
        snap.forEach((d) =>
          ars.push({ id: d.id, name: (d.data().name as string) || "" })
        );
        setAreas(ars.sort(byName));
      },
      (err) => console.error("Error fetching areas:", err)
    );

    const unsubTasks = onSnapshot(
      collection(db, "tasks"),
      (snap) => {
        const tsks: TaskDoc[] = [];
        snap.forEach((d) =>
          tsks.push({ id: d.id, name: (d.data().name as string) || "" })
        );
        setTasks(tsks.sort(byName));
      },
      (err) => console.error("Error fetching tasks:", err)
    );

    return () => {
      unsubEngineers();
      unsubAreas();
      unsubTasks();
    };
  }, [user]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 text-gray-500">
        Connecting to real-time database...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 font-sans text-gray-800">
      {/* Header */}
      <header className="bg-slate-900 text-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-3">
              <Shield className="w-8 h-8 text-blue-400" />
              <h1 className="text-2xl font-bold tracking-tight">
                FieldOps Dispatch
              </h1>
            </div>
            <nav className="flex space-x-4">
              <button
                onClick={() => setActiveTab("dispatch")}
                className={`px-4 py-2 rounded-md font-medium transition-colors ${
                  activeTab === "dispatch"
                    ? "bg-blue-600 text-white"
                    : "text-gray-300 hover:bg-slate-800"
                }`}
              >
                Dispatch Board
              </button>
              <button
                onClick={() => setActiveTab("admin")}
                className={`px-4 py-2 rounded-md font-medium transition-colors ${
                  activeTab === "admin"
                    ? "bg-blue-600 text-white"
                    : "text-gray-300 hover:bg-slate-800"
                }`}
              >
                Admin Panel
              </button>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === "dispatch" ? (
          <DispatchScreen engineers={engineers} areas={areas} tasks={tasks} />
        ) : (
          <AdminScreen
            engineers={engineers}
            areas={areas}
            tasks={tasks}
            db={db}
          />
        )}
      </main>
    </div>
  );
}

// ==========================================
// DISPATCH SCREEN
// ==========================================
function DispatchScreen({
  engineers,
  areas,
  tasks,
}: {
  engineers: Engineer[];
  areas: Area[];
  tasks: TaskDoc[];
}) {
  const [selectedArea, setSelectedArea] = useState("");
  const [selectedTasks, setSelectedTasks] = useState<string[]>([]);
  const [nameQuery, setNameQuery] = useState("");
  const [showOnlyMatches, setShowOnlyMatches] = useState(true);

  const toggleTask = (taskName: string) => {
    setSelectedTasks((prev) =>
      prev.includes(taskName)
        ? prev.filter((t) => t !== taskName)
        : [...prev, taskName]
    );
  };

  // Derived results — recomputed only when inputs change (no extra render).
  const results = useMemo<ScoredEngineer[]>(() => {
    if (!selectedArea) return [];

    const areaEngineers = engineers.filter((eng) =>
      (eng.areas || []).includes(selectedArea)
    );

    const scored: ScoredEngineer[] = areaEngineers.map((eng) => {
      const skills = eng.skills || [];
      const matchedTasks = selectedTasks.filter((task) =>
        skills.includes(task)
      );
      const missingTasks = selectedTasks.filter(
        (task) => !skills.includes(task)
      );
      return {
        ...eng,
        matchedTasks,
        missingTasks,
        matchScore: matchedTasks.length,
        totalRequired: selectedTasks.length,
      };
    });

    scored.sort((a, b) => b.matchScore - a.matchScore || byName(a, b));

    const hasTasks = selectedTasks.length > 0;
    const q = nameQuery.trim().toLowerCase();
    return scored.filter((eng) => {
      if (hasTasks && showOnlyMatches && eng.matchScore === 0) return false;
      if (q && !eng.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [selectedArea, selectedTasks, engineers, nameQuery, showOnlyMatches]);

  const exportResults = () => {
    const rows: string[][] = [
      ["Engineer", "Areas", "Tasks Matched", "Matched Tasks", "Missing Tasks"],
      ...results.map((eng) => [
        eng.name,
        (eng.areas || []).join("; "),
        `${eng.matchScore}/${eng.totalRequired}`,
        eng.matchedTasks.join("; "),
        eng.missingTasks.join("; "),
      ]),
    ];
    downloadCsv(`dispatch-${slugify(selectedArea)}.csv`, rows);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* LEFT COLUMN: Filters & Map */}
      <div className="lg:col-span-1 space-y-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="bg-slate-50 px-5 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold flex items-center">
              <Search className="w-5 h-5 mr-2 text-blue-600" /> Job Requirements
            </h2>
          </div>
          <div className="p-5 space-y-5">
            {/* Area Selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Target Area
              </label>
              <select
                value={selectedArea}
                onChange={(e) => setSelectedArea(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              >
                <option value="">-- Select an Area --</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Task Selector (Multi) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Required Tasks (Select Multiple)
              </label>
              <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1 bg-gray-50">
                {tasks.length === 0 && (
                  <p className="text-sm text-gray-500 p-2">
                    No tasks available. Add them in the Admin panel.
                  </p>
                )}
                {tasks.map((t) => (
                  <label
                    key={t.id}
                    className="flex items-center p-2 hover:bg-blue-50 rounded cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedTasks.includes(t.name)}
                      onChange={() => toggleTask(t.name)}
                      className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                    />
                    <span className="ml-3 text-sm text-gray-800">{t.name}</span>
                  </label>
                ))}
              </div>
              {selectedTasks.length > 0 && (
                <button
                  onClick={() => setSelectedTasks([])}
                  className="mt-2 text-xs text-blue-600 hover:underline"
                >
                  Clear {selectedTasks.length} selected task
                  {selectedTasks.length > 1 ? "s" : ""}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Map Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="bg-slate-50 px-5 py-3 border-b border-gray-200">
            <h2 className="text-md font-semibold flex items-center">
              <MapIcon className="w-4 h-4 mr-2 text-blue-600" /> Map View
            </h2>
          </div>
          <div className="h-64 bg-gray-200 relative w-full">
            {selectedArea ? (
              <iframe
                title="Google Maps Area"
                width="100%"
                height="100%"
                style={{ border: 0 }}
                loading="lazy"
                allowFullScreen
                src={`https://maps.google.com/maps?q=${encodeURIComponent(
                  selectedArea + " UK"
                )}&t=&z=7&ie=UTF8&iwloc=&output=embed`}
              ></iframe>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500 text-sm p-4 text-center">
                Select an area above to view it on the map.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: Results */}
      <div className="lg:col-span-2 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-2">
          <h2 className="text-xl font-bold text-gray-800">
            Available Engineers {selectedArea && `in ${selectedArea}`}
          </h2>
          {results.length > 0 && (
            <button
              onClick={exportResults}
              className="text-sm text-blue-600 bg-blue-50 hover:bg-blue-100 font-medium py-1.5 px-3 rounded-lg transition-colors flex items-center border border-blue-200"
            >
              <Download className="w-4 h-4 mr-2" /> Export Results
            </button>
          )}
        </div>

        {selectedArea && (
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={nameQuery}
                onChange={(e) => setNameQuery(e.target.value)}
                placeholder="Filter by engineer name..."
                className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            {selectedTasks.length > 0 && (
              <label className="flex items-center text-sm text-gray-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showOnlyMatches}
                  onChange={(e) => setShowOnlyMatches(e.target.checked)}
                  className="w-4 h-4 mr-2 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
                Only show engineers with a matching skill
              </label>
            )}
          </div>
        )}

        {!selectedArea ? (
          <div className="bg-blue-50 rounded-xl p-8 text-center border border-blue-100">
            <User className="w-12 h-12 text-blue-300 mx-auto mb-3" />
            <h3 className="text-lg font-medium text-blue-800">
              Ready to Dispatch
            </h3>
            <p className="text-blue-600 mt-1">
              Select an Area on the left to see available engineers.
            </p>
          </div>
        ) : results.length === 0 ? (
          <div className="bg-orange-50 rounded-xl p-8 text-center border border-orange-100">
            <AlertTriangle className="w-12 h-12 text-orange-400 mx-auto mb-3" />
            <h3 className="text-lg font-medium text-orange-800">
              No Engineers Found
            </h3>
            <p className="text-orange-600 mt-1">
              No engineers match your criteria for {selectedArea}.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {results.map((eng) => (
              <EngineerMatchCard
                key={eng.id}
                engineer={eng}
                totalRequired={selectedTasks.length}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EngineerMatchCard({
  engineer,
  totalRequired,
}: {
  engineer: ScoredEngineer;
  totalRequired: number;
}) {
  const isPerfectMatch =
    totalRequired > 0 && engineer.matchScore === totalRequired;

  return (
    <div
      className={`bg-white rounded-xl shadow-sm border overflow-hidden transition-all hover:shadow-md ${
        isPerfectMatch
          ? "border-green-400 ring-1 ring-green-400"
          : "border-gray-200"
      }`}
    >
      <div className="p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center">
        <div className="flex items-center mb-4 sm:mb-0">
          <div
            className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg ${
              isPerfectMatch
                ? "bg-green-100 text-green-700"
                : "bg-blue-100 text-blue-700"
            }`}
          >
            {initialOf(engineer.name)}
          </div>
          <div className="ml-4">
            <h3 className="text-lg font-bold text-gray-900">
              {engineer.name || "Unnamed engineer"}
            </h3>
            <div className="flex items-center text-sm text-gray-500 mt-1">
              <MapPin className="w-4 h-4 mr-1" />
              {(engineer.areas || []).join(", ") || "No areas"}
            </div>
          </div>
        </div>

        {totalRequired > 0 && (
          <div
            className={`px-4 py-2 rounded-full text-sm font-bold flex items-center ${
              isPerfectMatch
                ? "bg-green-100 text-green-800"
                : "bg-orange-100 text-orange-800"
            }`}
          >
            {isPerfectMatch ? (
              <CheckCircle className="w-4 h-4 mr-2" />
            ) : (
              <AlertTriangle className="w-4 h-4 mr-2" />
            )}
            {engineer.matchScore} / {totalRequired} Tasks Matched
          </div>
        )}
      </div>

      {totalRequired > 0 && (
        <div className="bg-slate-50 p-4 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {engineer.matchedTasks.length > 0 && (
            <div>
              <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                Can Complete
              </h4>
              <ul className="space-y-1">
                {engineer.matchedTasks.map((task) => (
                  <li
                    key={task}
                    className="flex items-center text-sm text-green-700 font-medium"
                  >
                    <CheckCircle className="w-4 h-4 mr-2 text-green-500" />{" "}
                    {task}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {engineer.missingTasks.length > 0 && (
            <div>
              <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                Missing Skills
              </h4>
              <ul className="space-y-1">
                {engineer.missingTasks.map((task) => (
                  <li
                    key={task}
                    className="flex items-center text-sm text-red-600 font-medium bg-red-50 py-1 px-2 rounded"
                  >
                    <AlertTriangle className="w-4 h-4 mr-2 text-red-500 flex-shrink-0" />
                    <span>
                      Warning: Cannot do{" "}
                      <span className="font-bold">{task}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ==========================================
// ADMIN SCREEN
// ==========================================
function AdminScreen({
  engineers,
  areas,
  tasks,
  db,
}: {
  engineers: Engineer[];
  areas: Area[];
  tasks: TaskDoc[];
  db: Firestore;
}) {
  const [bulkData, setBulkData] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");

  // States for manual entry forms
  const [newTaskName, setNewTaskName] = useState("");
  const [newAreaName, setNewAreaName] = useState("");

  const [editingEngineerId, setEditingEngineerId] = useState<string | null>(
    null
  );
  const [engName, setEngName] = useState("");
  const [engAreas, setEngAreas] = useState<string[]>([]);
  const [engTasks, setEngTasks] = useState<string[]>([]);
  const [engineerQuery, setEngineerQuery] = useState("");

  const filteredEngineers = useMemo(() => {
    const q = engineerQuery.trim().toLowerCase();
    if (!q) return engineers;
    return engineers.filter((e) => e.name.toLowerCase().includes(q));
  }, [engineers, engineerQuery]);

  // --- Manual Entry Handlers ---
  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newTaskName.trim();
    if (!name) return;
    try {
      await setDoc(doc(collection(db, "tasks"), slugify(name)), { name });
      setNewTaskName("");
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddArea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAreaName) return;
    try {
      await setDoc(doc(collection(db, "areas"), slugify(newAreaName)), {
        name: newAreaName,
      });
      setNewAreaName("");
    } catch (err) {
      console.error(err);
    }
  };

  const resetEngineerForm = () => {
    setEditingEngineerId(null);
    setEngName("");
    setEngAreas([]);
    setEngTasks([]);
  };

  const startEditEngineer = (eng: Engineer) => {
    setEditingEngineerId(eng.id);
    setEngName(eng.name);
    setEngAreas(eng.areas || []);
    setEngTasks(eng.skills || []);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSaveEngineer = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = engName.trim();
    if (!name) return;
    try {
      // Editing keeps the original doc id stable even if the name changes;
      // a new engineer derives its id from the name.
      const engId = editingEngineerId || slugify(name);
      await setDoc(
        doc(collection(db, "engineers"), engId),
        { name, areas: engAreas, skills: engTasks },
        { merge: true }
      );
      resetEngineerForm();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteEngineer = async (eng: Engineer) => {
    if (!window.confirm(`Delete engineer "${eng.name}"?`)) return;
    try {
      await deleteDoc(doc(db, "engineers", eng.id));
      if (editingEngineerId === eng.id) resetEngineerForm();
    } catch (err) {
      console.error(err);
    }
  };

  // Delete an area/task and scrub the reference from every engineer.
  const deleteNamedDoc = async (
    coll: "areas" | "tasks",
    field: "areas" | "skills",
    item: NamedDoc
  ) => {
    const label = coll === "areas" ? "area" : "task";
    if (
      !window.confirm(
        `Delete ${label} "${item.name}"? It will also be removed from any engineers.`
      )
    )
      return;
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, coll, item.id));
      engineers.forEach((eng) => {
        if ((eng[field] || []).includes(item.name)) {
          batch.update(doc(db, "engineers", eng.id), {
            [field]: (eng[field] || []).filter((v) => v !== item.name),
          });
        }
      });
      await batch.commit();
    } catch (err) {
      console.error(err);
    }
  };

  const toggleEngTask = (taskName: string) => {
    setEngTasks((prev) =>
      prev.includes(taskName)
        ? prev.filter((t) => t !== taskName)
        : [...prev, taskName]
    );
  };

  // Read an attached .csv file into the textarea so it flows through the
  // same parser/upload path as pasted data.
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setBulkData(String(reader.result || ""));
      setUploadMessage(`Loaded "${file.name}". Review below, then Upload Data.`);
    };
    reader.onerror = () => setUploadMessage("Error: could not read that file.");
    reader.readAsText(file);
  };

  // --- Bulk Upload Handler ---
  const handleBulkUpload = async () => {
    if (!bulkData.trim()) {
      setUploadMessage("Please paste some CSV data first.");
      return;
    }

    setIsUploading(true);
    setUploadMessage("Processing...");

    try {
      const lines = bulkData.split(/\r?\n/).filter((line) => line.trim() !== "");
      const engineerMap: Record<
        string,
        { areas: Set<string>; skills: Set<string> }
      > = {};
      const allAreas = new Set<string>();
      const allTasks = new Set<string>();

      // Column mapping. Defaults to positional Task, Area, Engineer; if a
      // recognizable header row is present we map columns by their names so
      // the order doesn't matter.
      let taskIdx = 0;
      let areaIdx = 1;
      let engIdx = 2;
      let startIndex = 0;
      const header = parseCsvLine(lines[0]).map((c) => c.toLowerCase());
      const findCol = (...cands: string[]) =>
        header.findIndex((h) => cands.some((c) => h.includes(c)));
      const hasHeader =
        header.some((h) => h.includes("task") || h.includes("skill")) &&
        header.some((h) => h.includes("engineer") || h.includes("name"));
      if (hasHeader) {
        startIndex = 1;
        const ti = findCol("task", "skill", "job");
        const ai = findCol("area", "region", "county", "location");
        const ei = findCol("engineer");
        const ni = findCol("name");
        if (ti > -1) taskIdx = ti;
        if (ai > -1) areaIdx = ai;
        engIdx = ei > -1 ? ei : ni > -1 ? ni : engIdx;
      }

      let skipped = 0;
      for (let i = startIndex; i < lines.length; i++) {
        const parts = parseCsvLine(lines[i]);
        const [task, area, engName] = [
          parts[taskIdx],
          parts[areaIdx],
          parts[engIdx],
        ].map((p) => (p || "").trim());
        if (!task || !area || !engName) {
          skipped++;
          continue;
        }
        allTasks.add(task);
        allAreas.add(area);
        if (!engineerMap[engName])
          engineerMap[engName] = { areas: new Set(), skills: new Set() };
        engineerMap[engName].areas.add(area);
        engineerMap[engName].skills.add(task);
      }

      const engineerNames = Object.keys(engineerMap);
      if (engineerNames.length === 0) {
        setUploadMessage(
          "No valid rows found. Expected: Task, Area, Engineer Name."
        );
        return;
      }

      const batch = writeBatch(db);
      for (const area of allAreas) {
        batch.set(doc(collection(db, "areas"), slugify(area)), { name: area });
      }
      for (const task of allTasks) {
        batch.set(doc(collection(db, "tasks"), slugify(task)), { name: task });
      }
      for (const [name, data] of Object.entries(engineerMap)) {
        batch.set(
          doc(collection(db, "engineers"), slugify(name)),
          {
            name,
            areas: Array.from(data.areas),
            skills: Array.from(data.skills),
          },
          { merge: true }
        );
      }

      await batch.commit();
      setUploadMessage(
        `Success! Imported ${engineerNames.length} engineers, ${allAreas.size} areas, ${allTasks.size} tasks` +
          (skipped ? ` (${skipped} row${skipped > 1 ? "s" : ""} skipped).` : ".")
      );
      setBulkData("");
      setTimeout(() => setUploadMessage(""), 8000);
    } catch (error) {
      console.error(error);
      setUploadMessage(
        "Error processing data: " +
          (error instanceof Error ? error.message : String(error))
      );
    } finally {
      setIsUploading(false);
    }
  };

  const exportAll = () => {
    const rows: string[][] = [["Task", "Area", "Engineer"]];
    engineers.forEach((eng) => {
      const engAreasList = eng.areas || [];
      const engSkillsList = eng.skills || [];
      engSkillsList.forEach((skill) => {
        if (engAreasList.length === 0) {
          rows.push([skill, "", eng.name]);
        } else {
          engAreasList.forEach((area) => rows.push([skill, area, eng.name]));
        }
      });
    });
    downloadCsv("fieldops-export.csv", rows);
  };

  const clearDatabase = async () => {
    if (
      !window.confirm(
        "Are you absolutely sure you want to delete ALL data? This cannot be undone."
      )
    )
      return;
    try {
      const batch = writeBatch(db);
      engineers.forEach((e) => batch.delete(doc(db, "engineers", e.id)));
      areas.forEach((a) => batch.delete(doc(db, "areas", a.id)));
      tasks.forEach((t) => batch.delete(doc(db, "tasks", t.id)));
      await batch.commit();
      alert("Database wiped clean.");
    } catch (err) {
      alert(
        "Error clearing database: " +
          (err instanceof Error ? err.message : String(err))
      );
    }
  };

  return (
    <div className="space-y-8">
      <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-md">
        <div className="flex items-center">
          <AlertTriangle className="h-6 w-6 text-yellow-500 mr-3" />
          <p className="text-sm text-yellow-800">
            <strong>Admin Privileges:</strong> Changes made here reflect
            instantly for all users via Firebase real-time database.
          </p>
        </div>
      </div>

      {/* --- MANUAL ENTRY FORMS --- */}
      <h2 className="text-xl font-bold text-gray-800 mt-8 mb-4">
        Manual Data Entry
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Add Area */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="bg-slate-50 px-5 py-3 border-b border-gray-200">
            <h3 className="font-semibold text-gray-800">Add Operating Area</h3>
          </div>
          <div className="p-5">
            <form onSubmit={handleAddArea} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Select Region / County
                </label>
                <select
                  className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={newAreaName}
                  onChange={(e) => setNewAreaName(e.target.value)}
                  required
                >
                  <option value="">-- Choose Area --</option>
                  {UK_REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded transition flex items-center justify-center"
              >
                <Plus className="w-4 h-4 mr-2" /> Add Area
              </button>
            </form>

            <ManageList
              title={`Operating Areas (${areas.length})`}
              items={areas}
              onDelete={(item) => deleteNamedDoc("areas", "areas", item)}
            />
          </div>
        </div>

        {/* Add Task */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="bg-slate-50 px-5 py-3 border-b border-gray-200">
            <h3 className="font-semibold text-gray-800">Add New Task</h3>
          </div>
          <div className="p-5">
            <form onSubmit={handleAddTask} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Task Name
                </label>
                <input
                  type="text"
                  placeholder="e.g., Fire Alarm Test"
                  className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={newTaskName}
                  onChange={(e) => setNewTaskName(e.target.value)}
                  required
                />
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded transition flex items-center justify-center"
              >
                <Plus className="w-4 h-4 mr-2" /> Add Task
              </button>
            </form>

            <ManageList
              title={`Tasks (${tasks.length})`}
              items={tasks}
              onDelete={(item) => deleteNamedDoc("tasks", "skills", item)}
            />
          </div>
        </div>

        {/* Add / Edit Engineer */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="bg-slate-50 px-5 py-3 border-b border-gray-200 flex items-center justify-between">
            <h3 className="font-semibold text-gray-800">
              {editingEngineerId ? "Edit Engineer" : "Add Engineer"}
            </h3>
            {editingEngineerId && (
              <button
                onClick={resetEngineerForm}
                className="text-xs text-gray-500 hover:text-gray-800 flex items-center"
              >
                <X className="w-3.5 h-3.5 mr-1" /> Cancel edit
              </button>
            )}
          </div>
          <div className="p-5">
            <form onSubmit={handleSaveEngineer} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Engineer Name
                </label>
                <input
                  type="text"
                  placeholder="e.g., John Doe"
                  className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={engName}
                  onChange={(e) => setEngName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Assigned Areas (Hold Ctrl/Cmd to select multiple)
                </label>
                <select
                  multiple
                  className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none h-24"
                  value={engAreas}
                  onChange={(e) =>
                    setEngAreas(
                      Array.from(e.target.selectedOptions, (o) => o.value)
                    )
                  }
                >
                  {areas.map((a) => (
                    <option key={a.id} value={a.name}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Area missing? Add it in the first box.
                </p>
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Qualified Tasks
                </label>
                <div className="border border-gray-300 rounded p-2 max-h-32 overflow-y-auto space-y-1 bg-gray-50">
                  {tasks.length === 0 && (
                    <span className="text-xs text-gray-500">
                      No tasks added yet.
                    </span>
                  )}
                  {tasks.map((t) => (
                    <label
                      key={t.id}
                      className="flex items-center space-x-2 text-sm cursor-pointer hover:bg-gray-100 p-1 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={engTasks.includes(t.name)}
                        onChange={() => toggleEngTask(t.name)}
                        className="rounded text-blue-600 focus:ring-blue-500"
                      />
                      <span>{t.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2 rounded transition flex items-center justify-center"
              >
                <Save className="w-4 h-4 mr-2" />{" "}
                {editingEngineerId ? "Update Engineer" : "Save Engineer"}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* --- ENGINEER ROSTER --- */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="bg-slate-50 px-5 py-4 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold flex items-center">
            <User className="w-5 h-5 mr-2 text-blue-600" /> Engineer Roster (
            {engineers.length})
          </h2>
          <div className="relative">
            <Filter className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={engineerQuery}
              onChange={(e) => setEngineerQuery(e.target.value)}
              placeholder="Search engineers..."
              className="border border-gray-300 rounded-lg pl-9 pr-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
        </div>
        <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
          {engineers.length === 0 ? (
            <p className="text-sm text-gray-500 p-5">
              No engineers yet. Add one above or import a CSV.
            </p>
          ) : filteredEngineers.length === 0 ? (
            <p className="text-sm text-gray-500 p-5">
              No engineers match "{engineerQuery}".
            </p>
          ) : (
            filteredEngineers.map((eng) => (
              <div
                key={eng.id}
                className="px-5 py-3 flex items-center justify-between hover:bg-gray-50"
              >
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">
                    {eng.name || "Unnamed engineer"}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {(eng.areas || []).length} area
                    {(eng.areas || []).length === 1 ? "" : "s"} ·{" "}
                    {(eng.skills || []).length} skill
                    {(eng.skills || []).length === 1 ? "" : "s"}
                    {(eng.areas || []).length > 0 &&
                      ` — ${(eng.areas || []).join(", ")}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                  <button
                    onClick={() => startEditEngineer(eng)}
                    className="text-blue-600 hover:bg-blue-50 p-2 rounded-lg transition-colors"
                    title="Edit engineer"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteEngineer(eng)}
                    className="text-red-600 hover:bg-red-50 p-2 rounded-lg transition-colors"
                    title="Delete engineer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* --- BULK UPLOAD & STATS --- */}
      <h2 className="text-xl font-bold text-gray-800 mt-12 mb-4">
        Advanced Tools
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="bg-slate-50 px-5 py-4 border-b border-gray-200 flex justify-between items-center">
            <h2 className="text-lg font-semibold flex items-center">
              <Upload className="w-5 h-5 mr-2 text-blue-600" /> Bulk Import CSV
            </h2>
          </div>
          <div className="p-5 space-y-4">
            <p className="text-sm text-gray-600">
              Attach a <code className="bg-gray-100 px-1 py-0.5 rounded text-pink-600">.csv</code>{" "}
              file or paste data below. Expected columns:{" "}
              <code className="bg-gray-100 px-1 py-0.5 rounded text-pink-600">
                Task, Area, Engineer
              </code>
              . A header row is auto-detected (column order doesn't matter) and
              quoted fields with commas are supported.
            </p>

            <label className="inline-flex items-center cursor-pointer bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium py-2 px-4 rounded-lg transition-colors">
              <Upload className="w-4 h-4 mr-2 text-blue-600" /> Attach CSV File
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileSelect}
                disabled={isUploading}
                className="hidden"
              />
            </label>

            <textarea
              className="w-full h-48 border border-gray-300 rounded-lg p-3 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Task,Area,Engineer..."
              value={bulkData}
              onChange={(e) => setBulkData(e.target.value)}
              disabled={isUploading}
            ></textarea>

            <div className="flex items-center justify-between">
              <button
                onClick={handleBulkUpload}
                disabled={isUploading}
                className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded-lg transition-colors flex items-center shadow-sm disabled:opacity-50"
              >
                {isUploading ? "Processing..." : "Upload Data"}
              </button>

              {uploadMessage && (
                <span
                  className={`text-sm font-medium ${
                    uploadMessage.toLowerCase().includes("error") ||
                    uploadMessage.toLowerCase().includes("no valid")
                      ? "text-red-600"
                      : "text-green-600"
                  }`}
                >
                  {uploadMessage}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="bg-slate-50 px-5 py-4 border-b border-gray-200 flex justify-between items-center">
            <h2 className="text-lg font-semibold flex items-center">
              <User className="w-5 h-5 mr-2 text-blue-600" /> Database Overview
            </h2>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-3 gap-4 mb-8">
              <div className="bg-blue-50 rounded-lg p-4 text-center border border-blue-100">
                <p className="text-3xl font-bold text-blue-700">
                  {engineers.length}
                </p>
                <p className="text-xs text-blue-600 uppercase font-bold mt-1">
                  Engineers
                </p>
              </div>
              <div className="bg-purple-50 rounded-lg p-4 text-center border border-purple-100">
                <p className="text-3xl font-bold text-purple-700">
                  {areas.length}
                </p>
                <p className="text-xs text-purple-600 uppercase font-bold mt-1">
                  Areas
                </p>
              </div>
              <div className="bg-emerald-50 rounded-lg p-4 text-center border border-emerald-100">
                <p className="text-3xl font-bold text-emerald-700">
                  {tasks.length}
                </p>
                <p className="text-xs text-emerald-600 uppercase font-bold mt-1">
                  Tasks
                </p>
              </div>
            </div>

            <div className="border-t pt-6 space-y-6">
              <div>
                <h3 className="text-sm font-bold text-gray-800 mb-3 uppercase tracking-wider">
                  Export
                </h3>
                <p className="text-sm text-gray-500 mb-4">
                  Download all engineers, areas and skills as a CSV
                  (Task, Area, Engineer).
                </p>
                <button
                  onClick={exportAll}
                  disabled={engineers.length === 0}
                  className="text-blue-600 bg-blue-50 hover:bg-blue-100 font-medium py-2 px-4 rounded-lg transition-colors flex items-center border border-blue-200 disabled:opacity-50"
                >
                  <Download className="w-4 h-4 mr-2" /> Export All Data
                </button>
              </div>

              <div>
                <h3 className="text-sm font-bold text-gray-800 mb-3 uppercase tracking-wider">
                  Danger Zone
                </h3>
                <p className="text-sm text-gray-500 mb-4">
                  Need to start fresh? You can wipe the entire database here.
                </p>
                <button
                  onClick={clearDatabase}
                  className="text-red-600 bg-red-50 hover:bg-red-100 font-medium py-2 px-4 rounded-lg transition-colors flex items-center border border-red-200"
                >
                  <Trash2 className="w-4 h-4 mr-2" /> Wipe Entire Database
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Small reusable list with delete buttons for areas / tasks.
function ManageList({
  title,
  items,
  onDelete,
}: {
  title: string;
  items: NamedDoc[];
  onDelete: (item: NamedDoc) => void;
}) {
  return (
    <div className="mt-5 border-t border-gray-100 pt-4">
      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
        {title}
      </h4>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400">Nothing added yet.</p>
      ) : (
        <ul className="max-h-40 overflow-y-auto space-y-1">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between text-sm bg-gray-50 rounded px-2 py-1"
            >
              <span className="truncate text-gray-700">{item.name}</span>
              <button
                onClick={() => onDelete(item)}
                className="text-red-500 hover:text-red-700 p-1 flex-shrink-0"
                title={`Delete ${item.name}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
