import { useState, useEffect, useMemo } from "react";
import ExcelJS from "exceljs";
import { Plus, Trash2, X, Users, Music, Route, Shirt, ClipboardList, AlertCircle, Wand2, CheckCircle2, CircleDashed, ChevronDown, ChevronUp, LogOut, Download, Pencil, Check, Bookmark, Save, Archive, ArchiveRestore, Layers } from "lucide-react";
import { supabase, supabaseConfigured } from "./lib/supabase";
import * as db from "./lib/db";

const fmtTime = (totalSeconds) => {
  const s = Math.max(0, totalSeconds || 0);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
};

function computeCoverage(pieces, rolesByPiece, assignmentsByRole, availableIds, includeOptional = true) {
  return pieces.map(piece => {
    const ts = rolesByPiece[piece.id] || [];
    if (ts.length === 0) return { piece, status: "no-roles", missing: [] };
    const relevant = includeOptional ? ts : ts.filter(t => t.required !== false);
    const missing = [];
    relevant.forEach(t => {
      const asg = assignmentsByRole[t.id] || [];
      const covered = asg.length > 0 && asg.some(a => availableIds.has(a.personId));
      if (!covered) missing.push(t);
    });
    return { piece, status: missing.length === 0 ? "doable" : "missing", missing };
  });
}

const countBits = (x) => { let c = 0; while (x) { c += x & 1; x >>= 1; } return c; };
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function generateShowOptions(doablePieces, targetSeconds, maxResults = 10) {
  const n = doablePieces.length;
  if (n === 0) return [];
  if (targetSeconds == null) {
    return [{ pieces: doablePieces, total: doablePieces.reduce((s, p) => s + (p.length || 0), 0) }];
  }
  if (n <= 20) {
    const pow2idx = {};
    for (let i = 0; i < n; i++) pow2idx[1 << i] = i;
    const size = 1 << n;
    const sums = new Array(size).fill(0);
    for (let mask = 1; mask < size; mask++) {
      const low = mask & -mask;
      const idx = pow2idx[low];
      sums[mask] = sums[mask ^ low] + (doablePieces[idx].length || 0);
    }
    const options = [];
    for (let mask = 1; mask < size; mask++) {
      if (sums[mask] <= targetSeconds) options.push({ mask, total: sums[mask] });
    }
    options.sort((a, b) => b.total - a.total || countBits(a.mask) - countBits(b.mask));
    return options.slice(0, maxResults).map(o => ({
      pieces: doablePieces.filter((_, i) => (o.mask & (1 << i)) !== 0),
      total: o.total,
    }));
  }
  const orderings = [
    [...doablePieces].sort((a, b) => (b.length || 0) - (a.length || 0)),
    [...doablePieces].sort((a, b) => (a.length || 0) - (b.length || 0)),
  ];
  for (let i = 0; i < 10; i++) orderings.push(shuffle([...doablePieces]));
  const seen = new Set();
  const results = [];
  orderings.forEach(order => {
    let total = 0;
    const chosen = [];
    order.forEach(p => {
      if (total + (p.length || 0) <= targetSeconds) { chosen.push(p); total += (p.length || 0); }
    });
    const key = chosen.map(p => p.id).sort().join(",");
    if (chosen.length > 0 && !seen.has(key)) { seen.add(key); results.push({ pieces: chosen, total }); }
  });
  results.sort((a, b) => b.total - a.total);
  return results.slice(0, maxResults);
}

export default function CallBoard() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(undefined); // undefined = checking, null = signed out
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("builder");
  const [data, setData] = useState({ people: [], pieces: [], roles: [], props: [], assignments: [], castPresets: [], savedShows: [], tracks: [] });

  const refresh = async () => {
    try {
      const next = await db.fetchAll();
      setData(next);
      setError(null);
    } catch (e) {
      setError(e.message || "Something went wrong talking to the database.");
    }
  };

  useEffect(() => {
    if (!supabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) refresh().then(() => setReady(true));
  }, [session]);

  const { people, pieces, roles, props, assignments, castPresets, savedShows, tracks } = data;

  const pieceById = useMemo(() => Object.fromEntries(pieces.map(p => [p.id, p])), [pieces]);
  const rolesByPiece = useMemo(() => {
    const m = {};
    roles.forEach(t => { (m[t.pieceId] = m[t.pieceId] || []).push(t); });
    return m;
  }, [roles]);
  const propsByPiece = useMemo(() => {
    const m = {};
    props.forEach(c => { (m[c.pieceId] = m[c.pieceId] || []).push(c); });
    return m;
  }, [props]);
  const assignmentsByRole = useMemo(() => {
    const m = {};
    assignments.forEach(a => { (m[a.roleId] = m[a.roleId] || []).push(a); });
    return m;
  }, [assignments]);
  const assignmentsByPerson = useMemo(() => {
    const m = {};
    assignments.forEach(a => { (m[a.personId] = m[a.personId] || []).push(a); });
    return m;
  }, [assignments]);
  const roleById = useMemo(() => Object.fromEntries(roles.map(t => [t.id, t])), [roles]);

  const personHasPieceConflict = (personId, pieceId, excludeRoleId) => {
    const theirAssignments = assignmentsByPerson[personId] || [];
    return theirAssignments.some(a => {
      if (a.roleId === excludeRoleId) return false;
      const t = roleById[a.roleId];
      return t && t.pieceId === pieceId;
    });
  };

  // Every mutation re-fetches; the data sets here are small and this keeps
  // cascade deletes (handled by the DB's ON DELETE CASCADE) trivially correct.
  const run = (fn) => async (...args) => {
    try {
      await fn(...args);
      await refresh();
    } catch (e) {
      setError(e.message || "Something went wrong talking to the database.");
    }
  };

  const actions = {
    addPerson: run(db.addPerson),
    deletePerson: run(db.deletePerson),
    addPiece: run(db.addPiece),
    deletePiece: run(db.deletePiece),
    updatePiece: run(db.updatePiece),
    updatePieceType: run(db.updatePieceType),
    updatePieceEnergy: run(db.updatePieceEnergy),
    updatePieceArchived: run(db.updatePieceArchived),
    addRole: run(db.addRole),
    deleteRole: run(db.deleteRole),
    updateRoleRequired: run(db.updateRoleRequired),
    updateRoleName: run(db.updateRoleName),
    updateRoleTrack: run(db.updateRoleTrack),
    addProp: run(db.addProp),
    deleteProp: run(db.deleteProp),
    addAssignment: run(db.addAssignment),
    deleteAssignment: run(db.deleteAssignment),
    addCastPreset: run(db.addCastPreset),
    deleteCastPreset: run(db.deleteCastPreset),
    addSavedShow: run(db.addSavedShow),
    deleteSavedShow: run(db.deleteSavedShow),
    updateSavedShowTracks: run(db.updateSavedShowTracks),
    addTrack: run(db.addTrack),
    deleteTrack: run(db.deleteTrack),
    updateTrackName: run(db.updateTrackName),
  };

  if (!supabaseConfigured) {
    return (
      <div className="cb-root cb-loading">
        <style>{CSS}</style>
        <div className="cb-setup">
          <h2>Almost there</h2>
          <p>This app needs a Supabase project to store data. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (locally in <code>.env.local</code>, or as environment variables in your Vercel project settings), then reload.</p>
        </div>
      </div>
    );
  }

  if (session === undefined) {
    return (
      <div className="cb-root cb-loading">
        <style>{CSS}</style>
        <div className="cb-loading-text">Checking your session…</div>
      </div>
    );
  }

  if (session === null) {
    return <LoginScreen />;
  }

  if (!ready) {
    return (
      <div className="cb-root cb-loading">
        <style>{CSS}</style>
        <div className="cb-loading-text">Loading the board…</div>
      </div>
    );
  }

  return (
    <div className="cb-root">
      <style>{CSS}</style>
      <header className="cb-header">
        <div className="cb-title-row">
          <div className="cb-title-block">
            <div className="cb-eyebrow">Backstage</div>
            <h1 className="cb-title">The Call Board</h1>
          </div>
          <button className="cb-signout" onClick={() => supabase.auth.signOut()}>
            <LogOut size={14} /> Sign out
          </button>
        </div>
        <nav className="cb-tabs">
          {TABS.map(t => (
            <button
              key={t.key}
              className={"cb-tab" + (tab === t.key ? " cb-tab-active" : "")}
              onClick={() => setTab(t.key)}
            >
              <t.icon size={15} strokeWidth={2} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      </header>

      {error && (
        <div className="cb-error-banner">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      <main className="cb-main">
        {tab === "builder" && (
          <BuildShowWizard
            people={people} pieces={pieces} rolesByPiece={rolesByPiece}
            assignmentsByRole={assignmentsByRole} propsByPiece={propsByPiece} tracks={tracks}
            castPresets={castPresets} onSavePreset={actions.addCastPreset} onDeletePreset={actions.deleteCastPreset}
            onSaveShow={actions.addSavedShow}
          />
        )}
        {tab === "people" && (
          <PeopleTab
            people={people} onAdd={actions.addPerson} onDelete={actions.deletePerson}
            assignmentsByPerson={assignmentsByPerson} roleById={roleById} pieceById={pieceById}
          />
        )}
        {tab === "pieces" && (
          <PiecesTab
            pieces={pieces} onAdd={actions.addPiece} onDelete={actions.deletePiece}
            onEdit={actions.updatePiece} onTypeChange={actions.updatePieceType}
            onEnergyChange={actions.updatePieceEnergy}
            onArchiveChange={actions.updatePieceArchived}
            rolesByPiece={rolesByPiece} propsByPiece={propsByPiece}
          />
        )}
        {tab === "roles" && (
          <RolesTab
            pieces={pieces} roles={roles} onAddRole={actions.addRole} onDeleteRole={actions.deleteRole}
            onToggleRequired={actions.updateRoleRequired} onRenameRole={actions.updateRoleName}
            tracks={tracks} onSetRoleTrack={actions.updateRoleTrack}
            people={people} onAssignPerson={actions.addAssignment} onRemoveAssignment={actions.deleteAssignment}
            assignmentsByRole={assignmentsByRole} personHasPieceConflict={personHasPieceConflict}
          />
        )}
        {tab === "props" && (
          <PropsTab
            pieces={pieces} props={props} onAdd={actions.addProp} onDelete={actions.deleteProp}
            propsByPiece={propsByPiece}
          />
        )}
        {tab === "tracks" && (
          <TracksTab
            tracks={tracks} roles={roles} pieces={pieces}
            onAdd={actions.addTrack} onDelete={actions.deleteTrack} onRename={actions.updateTrackName}
            onSetRoleTrack={actions.updateRoleTrack}
          />
        )}
        {tab === "savedshows" && (
          <SavedShowsTab
            people={people} pieces={pieces} rolesByPiece={rolesByPiece} assignmentsByRole={assignmentsByRole}
            savedShows={savedShows} onAdd={actions.addSavedShow} onDelete={actions.deleteSavedShow}
            tracks={tracks} onSetTracks={actions.updateSavedShowTracks}
          />
        )}
        {tab === "reports" && (
          <ReportsTab
            people={people} pieces={pieces} assignmentsByPerson={assignmentsByPerson} roleById={roleById}
            pieceById={pieceById} rolesByPiece={rolesByPiece} propsByPiece={propsByPiece}
            assignmentsByRole={assignmentsByRole}
          />
        )}
      </main>
    </div>
  );
}

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setErr(error.message);
  };

  return (
    <div className="cb-root cb-loading">
      <style>{CSS}</style>
      <form className="cb-login" onSubmit={submit}>
        <div className="cb-eyebrow">Backstage</div>
        <h1 className="cb-title cb-login-title">The Call Board</h1>
        <input className="cb-input" type="email" placeholder="Email" autoComplete="username"
          value={email} onChange={e => setEmail(e.target.value)} required />
        <input className="cb-input" type="password" placeholder="Password" autoComplete="current-password"
          value={password} onChange={e => setPassword(e.target.value)} required />
        <button className="cb-btn cb-btn-accent cb-login-btn" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        {err && <div className="cb-conflict"><AlertCircle size={14} /> {err}</div>}
      </form>
    </div>
  );
}

const TABS = [
  { key: "savedshows", label: "Saved Shows", icon: Bookmark },
  { key: "people", label: "People", icon: Users },
  { key: "pieces", label: "Pieces", icon: Music },
  { key: "roles", label: "Roles", icon: Route },
  { key: "tracks", label: "Tracks", icon: Layers },
  { key: "props", label: "Props", icon: Shirt },
  { key: "builder", label: "Build a show", icon: Wand2 },
  { key: "reports", label: "Reports", icon: ClipboardList },
];

/* ---------------- shared bits ---------------- */

function CueTag({ n, prefix }) {
  return <span className="cb-cue">{prefix}-{String(n).padStart(3, "0")}</span>;
}
function EmptyState({ text }) {
  return <div className="cb-empty">{text}</div>;
}
function ToggleSwitch({ label, checked, onChange }) {
  return (
    <label className="cb-toggle">
      <input type="checkbox" className="cb-toggle-input" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="cb-toggle-role"><span className="cb-toggle-thumb" /></span>
      <span className="cb-toggle-label">{label}</span>
    </label>
  );
}
function AddRow({ placeholder, onAdd, buttonLabel = "Add" }) {
  const [val, setVal] = useState("");
  const submit = () => {
    const v = val.trim();
    if (!v) return;
    onAdd(v);
    setVal("");
  };
  return (
    <div className="cb-addrow">
      <input className="cb-input" placeholder={placeholder} value={val}
        onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === "Enter") submit(); }} />
      <button className="cb-btn cb-btn-accent" onClick={submit}><Plus size={15} /> {buttonLabel}</button>
    </div>
  );
}

/* ---------------- People ---------------- */

function PeopleTab({ people, onAdd, onDelete, assignmentsByPerson, roleById, pieceById }) {
  return (
    <section>
      <div className="cb-section-head"><h2>People</h2><span className="cb-count">{people.length}</span></div>
      <AddRow placeholder="Performer name" onAdd={onAdd} buttonLabel="Add person" />
      {people.length === 0 && <EmptyState text="No one on the roster yet. Add your first performer above." />}
      <div className="cb-card-grid">
        {people.map((p, i) => {
          const theirs = assignmentsByPerson[p.id] || [];
          return (
            <div className="cb-card" key={p.id}>
              <div className="cb-card-top">
                <CueTag n={i + 1} prefix="P" />
                <button className="cb-icon-btn" onClick={() => onDelete(p.id)} title="Remove person"><Trash2 size={14} /></button>
              </div>
              <div className="cb-card-name">{p.name}</div>
              <div className="cb-card-sub">
                {theirs.length === 0 ? (
                  <span className="cb-dim">Not cast in anything yet</span>
                ) : (
                  <ul className="cb-taglist">
                    {theirs.map(a => {
                      const t = roleById[a.roleId];
                      const pc = t ? pieceById[t.pieceId] : null;
                      if (!t || !pc) return null;
                      return <li key={a.id}>{pc.name} <span className="cb-dim">— {t.name}</span></li>;
                    })}
                  </ul>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------- Pieces ---------------- */

const PIECE_TYPES = [
  { value: "normal", label: "Normal" },
  { value: "opener", label: "Opener" },
  { value: "closer", label: "Closer" },
];

const PIECE_ENERGIES = [
  { value: "High", label: "High" },
  { value: "Medium", label: "Medium" },
  { value: "Low", label: "Low" },
];

function PieceCard({ p, index, onDelete, onEdit, onTypeChange, onEnergyChange, onArchiveChange, rolesByPiece, propsByPiece }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p.name);
  const [min, setMin] = useState(String(Math.floor((p.length || 0) / 60)));
  const [sec, setSec] = useState(String((p.length || 0) % 60).padStart(2, "0"));

  const startEdit = () => {
    setName(p.name);
    setMin(String(Math.floor((p.length || 0) / 60)));
    setSec(String((p.length || 0) % 60).padStart(2, "0"));
    setEditing(true);
  };
  const save = () => {
    const n = name.trim();
    if (!n) return;
    const total = (parseInt(min || 0, 10) * 60) + parseInt(sec || 0, 10);
    onEdit(p.id, n, total);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="cb-card">
        <div className="cb-card-top">
          <CueTag n={index + 1} prefix="PC" />
          <div className="cb-card-edit-actions">
            <button className="cb-icon-btn" onClick={save} title="Save"><Check size={14} /></button>
            <button className="cb-icon-btn" onClick={() => setEditing(false)} title="Cancel"><X size={14} /></button>
          </div>
        </div>
        <input className="cb-input cb-edit-name" value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && save()} autoFocus />
        <div className="cb-addrow cb-edit-time">
          <input className="cb-input cb-input-num" type="number" min="0" value={min}
            onChange={e => setMin(e.target.value)} onKeyDown={e => e.key === "Enter" && save()} />
          <span className="cb-colon">:</span>
          <input className="cb-input cb-input-num" type="number" min="0" max="59" value={sec}
            onChange={e => setSec(e.target.value)} onKeyDown={e => e.key === "Enter" && save()} />
        </div>
      </div>
    );
  }

  return (
    <div className={"cb-card" + (p.archived ? " cb-card-archived" : "")}>
      <div className="cb-card-top">
        <CueTag n={index + 1} prefix="PC" />
        <div className="cb-card-edit-actions">
          <button className="cb-icon-btn" onClick={startEdit} title="Edit piece"><Pencil size={13} /></button>
          <button className="cb-icon-btn" onClick={() => onArchiveChange(p.id, !p.archived)} title={p.archived ? "Unarchive piece" : "Archive piece"}>
            {p.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          </button>
          <button className="cb-icon-btn" onClick={() => onDelete(p.id)} title="Remove piece"><Trash2 size={14} /></button>
        </div>
      </div>
      <div className="cb-card-name">{p.name}</div>
      <div className="cb-card-sub">
        <span className="cb-mono cb-accent-text">{fmtTime(p.length)}</span>
        <span className="cb-dim"> · {(rolesByPiece[p.id] || []).length} role{(rolesByPiece[p.id] || []).length === 1 ? "" : "s"}</span>
        <span className="cb-dim"> · {(propsByPiece[p.id] || []).length} prop{(propsByPiece[p.id] || []).length === 1 ? "" : "s"}</span>
      </div>
      <div className="cb-piece-selects">
        <select className="cb-select cb-type-select" value={p.type || "normal"} onChange={e => onTypeChange(p.id, e.target.value)}>
          {PIECE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select className="cb-select cb-type-select" value={p.energy || "Medium"} onChange={e => onEnergyChange(p.id, e.target.value)}>
          {PIECE_ENERGIES.map(t => <option key={t.value} value={t.value}>{t.label} energy</option>)}
        </select>
      </div>
    </div>
  );
}

function PiecesTab({ pieces, onAdd, onDelete, onEdit, onTypeChange, onEnergyChange, onArchiveChange, rolesByPiece, propsByPiece }) {
  const [name, setName] = useState("");
  const [min, setMin] = useState("");
  const [sec, setSec] = useState("");
  const [type, setType] = useState("normal");
  const [energy, setEnergy] = useState("Medium");
  const [archiveOpen, setArchiveOpen] = useState(false);

  const add = () => {
    const n = name.trim();
    if (!n) return;
    const total = (parseInt(min || 0, 10) * 60) + parseInt(sec || 0, 10);
    onAdd(n, total, type, energy);
    setName(""); setMin(""); setSec(""); setType("normal"); setEnergy("Medium");
  };

  const activePieces = pieces.filter(p => !p.archived);
  const archivedPieces = pieces.filter(p => p.archived);

  return (
    <section>
      <div className="cb-section-head"><h2>Pieces</h2><span className="cb-count">{pieces.length}</span></div>
      <div className="cb-addrow cb-addrow-piece">
        <input className="cb-input" placeholder="Piece name" value={name}
          onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} />
        <input className="cb-input cb-input-num" placeholder="min" type="number" min="0" value={min}
          onChange={e => setMin(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} />
        <span className="cb-colon">:</span>
        <input className="cb-input cb-input-num" placeholder="sec" type="number" min="0" max="59" value={sec}
          onChange={e => setSec(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} />
        <select className="cb-select" value={type} onChange={e => setType(e.target.value)}>
          {PIECE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select className="cb-select" value={energy} onChange={e => setEnergy(e.target.value)}>
          {PIECE_ENERGIES.map(t => <option key={t.value} value={t.value}>{t.label} energy</option>)}
        </select>
        <button className="cb-btn cb-btn-accent" onClick={add}><Plus size={15} /> Add piece</button>
      </div>
      {pieces.length === 0 && <EmptyState text="No pieces yet. Add one above with its run time." />}
      {activePieces.length === 0 && pieces.length > 0 && <EmptyState text="Every piece is archived — unarchive one below, or add a new one above." />}
      <div className="cb-card-grid">
        {activePieces.map((p, i) => (
          <PieceCard
            key={p.id} p={p} index={i} onDelete={onDelete} onEdit={onEdit} onTypeChange={onTypeChange}
            onEnergyChange={onEnergyChange} onArchiveChange={onArchiveChange} rolesByPiece={rolesByPiece} propsByPiece={propsByPiece}
          />
        ))}
      </div>

      {archivedPieces.length > 0 && (
        <div className="cb-archive-section">
          <button className="cb-linklike cb-archive-toggle" onClick={() => setArchiveOpen(o => !o)}>
            {archiveOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Archive ({archivedPieces.length})
          </button>
          {archiveOpen && (
            <div className="cb-card-grid cb-archive-grid">
              {archivedPieces.map((p, i) => (
                <PieceCard
                  key={p.id} p={p} index={i} onDelete={onDelete} onEdit={onEdit} onTypeChange={onTypeChange}
                  onEnergyChange={onEnergyChange} onArchiveChange={onArchiveChange} rolesByPiece={rolesByPiece} propsByPiece={propsByPiece}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* ---------------- Roles (+ assignments) ---------------- */

function RoleRow({ t, index, piece, asg, people, pickPerson, setPickPerson, assignPerson, onDeleteRole, onRemoveAssignment, onToggleRequired, onRenameRole, tracks, onSetRoleTrack }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(t.name);

  const startEdit = () => { setName(t.name); setEditing(true); };
  const save = () => {
    const n = name.trim();
    if (!n) return;
    onRenameRole(t.id, n);
    setEditing(false);
  };

  return (
    <div className="cb-role-row">
      <div className="cb-role-row-top">
        <span className="cb-mono cb-cue-inline">T-{String(index + 1).padStart(2, "0")}</span>
        {editing ? (
          <>
            <input className="cb-input cb-role-name-edit" value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && save()} autoFocus />
            <button className="cb-icon-btn" onClick={save} title="Save"><Check size={14} /></button>
            <button className="cb-icon-btn" onClick={() => setEditing(false)} title="Cancel"><X size={14} /></button>
          </>
        ) : (
          <>
            <span className="cb-role-name">{t.name}{t.required === false && <span className="cb-type-badge"> Optional</span>}</span>
            <button className="cb-icon-btn" onClick={startEdit} title="Rename role"><Pencil size={13} /></button>
            <button className="cb-icon-btn" onClick={() => onDeleteRole(t.id)} title="Remove role"><Trash2 size={14} /></button>
          </>
        )}
      </div>
      <div className="cb-role-people">
        {asg.map(a => {
          const person = people.find(pp => pp.id === a.personId);
          return (
            <span className="cb-chip" key={a.id}>
              {person ? person.name : "—"}
              <button className="cb-chip-x" onClick={() => onRemoveAssignment(a.id)}><X size={11} /></button>
            </span>
          );
        })}
        <select className="cb-select cb-select-inline" value={pickPerson[t.id] || ""}
          onChange={e => { assignPerson(t.id, piece.id, e.target.value); setPickPerson({ ...pickPerson, [t.id]: "" }); }}>
          <option value="">+ assign person…</option>
          {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <ToggleSwitch label="Optional" checked={t.required === false} onChange={checked => onToggleRequired(t.id, !checked)} />
      </div>
      <div className="cb-role-track-row">
        <span className="cb-report-label">Track group</span>
        <select className="cb-select cb-select-inline" value={t.trackId || ""} onChange={e => onSetRoleTrack(t.id, e.target.value || null)}>
          <option value="">— none —</option>
          {tracks.map(tr => <option key={tr.id} value={tr.id}>{tr.name}</option>)}
        </select>
      </div>
    </div>
  );
}

function PieceRolesGroup({ piece, theseRoles, expanded, onToggleExpand, newRoleName, setNewRoleName, newRoleOptional, setNewRoleOptional, addRole, onDeleteRole, onRemoveAssignment, onToggleRequired, onRenameRole, tracks, onSetRoleTrack, people, pickPerson, setPickPerson, assignPerson, assignmentsByRole }) {
  return (
    <div className={"cb-piece-group" + (piece.archived ? " cb-card-archived" : "")}>
      <button className="cb-piece-group-head cb-piece-group-toggle" onClick={onToggleExpand}>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        <span className="cb-piece-group-name">{piece.name}</span>
        <span className="cb-dim">{theseRoles.length} role{theseRoles.length === 1 ? "" : "s"}</span>
        <span className="cb-mono cb-dim">{fmtTime(piece.length)}</span>
      </button>
      {expanded && (
        <div className="cb-piece-group-body">
          <div className="cb-addrow">
            <input className="cb-input" placeholder="Role name (e.g. Lead, Ensemble A)"
              value={newRoleName[piece.id] || ""}
              onChange={e => setNewRoleName({ ...newRoleName, [piece.id]: e.target.value })}
              onKeyDown={e => { if (e.key === "Enter") addRole(piece.id); }} />
            <label className="cb-inline-checkbox">
              <input type="checkbox" checked={!!newRoleOptional[piece.id]}
                onChange={e => setNewRoleOptional({ ...newRoleOptional, [piece.id]: e.target.checked })} />
              Optional
            </label>
            <button className="cb-btn cb-btn-accent" onClick={() => addRole(piece.id)}><Plus size={15} /> Add role</button>
          </div>
          {theseRoles.length === 0 && <EmptyState text="No roles in this piece yet." />}
          {theseRoles.map((t, i) => (
            <RoleRow
              key={t.id} t={t} index={i} piece={piece} asg={assignmentsByRole[t.id] || []}
              people={people} pickPerson={pickPerson} setPickPerson={setPickPerson} assignPerson={assignPerson}
              onDeleteRole={onDeleteRole} onRemoveAssignment={onRemoveAssignment} onToggleRequired={onToggleRequired}
              onRenameRole={onRenameRole} tracks={tracks} onSetRoleTrack={onSetRoleTrack}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RolesTab({ pieces, roles, onAddRole, onDeleteRole, onToggleRequired, onRenameRole, tracks, onSetRoleTrack, people, onAssignPerson, onRemoveAssignment, assignmentsByRole, personHasPieceConflict }) {
  const [newRoleName, setNewRoleName] = useState({});
  const [newRoleOptional, setNewRoleOptional] = useState({});
  const [pickPerson, setPickPerson] = useState({});
  const [conflictMsg, setConflictMsg] = useState(null);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [archiveOpen, setArchiveOpen] = useState(false);

  const toggleExpand = (pieceId) => {
    const next = new Set(expandedIds);
    if (next.has(pieceId)) next.delete(pieceId); else next.add(pieceId);
    setExpandedIds(next);
  };

  const addRole = (pieceId) => {
    const nm = (newRoleName[pieceId] || "").trim();
    if (!nm) return;
    onAddRole(nm, pieceId, !newRoleOptional[pieceId]);
    setNewRoleName({ ...newRoleName, [pieceId]: "" });
    setNewRoleOptional({ ...newRoleOptional, [pieceId]: false });
  };

  const assignPerson = (roleId, pieceId, personId) => {
    if (!personId) return;
    if (personHasPieceConflict(personId, pieceId, roleId)) {
      const p = people.find(pp => pp.id === personId);
      setConflictMsg(`${p ? p.name : "That person"} is already on another role in this piece.`);
      setTimeout(() => setConflictMsg(null), 3500);
      return;
    }
    onAssignPerson(personId, roleId);
  };

  if (pieces.length === 0) {
    return <section><div className="cb-section-head"><h2>Roles</h2></div><EmptyState text="Add a piece first — roles belong to a piece." /></section>;
  }

  const activePieces = pieces.filter(p => !p.archived);
  const archivedPieces = pieces.filter(p => p.archived);

  const groupProps = {
    newRoleName, setNewRoleName, newRoleOptional, setNewRoleOptional,
    addRole, onDeleteRole, onRemoveAssignment, onToggleRequired, onRenameRole, tracks, onSetRoleTrack,
    people, pickPerson, setPickPerson, assignPerson, assignmentsByRole,
  };

  return (
    <section>
      <div className="cb-section-head"><h2>Roles</h2><span className="cb-count">{roles.length}</span></div>
      {conflictMsg && <div className="cb-conflict"><AlertCircle size={14} /> {conflictMsg}</div>}
      <div className="cb-piece-groups">
        {activePieces.map(piece => (
          <PieceRolesGroup
            key={piece.id} piece={piece} theseRoles={roles.filter(t => t.pieceId === piece.id)}
            expanded={expandedIds.has(piece.id)} onToggleExpand={() => toggleExpand(piece.id)}
            {...groupProps}
          />
        ))}
      </div>

      {archivedPieces.length > 0 && (
        <div className="cb-archive-section">
          <button className="cb-linklike cb-archive-toggle" onClick={() => setArchiveOpen(o => !o)}>
            {archiveOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Archived ({archivedPieces.length})
          </button>
          {archiveOpen && (
            <div className="cb-piece-groups cb-archive-grid">
              {archivedPieces.map(piece => (
                <PieceRolesGroup
                  key={piece.id} piece={piece} theseRoles={roles.filter(t => t.pieceId === piece.id)}
                  expanded={expandedIds.has(piece.id)} onToggleExpand={() => toggleExpand(piece.id)}
                  {...groupProps}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* ---------------- Props ---------------- */

function PiecePropsGroup({ piece, theseProps, expanded, onToggleExpand, newName, setNewName, addProp, onDelete }) {
  return (
    <div className={"cb-piece-group" + (piece.archived ? " cb-card-archived" : "")}>
      <button className="cb-piece-group-head cb-piece-group-toggle" onClick={onToggleExpand}>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        <span className="cb-piece-group-name">{piece.name}</span>
        <span className="cb-dim">{theseProps.length} prop{theseProps.length === 1 ? "" : "s"}</span>
      </button>
      {expanded && (
        <div className="cb-piece-group-body">
          <div className="cb-addrow">
            <input className="cb-input" placeholder="Prop (e.g. Red skirt, Top hat)"
              value={newName[piece.id] || ""}
              onChange={e => setNewName({ ...newName, [piece.id]: e.target.value })}
              onKeyDown={e => { if (e.key === "Enter") addProp(piece.id); }} />
            <button className="cb-btn cb-btn-accent" onClick={() => addProp(piece.id)}><Plus size={15} /> Add prop</button>
          </div>
          {theseProps.length === 0 ? (
            <EmptyState text="No props logged for this number yet." />
          ) : (
            <div className="cb-chiplist">
              {theseProps.map(c => (
                <span className="cb-chip" key={c.id}>{c.name}<button className="cb-chip-x" onClick={() => onDelete(c.id)}><X size={11} /></button></span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PropsTab({ pieces, props, onAdd, onDelete, propsByPiece }) {
  const [newName, setNewName] = useState({});
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [archiveOpen, setArchiveOpen] = useState(false);

  const toggleExpand = (pieceId) => {
    const next = new Set(expandedIds);
    if (next.has(pieceId)) next.delete(pieceId); else next.add(pieceId);
    setExpandedIds(next);
  };

  const addProp = (pieceId) => {
    const nm = (newName[pieceId] || "").trim();
    if (!nm) return;
    onAdd(nm, pieceId);
    setNewName({ ...newName, [pieceId]: "" });
  };

  if (pieces.length === 0) {
    return <section><div className="cb-section-head"><h2>Props</h2></div><EmptyState text="Add a piece first — props belong to a piece." /></section>;
  }

  const activePieces = pieces.filter(p => !p.archived);
  const archivedPieces = pieces.filter(p => p.archived);

  const groupProps = { newName, setNewName, addProp, onDelete };

  return (
    <section>
      <div className="cb-section-head"><h2>Props</h2><span className="cb-count">{props.length}</span></div>
      <div className="cb-piece-groups">
        {activePieces.map(piece => (
          <PiecePropsGroup
            key={piece.id} piece={piece} theseProps={propsByPiece[piece.id] || []}
            expanded={expandedIds.has(piece.id)} onToggleExpand={() => toggleExpand(piece.id)}
            {...groupProps}
          />
        ))}
      </div>

      {archivedPieces.length > 0 && (
        <div className="cb-archive-section">
          <button className="cb-linklike cb-archive-toggle" onClick={() => setArchiveOpen(o => !o)}>
            {archiveOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Archived ({archivedPieces.length})
          </button>
          {archiveOpen && (
            <div className="cb-piece-groups cb-archive-grid">
              {archivedPieces.map(piece => (
                <PiecePropsGroup
                  key={piece.id} piece={piece} theseProps={propsByPiece[piece.id] || []}
                  expanded={expandedIds.has(piece.id)} onToggleExpand={() => toggleExpand(piece.id)}
                  {...groupProps}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* ---------------- Reports ---------------- */

function ReportsTab({ people, pieces, assignmentsByPerson, roleById, pieceById, propsByPiece, rolesByPiece, assignmentsByRole }) {
  const [reportTab, setReportTab] = useState("coverage");
  return (
    <section>
      <div className="cb-section-head"><h2>Reports</h2></div>
      <div className="cb-subtabs">
        <button className={"cb-subtab" + (reportTab === "coverage" ? " cb-subtab-active" : "")} onClick={() => setReportTab("coverage")}>Cast coverage</button>
        <button className={"cb-subtab" + (reportTab === "prop" ? " cb-subtab-active" : "")} onClick={() => setReportTab("prop")}>Prop list</button>
        <button className={"cb-subtab" + (reportTab === "runtime" ? " cb-subtab-active" : "")} onClick={() => setReportTab("runtime")}>Run time</button>
        <button className={"cb-subtab" + (reportTab === "cast" ? " cb-subtab-active" : "")} onClick={() => setReportTab("cast")}>Who's in what</button>
      </div>
      {reportTab === "coverage" && <CastCoverageReport people={people} pieces={pieces} rolesByPiece={rolesByPiece} assignmentsByRole={assignmentsByRole} />}
      {reportTab === "cast" && <CastReport people={people} assignmentsByPerson={assignmentsByPerson} roleById={roleById} pieceById={pieceById} />}
      {reportTab === "runtime" && <RuntimeReport pieces={pieces} />}
      {reportTab === "prop" && <PropReport pieces={pieces} propsByPiece={propsByPiece} />}
    </section>
  );
}

function CastReport({ people, assignmentsByPerson, roleById, pieceById }) {
  if (people.length === 0) return <EmptyState text="Add people first to see who's cast where." />;
  return (
    <div className="cb-report">
      <p className="cb-report-lede">See what every performer is currently cast in — useful for spotting who's free.</p>
      <div className="cb-card-grid">
        {people.map(p => {
          const theirs = assignmentsByPerson[p.id] || [];
          return (
            <div className="cb-card" key={p.id}>
              <div className="cb-card-name">{p.name}</div>
              <div className="cb-card-sub">
                {theirs.length === 0 ? (
                  <span className="cb-dim">Available — not cast in anything</span>
                ) : (
                  <ul className="cb-taglist">
                    {theirs.map(a => {
                      const t = roleById[a.roleId];
                      const pc = t ? pieceById[t.pieceId] : null;
                      if (!t || !pc) return null;
                      return <li key={a.id}>{pc.name} <span className="cb-dim">— {t.name}</span></li>;
                    })}
                  </ul>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RuntimeReport({ pieces }) {
  const [selected, setSelected] = useState({});
  const [target, setTarget] = useState("");
  if (pieces.length === 0) return <EmptyState text="Add pieces with run times to build a set here." />;
  const total = pieces.reduce((sum, p) => sum + (selected[p.id] ? (p.length || 0) : 0), 0);
  const targetSeconds = target ? parseInt(target, 10) * 60 : null;
  const over = targetSeconds != null && total > targetSeconds;
  return (
    <div className="cb-report">
      <p className="cb-report-lede">Check off pieces to build a set and see if it fits your slot.</p>
      <div className="cb-runtime-target">
        <label>Target length (minutes)</label>
        <input className="cb-input cb-input-num" type="number" min="0" value={target} onChange={e => setTarget(e.target.value)} placeholder="e.g. 20" />
      </div>
      <div className="cb-runtime-list">
        {pieces.map(p => (
          <label className="cb-runtime-row" key={p.id}>
            <input type="checkbox" checked={!!selected[p.id]} onChange={e => setSelected({ ...selected, [p.id]: e.target.checked })} />
            <span className="cb-runtime-name">{p.name}</span>
            <span className="cb-mono cb-dim">{fmtTime(p.length)}</span>
          </label>
        ))}
      </div>
      <div className={"cb-runtime-total" + (over ? " cb-runtime-over" : "")}>
        <span>Total selected</span>
        <span className="cb-mono cb-accent-text">{fmtTime(total)}</span>
        {targetSeconds != null && (
          <span className="cb-dim">{over ? `— ${fmtTime(total - targetSeconds)} over target` : `— ${fmtTime(targetSeconds - total)} to spare`}</span>
        )}
      </div>
    </div>
  );
}

function PropReport({ pieces, propsByPiece }) {
  const [selected, setSelected] = useState({});
  if (pieces.length === 0) return <EmptyState text="Add pieces and props first." />;
  const chosen = pieces.filter(p => selected[p.id]);
  return (
    <div className="cb-report">
      <p className="cb-report-lede">Pick the pieces in your lineup to pull the full prop list.</p>
      <div className="cb-runtime-list">
        {pieces.map(p => (
          <label className="cb-runtime-row" key={p.id}>
            <input type="checkbox" checked={!!selected[p.id]} onChange={e => setSelected({ ...selected, [p.id]: e.target.checked })} />
            <span className="cb-runtime-name">{p.name}</span>
            <span className="cb-dim">{(propsByPiece[p.id] || []).length} item{(propsByPiece[p.id] || []).length === 1 ? "" : "s"}</span>
          </label>
        ))}
      </div>
      {chosen.length > 0 && (
        <div className="cb-piece-groups">
          {chosen.map(p => {
            const items = propsByPiece[p.id] || [];
            return (
              <div className="cb-piece-group" key={p.id}>
                <div className="cb-piece-group-head"><span className="cb-piece-group-name">{p.name}</span></div>
                {items.length === 0 ? (
                  <EmptyState text="No props logged for this number." />
                ) : (
                  <div className="cb-chiplist">{items.map(c => <span className="cb-chip cb-chip-static" key={c.id}>{c.name}</span>)}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PeoplePicker({ people, selected, setSelected }) {
  const allOn = people.length > 0 && people.every(p => selected[p.id]);
  const toggleAll = () => setSelected(allOn ? {} : Object.fromEntries(people.map(p => [p.id, true])));
  return (
    <div className="cb-picker">
      <div className="cb-picker-head">
        <span className="cb-report-label">Available cast</span>
        <button className="cb-linklike" onClick={toggleAll}>{allOn ? "Clear all" : "Select all"}</button>
      </div>
      <div className="cb-picker-grid">
        {people.map(p => (
          <label className="cb-picker-chip" key={p.id}>
            <input type="checkbox" checked={!!selected[p.id]} onChange={e => setSelected({ ...selected, [p.id]: e.target.checked })} />
            {p.name}
          </label>
        ))}
      </div>
    </div>
  );
}

function CastCoverageReport({ people, pieces, rolesByPiece, assignmentsByRole }) {
  const [selected, setSelected] = useState({});
  if (people.length === 0) return <EmptyState text="Add people first, then pick who's available to see what you can perform." />;
  if (pieces.length === 0) return <EmptyState text="Add pieces and roles first." />;
  const availableIds = new Set(Object.keys(selected).filter(id => selected[id]));
  const coverage = computeCoverage(pieces, rolesByPiece, assignmentsByRole, availableIds);
  const doable = coverage.filter(c => c.status === "doable");
  const missing = coverage.filter(c => c.status === "missing");
  const noRoles = coverage.filter(c => c.status === "no-roles");
  const anySelected = availableIds.size > 0;
  return (
    <div className="cb-report">
      <p className="cb-report-lede">Check off who's actually available and see which pieces are fully covered.</p>
      <PeoplePicker people={people} selected={selected} setSelected={setSelected} />
      {!anySelected ? (
        <EmptyState text="Select at least one available person to see coverage." />
      ) : (
        <>
          <div className="cb-coverage-block">
            <div className="cb-coverage-head cb-coverage-good"><CheckCircle2 size={15} /> Doable with this cast ({doable.length})</div>
            {doable.length === 0 ? (
              <EmptyState text="No piece is fully covered by the selected people yet." />
            ) : (
              <div className="cb-card-grid">
                {doable.map(c => (
                  <div className="cb-card" key={c.piece.id}>
                    <div className="cb-card-name">{c.piece.name}</div>
                    <div className="cb-card-sub cb-mono cb-accent-text">{fmtTime(c.piece.length)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {missing.length > 0 && (
            <div className="cb-coverage-block">
              <div className="cb-coverage-head cb-coverage-bad"><CircleDashed size={15} /> Not covered yet ({missing.length})</div>
              <div className="cb-card-grid">
                {missing.map(c => (
                  <div className="cb-card" key={c.piece.id}>
                    <div className="cb-card-name">{c.piece.name}</div>
                    <div className="cb-card-sub"><span className="cb-dim">Missing: </span>{c.missing.map(t => t.name).join(", ")}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {noRoles.length > 0 && (
            <div className="cb-coverage-block">
              <div className="cb-coverage-head"><span className="cb-dim">No roles defined yet ({noRoles.length})</span></div>
              <div className="cb-card-grid">
                {noRoles.map(c => (
                  <div className="cb-card" key={c.piece.id}>
                    <div className="cb-card-name">{c.piece.name}</div>
                    <div className="cb-card-sub cb-dim">Add roles to this piece to check coverage</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------- Build a Show (wizard) ---------------- */

function parseMinutes(str) {
  const s = (str || "").trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = parseInt(s, 10);
  return n > 0 ? n * 60 : null;
}

// Openers/closers are fixed to the first/last slot; the remaining budget is
// filled with Normal-type pieces via the same subset-sum search used elsewhere.
function buildRunningOrders(pieces, rolesByPiece, assignmentsByRole, castIds, targetSeconds, noOpener, noCloser, includeOptional, maxResults = 10) {
  const coverage = computeCoverage(pieces, rolesByPiece, assignmentsByRole, castIds, includeOptional);
  const doable = coverage.filter(c => c.status === "doable").map(c => c.piece);
  const missing = coverage.filter(c => c.status === "missing").map(c => c.piece);

  const openers = doable.filter(p => p.type === "opener");
  const closers = doable.filter(p => p.type === "closer");
  const normals = doable.filter(p => (p.type || "normal") === "normal");

  const openerOptions = noOpener ? [null] : openers;
  const closerOptions = noCloser ? [null] : closers;

  if (!noOpener && openers.length === 0) {
    return { doable, missing, options: [], blocked: "opener" };
  }
  if (!noCloser && closers.length === 0) {
    return { doable, missing, options: [], blocked: "closer" };
  }

  const seen = new Set();
  const results = [];
  openerOptions.forEach(opener => {
    closerOptions.forEach(closer => {
      const used = (opener?.length || 0) + (closer?.length || 0);
      const remaining = targetSeconds - used;
      if (remaining < 0) return;
      const combos = generateShowOptions(normals, remaining, 8);
      const base = combos.length > 0 ? combos : [{ pieces: [], total: 0 }];
      base.forEach(combo => {
        const orderedPieces = [opener, ...combo.pieces, closer].filter(Boolean);
        if (orderedPieces.length === 0) return;
        const key = orderedPieces.map(p => p.id).join(">");
        if (seen.has(key)) return;
        seen.add(key);
        results.push({ pieces: orderedPieces, total: used + combo.total, opener, closer });
      });
    });
  });

  results.sort((a, b) => b.total - a.total);
  return { doable, missing, options: results.slice(0, maxResults), blocked: null };
}

const ENERGY_COLORS = { High: "FFF4A9A0", Medium: "FFFDE9B0", Low: "FFC8E6C9" };
const NAMED_TRACK_COLORS = {
  red: "FFF4A9A0", orange: "FFFBD1A2", yellow: "FFFCEBA0", green: "FFB7E1B0",
  blue: "FFAFD4EE", purple: "FFD3C6EA", pink: "FFF6C7DE",
};

function trackHeaderColor(name) {
  return NAMED_TRACK_COLORS[(name || "").trim().toLowerCase()] || "FF808080";
}

async function downloadXlsxBuffer(filename, workbook) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Builds the "cast tracks" style show sheet: rows are pieces in running
// order, columns are Tracks, each cell shows the Role that Track's
// performer plays in that piece. castIds filters which assignments count
// as "in this show" — pass an empty Set to show every assignment.
async function exportShowXlsx(filenameBase, pieces, rolesByPiece, assignmentsByRole, allTracks, people, castIds) {
  const personById = Object.fromEntries(people.map(p => [p.id, p]));
  const filterByCast = castIds && castIds.size > 0;

  const usedTrackIds = new Set();
  pieces.forEach(p => {
    (rolesByPiece[p.id] || []).forEach(r => { if (r.trackId) usedTrackIds.add(r.trackId); });
  });
  const tracksUsed = allTracks.filter(t => usedTrackIds.has(t.id));

  const trackPeopleNames = tracksUsed.map(t => {
    const names = new Set();
    pieces.forEach(p => {
      (rolesByPiece[p.id] || []).filter(r => r.trackId === t.id).forEach(r => {
        let asg = assignmentsByRole[r.id] || [];
        if (filterByCast) asg = asg.filter(a => castIds.has(a.personId));
        asg.forEach(a => { const person = personById[a.personId]; if (person) names.add(person.name); });
      });
    });
    return Array.from(names).join(" / ");
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Running Order");

  const leadCols = ["#", "Energy", "Piece", "Start", "Length"];
  const headerRow = sheet.addRow([...leadCols, ...tracksUsed.map(t => t.name)]);
  headerRow.eachCell((cell, colNumber) => {
    cell.font = { bold: true, color: { argb: colNumber > leadCols.length ? "FFFFFFFF" : "FF17151A" } };
    if (colNumber > leadCols.length) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: trackHeaderColor(tracksUsed[colNumber - leadCols.length - 1].name) } };
    } else {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E5E5" } };
    }
  });

  const subHeaderRow = sheet.addRow([...leadCols.map(() => ""), ...trackPeopleNames]);
  subHeaderRow.eachCell(cell => { cell.font = { italic: true, size: 10 }; });

  let elapsed = 0;
  pieces.forEach((p, i) => {
    const rowValues = [i + 1, "", p.name, fmtTime(elapsed), fmtTime(p.length)];
    tracksUsed.forEach(t => {
      const rolesHere = (rolesByPiece[p.id] || []).filter(r => r.trackId === t.id);
      rowValues.push(rolesHere.map(r => r.name).join(" / "));
    });
    const row = sheet.addRow(rowValues);
    row.getCell(3).font = { bold: true };
    const energyColor = ENERGY_COLORS[p.energy];
    if (energyColor) {
      row.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: energyColor } };
    }
    elapsed += (p.length || 0);
  });

  sheet.columns = [
    { width: 4 }, { width: 8 }, { width: 30 }, { width: 9 }, { width: 9 },
    ...tracksUsed.map(() => ({ width: 18 })),
  ];
  sheet.views = [{ state: "frozen", ySplit: 2 }];

  await downloadXlsxBuffer(`${filenameBase}.xlsx`, workbook);
}

const TYPE_BADGE_LABEL = { opener: "Opener", closer: "Closer" };

function RunningOrderCard({ option, index, rolesByPiece, assignmentsByRole, propsByPiece, tracks, people, castIds, onSaveShow }) {
  const [showProps, setShowProps] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showName, setShowName] = useState("");
  const [saved, setSaved] = useState(false);
  const [exporting, setExporting] = useState(false);
  const propMap = {};
  option.pieces.forEach(p => { propMap[p.id] = propsByPiece[p.id] || []; });
  const totalProps = Object.values(propMap).reduce((s, arr) => s + arr.length, 0);

  const confirmSave = () => {
    const n = showName.trim();
    if (!n) return;
    onSaveShow(n, option.pieces.map(p => p.id));
    setSaving(false);
    setShowName("");
    setSaved(true);
  };

  const doExport = async () => {
    setExporting(true);
    try {
      await exportShowXlsx(`running-order-${fmtTime(option.total).replace(":", "m")}s`, option.pieces, rolesByPiece, assignmentsByRole, tracks, people, castIds);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="cb-card cb-show-option">
      <div className="cb-card-top">
        <CueTag n={index + 1} prefix="SHOW" />
        <span className="cb-mono cb-accent-text">{fmtTime(option.total)}</span>
      </div>
      <ul className="cb-taglist cb-show-piece-list">
        {option.pieces.map(p => (
          <li key={p.id}>
            <span>{p.name}{TYPE_BADGE_LABEL[p.type] && <span className="cb-type-badge"> {TYPE_BADGE_LABEL[p.type]}</span>}</span>
            <span className="cb-dim cb-mono">{fmtTime(p.length)}</span>
          </li>
        ))}
      </ul>
      <button className="cb-linklike cb-show-prop-toggle" onClick={() => setShowProps(s => !s)}>
        {showProps ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        Prop list ({totalProps} item{totalProps === 1 ? "" : "s"})
      </button>
      {showProps && (
        <div className="cb-show-props">
          {option.pieces.map(p => {
            const items = propMap[p.id];
            if (items.length === 0) return null;
            return <div key={p.id} className="cb-show-prop-group"><span className="cb-dim">{p.name}:</span> {items.map(c => c.name).join(", ")}</div>;
          })}
          {totalProps === 0 && <span className="cb-dim">No props logged for this lineup.</span>}
        </div>
      )}
      <button className="cb-btn cb-export-btn" onClick={doExport} disabled={exporting}>
        <Download size={14} /> {exporting ? "Exporting…" : "Export Excel"}
      </button>
      {saving ? (
        <div className="cb-save-show-row">
          <input className="cb-input" placeholder="Show name" value={showName}
            onChange={e => setShowName(e.target.value)} onKeyDown={e => e.key === "Enter" && confirmSave()} autoFocus />
          <button className="cb-icon-btn" onClick={confirmSave} title="Confirm"><Check size={14} /></button>
          <button className="cb-icon-btn" onClick={() => setSaving(false)} title="Cancel"><X size={14} /></button>
        </div>
      ) : (
        <button className="cb-btn cb-export-btn" onClick={() => setSaving(true)}>
          <Save size={14} /> {saved ? "Saved — save again?" : "Save show"}
        </button>
      )}
    </div>
  );
}

function CastDropdownPicker({ people, castIds, onAdd, onRemove }) {
  const available = people.filter(p => !castIds.has(p.id));
  const cast = people.filter(p => castIds.has(p.id));
  return (
    <div>
      <div className="cb-addrow">
        <select className="cb-input cb-select-full" value="" onChange={e => e.target.value && onAdd(e.target.value)}>
          <option value="">Add a performer…</option>
          {available.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      {cast.length === 0 ? (
        <EmptyState text="No one added yet — pick people from the dropdown above." />
      ) : (
        <div className="cb-chiplist">
          {cast.map(p => (
            <span className="cb-chip" key={p.id}>{p.name}<button className="cb-chip-x" onClick={() => onRemove(p.id)}><X size={11} /></button></span>
          ))}
        </div>
      )}
    </div>
  );
}

function CastPresetPanel({ people, castIds, presets, onSave, onDelete, onLoad }) {
  const [saving, setSaving] = useState(false);
  const [presetName, setPresetName] = useState("");

  const confirmSave = () => {
    const n = presetName.trim();
    if (!n) return;
    onSave(n, Array.from(castIds));
    setSaving(false);
    setPresetName("");
  };

  return (
    <div className="cb-preset-panel">
      {saving ? (
        <div className="cb-save-show-row">
          <input className="cb-input" placeholder="Preset name" value={presetName}
            onChange={e => setPresetName(e.target.value)} onKeyDown={e => e.key === "Enter" && confirmSave()} autoFocus />
          <button className="cb-icon-btn" onClick={confirmSave} title="Confirm"><Check size={14} /></button>
          <button className="cb-icon-btn" onClick={() => setSaving(false)} title="Cancel"><X size={14} /></button>
        </div>
      ) : (
        <button className="cb-linklike" disabled={castIds.size === 0} onClick={() => setSaving(true)}>
          <Save size={13} /> Save this cast as a preset
        </button>
      )}
      {presets.length > 0 && (
        <div className="cb-preset-list">
          <span className="cb-report-label">Saved casts</span>
          <div className="cb-chiplist">
            {presets.map(preset => (
              <span className="cb-chip cb-preset-chip" key={preset.id}>
                <button className="cb-preset-load" onClick={() => onLoad(preset)}>{preset.name}</button>
                <button className="cb-chip-x" onClick={() => onDelete(preset.id)}><X size={11} /></button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BuildShowWizard({ people, pieces, rolesByPiece, assignmentsByRole, propsByPiece, tracks, castPresets, onSavePreset, onDeletePreset, onSaveShow }) {
  const [step, setStep] = useState(1);
  const [castIds, setCastIds] = useState(new Set());
  const [runtimeInput, setRuntimeInput] = useState("");
  const [runtimeError, setRuntimeError] = useState(null);
  const [openerOn, setOpenerOn] = useState(true);
  const [closerOn, setCloserOn] = useState(true);
  const [optionalOn, setOptionalOn] = useState(true);

  if (people.length === 0) return <EmptyState text="Add people first (People tab) before building a show." />;
  if (pieces.length === 0) return <EmptyState text="Add pieces first (Pieces tab) before building a show." />;

  const activePieces = pieces.filter(p => !p.archived);

  const addToCast = (id) => setCastIds(new Set([...castIds, id]));
  const removeFromCast = (id) => { const next = new Set(castIds); next.delete(id); setCastIds(next); };
  const loadPreset = (preset) => {
    const validIds = new Set(people.map(p => p.id));
    setCastIds(new Set(preset.personIds.filter(id => validIds.has(id))));
  };

  const targetSeconds = parseMinutes(runtimeInput);

  const goToStep2 = () => setStep(2);
  const goToStep3 = () => {
    const secs = parseMinutes(runtimeInput);
    if (secs == null) { setRuntimeError("Enter runtime in minutes, e.g. 20"); return; }
    setRuntimeError(null);
    setStep(3);
  };
  const startOver = () => {
    setStep(1); setCastIds(new Set()); setRuntimeInput(""); setRuntimeError(null);
    setOpenerOn(true); setCloserOn(true); setOptionalOn(true);
  };

  const built = step === 3
    ? buildRunningOrders(activePieces, rolesByPiece, assignmentsByRole, castIds, targetSeconds, !openerOn, !closerOn, optionalOn, 10)
    : null;

  return (
    <section>
      <div className="cb-section-head"><h2>Build a show</h2></div>
      <div className="cb-wizard-steps">
        <span className={"cb-wizard-step" + (step === 1 ? " cb-wizard-step-active" : "")}>1. Cast</span>
        <span className={"cb-wizard-step" + (step === 2 ? " cb-wizard-step-active" : "")}>2. Runtime</span>
        <span className={"cb-wizard-step" + (step === 3 ? " cb-wizard-step-active" : "")}>3. Running orders</span>
      </div>

      {step === 1 && (
        <div className="cb-report">
          <p className="cb-report-lede">Add everyone who's available for this show.</p>
          <CastDropdownPicker people={people} castIds={castIds} onAdd={addToCast} onRemove={removeFromCast} />
          <CastPresetPanel
            people={people} castIds={castIds} presets={castPresets}
            onSave={onSavePreset} onDelete={onDeletePreset} onLoad={loadPreset}
          />
          <button className="cb-btn cb-btn-accent cb-build-btn" disabled={castIds.size === 0} onClick={goToStep2}>
            Next
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="cb-report">
          <p className="cb-report-lede">How many minutes do you have for sketches?</p>
          <div className="cb-runtime-target">
            <label>Runtime (minutes)</label>
            <input
              className="cb-input cb-input-num"
              placeholder="20"
              value={runtimeInput}
              onChange={e => setRuntimeInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && goToStep3()}
            />
          </div>
          {runtimeError && <div className="cb-conflict"><AlertCircle size={14} /> {runtimeError}</div>}
          <div className="cb-wizard-nav">
            <button className="cb-btn" onClick={() => setStep(1)}>Back</button>
            <button className="cb-btn cb-btn-accent" onClick={goToStep3}>Next</button>
          </div>
        </div>
      )}

      {step === 3 && built && (
        <div className="cb-report">
          <p className="cb-report-lede">
            {(people.filter(p => castIds.has(p.id)).length)} available, {fmtTime(targetSeconds)} to fill.
          </p>
          <div className="cb-toggle-row">
            <ToggleSwitch label="Opener" checked={openerOn} onChange={setOpenerOn} />
            <ToggleSwitch label="Closer" checked={closerOn} onChange={setCloserOn} />
            <ToggleSwitch label="Include Optional Roles" checked={optionalOn} onChange={setOptionalOn} />
          </div>

          {built.blocked === "opener" && (
            <EmptyState text="No opener is doable with this cast. Turn the Opener toggle off to build a running order without one, cast more people, or add an Opener-type piece." />
          )}
          {built.blocked === "closer" && (
            <EmptyState text="No closer is doable with this cast. Turn the Closer toggle off to build a running order without one, cast more people, or add a Closer-type piece." />
          )}
          {!built.blocked && built.options.length === 0 && (
            <EmptyState text="No running order fits — try more time, a different cast, or the Opener/Closer toggles." />
          )}
          {!built.blocked && built.options.length > 0 && (
            <>
              <div className="cb-coverage-head">Found {built.options.length} possible running order{built.options.length === 1 ? "" : "s"}, best time-use first</div>
              <div className="cb-card-grid cb-show-grid">
                {built.options.map((opt, i) => (
                  <RunningOrderCard
                    key={i} option={opt} index={i}
                    rolesByPiece={rolesByPiece} assignmentsByRole={assignmentsByRole}
                    propsByPiece={propsByPiece} tracks={tracks} people={people} castIds={castIds}
                    onSaveShow={onSaveShow}
                  />
                ))}
              </div>
            </>
          )}
          {built.missing.length > 0 && (
            <div className="cb-coverage-block">
              <div className="cb-coverage-head"><span className="cb-dim">Left out — not covered by this cast ({built.missing.length})</span></div>
              <div className="cb-chiplist">{built.missing.map(p => <span className="cb-chip cb-chip-static" key={p.id}>{p.name}</span>)}</div>
            </div>
          )}

          <div className="cb-wizard-nav">
            <button className="cb-btn" onClick={() => setStep(2)}>Back</button>
            <button className="cb-btn" onClick={startOver}>Start over</button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------------- Tracks (role-grouping entity) ---------------- */

function TrackCard({ track, rolesInTrack, pieceById, onDelete, onRename, roleOptions, onAddRole, onRemoveRole }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(track.name);

  const startEdit = () => { setName(track.name); setEditing(true); };
  const save = () => {
    const n = name.trim();
    if (!n) return;
    onRename(track.id, n);
    setEditing(false);
  };

  return (
    <div className="cb-card">
      <div className="cb-card-top">
        {editing ? (
          <>
            <input className="cb-input cb-edit-name" value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && save()} autoFocus />
            <div className="cb-card-edit-actions">
              <button className="cb-icon-btn" onClick={save} title="Save"><Check size={14} /></button>
              <button className="cb-icon-btn" onClick={() => setEditing(false)} title="Cancel"><X size={14} /></button>
            </div>
          </>
        ) : (
          <>
            <span className="cb-card-name">{track.name}</span>
            <div className="cb-card-edit-actions">
              <button className="cb-icon-btn" onClick={startEdit} title="Rename track"><Pencil size={13} /></button>
              <button className="cb-icon-btn" onClick={() => onDelete(track.id)} title="Delete track"><Trash2 size={14} /></button>
            </div>
          </>
        )}
      </div>
      {rolesInTrack.length === 0 ? (
        <EmptyState text="No roles grouped into this track yet." />
      ) : (
        <ul className="cb-taglist">
          {rolesInTrack.map(r => {
            const piece = pieceById[r.pieceId];
            return (
              <li key={r.id} className="cb-order-item">
                <span>{r.name} <span className="cb-dim">— {piece ? piece.name : "?"}</span></span>
                <button className="cb-chip-x" onClick={() => onRemoveRole(r.id)}><X size={11} /></button>
              </li>
            );
          })}
        </ul>
      )}
      <select className="cb-input cb-select-full cb-track-add-role" value=""
        onChange={e => e.target.value && onAddRole(e.target.value)}>
        <option value="">+ add a role to this track…</option>
        {roleOptions.map(r => {
          const piece = pieceById[r.pieceId];
          return <option key={r.id} value={r.id}>{r.name} — {piece ? piece.name : "?"}</option>;
        })}
      </select>
    </div>
  );
}

function TracksTab({ tracks, roles, pieces, onAdd, onDelete, onRename, onSetRoleTrack }) {
  const [newName, setNewName] = useState("");

  const pieceById = Object.fromEntries(pieces.map(p => [p.id, p]));

  const add = () => {
    const n = newName.trim();
    if (!n) return;
    onAdd(n);
    setNewName("");
  };

  return (
    <section>
      <div className="cb-section-head"><h2>Tracks</h2><span className="cb-count">{tracks.length}</span></div>
      <p className="cb-report-lede">Group roles together — e.g. roles meant for the same performer across different pieces.</p>
      <AddRow placeholder="Track name" onAdd={n => onAdd(n)} buttonLabel="Add track" />
      {tracks.length === 0 ? (
        <EmptyState text="No tracks yet. Add one above, then group roles into it." />
      ) : (
        <div className="cb-card-grid">
          {tracks.map(track => {
            const rolesInTrack = roles.filter(r => r.trackId === track.id);
            const roleOptions = roles.filter(r => r.trackId !== track.id);
            return (
              <TrackCard
                key={track.id} track={track} rolesInTrack={rolesInTrack} pieceById={pieceById}
                onDelete={onDelete} onRename={onRename} roleOptions={roleOptions}
                onAddRole={(roleId) => onSetRoleTrack(roleId, track.id)}
                onRemoveRole={(roleId) => onSetRoleTrack(roleId, null)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ---------------- Saved Shows ---------------- */

function PieceDropdownPicker({ pieces, orderedIds, onAdd, onRemove, pieceById }) {
  const available = pieces.filter(p => !orderedIds.includes(p.id));
  return (
    <div>
      <div className="cb-addrow">
        <select className="cb-input cb-select-full" value="" onChange={e => e.target.value && onAdd(e.target.value)}>
          <option value="">Add a piece…</option>
          {available.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      {orderedIds.length === 0 ? (
        <EmptyState text="No pieces added yet — pick from the dropdown above, in the order you want them performed." />
      ) : (
        <ul className="cb-taglist cb-show-piece-list">
          {orderedIds.map((id, i) => {
            const p = pieceById[id];
            if (!p) return null;
            return (
              <li key={id} className="cb-order-item">
                <span>{i + 1}. {p.name}</span>
                <span className="cb-order-item-right">
                  <span className="cb-dim cb-mono">{fmtTime(p.length)}</span>
                  <button className="cb-chip-x" onClick={() => onRemove(id)}><X size={11} /></button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SavedShowCard({ show, pieceById, rolesByPiece, assignmentsByRole, potentialCastIds, includeOptional, onDelete, tracks, onSetTracks, people }) {
  const [expanded, setExpanded] = useState(false);
  const [exporting, setExporting] = useState(false);
  const showPieces = show.pieceIds.map(id => pieceById[id]).filter(Boolean);
  const total = showPieces.reduce((s, p) => s + (p.length || 0), 0);
  const linkedTracks = (show.trackIds || []).map(id => tracks.find(t => t.id === id)).filter(Boolean);
  const availableTracks = tracks.filter(t => !(show.trackIds || []).includes(t.id));

  const addTrack = (trackId) => onSetTracks(show.id, [...(show.trackIds || []), trackId]);
  const removeTrack = (trackId) => onSetTracks(show.id, (show.trackIds || []).filter(id => id !== trackId));

  const doExport = async () => {
    setExporting(true);
    try {
      await exportShowXlsx(show.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "saved-show", showPieces, rolesByPiece, assignmentsByRole, tracks, people, potentialCastIds);
    } finally {
      setExporting(false);
    }
  };

  const coverage = potentialCastIds.size > 0
    ? computeCoverage(showPieces, rolesByPiece, assignmentsByRole, potentialCastIds, includeOptional)
    : null;
  const coverageByPieceId = {};
  if (coverage) coverage.forEach(c => { coverageByPieceId[c.piece.id] = c; });
  const missingCount = coverage ? coverage.filter(c => c.status !== "doable").length : 0;

  return (
    <div className="cb-card cb-show-option">
      <div className="cb-card-top">
        <button className="cb-linklike cb-saved-show-title" onClick={() => setExpanded(e => !e)}>
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          <span className="cb-card-name">{show.name}</span>
        </button>
        <button className="cb-icon-btn" onClick={() => onDelete(show.id)} title="Delete show"><Trash2 size={14} /></button>
      </div>
      <div className="cb-card-sub">
        <span className="cb-mono cb-accent-text">{fmtTime(total)}</span>
        <span className="cb-dim"> · {showPieces.length} piece{showPieces.length === 1 ? "" : "s"}</span>
        {coverage && (
          missingCount === 0
            ? <span className="cb-coverage-good"> · Fully covered</span>
            : <span className="cb-coverage-bad"> · Missing {missingCount}</span>
        )}
      </div>
      {linkedTracks.length > 0 && (
        <div className="cb-chiplist cb-saved-show-tracks">
          {linkedTracks.map(t => (
            <span className="cb-chip" key={t.id}>{t.name}<button className="cb-chip-x" onClick={() => removeTrack(t.id)}><X size={11} /></button></span>
          ))}
        </div>
      )}
      {availableTracks.length > 0 && (
        <select className="cb-select cb-select-full cb-saved-show-track-add" value=""
          onChange={e => e.target.value && addTrack(e.target.value)}>
          <option value="">+ link a track…</option>
          {availableTracks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}
      <button className="cb-btn cb-export-btn" onClick={doExport} disabled={exporting}>
        <Download size={14} /> {exporting ? "Exporting…" : "Export Excel"}
      </button>
      {expanded && (
        <ul className="cb-taglist cb-show-piece-list cb-saved-show-list">
          {showPieces.map(p => {
            const c = coverageByPieceId[p.id];
            const notCovered = c && c.status !== "doable";
            return (
              <li key={p.id} className={notCovered ? "cb-piece-not-covered" : ""}>
                <span>
                  {p.name}{TYPE_BADGE_LABEL[p.type] && <span className="cb-type-badge"> {TYPE_BADGE_LABEL[p.type]}</span>}
                  {notCovered && c.missing.length > 0 && (
                    <span className="cb-not-covered-detail"> — missing: {c.missing.map(t => t.name).join(", ")}</span>
                  )}
                </span>
                <span className="cb-dim cb-mono">{fmtTime(p.length)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SavedShowsTab({ people, pieces, rolesByPiece, assignmentsByRole, savedShows, onAdd, onDelete, tracks, onSetTracks }) {
  const [orderedIds, setOrderedIds] = useState([]);
  const [showName, setShowName] = useState("");
  const [potentialCastIds, setPotentialCastIds] = useState(new Set());
  const [includeOptional, setIncludeOptional] = useState(true);

  const pieceById = Object.fromEntries(pieces.map(p => [p.id, p]));

  const addPieceToOrder = (id) => setOrderedIds([...orderedIds, id]);
  const removePieceFromOrder = (id) => setOrderedIds(orderedIds.filter(x => x !== id));
  const addToCast = (id) => setPotentialCastIds(new Set([...potentialCastIds, id]));
  const removeFromCast = (id) => { const next = new Set(potentialCastIds); next.delete(id); setPotentialCastIds(next); };

  const saveShow = () => {
    const n = showName.trim();
    if (!n || orderedIds.length === 0) return;
    onAdd(n, orderedIds);
    setShowName("");
    setOrderedIds([]);
  };

  if (pieces.length === 0) return <EmptyState text="Add pieces first (Pieces tab) before saving a show." />;

  return (
    <section>
      <div className="cb-section-head"><h2>Saved Shows</h2><span className="cb-count">{savedShows.length}</span></div>

      <div className="cb-report">
        <p className="cb-report-lede">Add potential cast members to see which saved shows they can fully cover — click a show below to see exactly what's missing.</p>
        <CastDropdownPicker people={people} castIds={potentialCastIds} onAdd={addToCast} onRemove={removeFromCast} />
        <div className="cb-toggle-row">
          <ToggleSwitch label="Include Optional Roles" checked={includeOptional} onChange={setIncludeOptional} />
        </div>
      </div>

      <div className="cb-report">
        <p className="cb-report-lede">Build a new show by adding pieces in performance order.</p>
        <PieceDropdownPicker pieces={pieces.filter(p => !p.archived)} orderedIds={orderedIds} onAdd={addPieceToOrder} onRemove={removePieceFromOrder} pieceById={pieceById} />
        <div className="cb-save-show-row">
          <input className="cb-input" placeholder="Show name" value={showName}
            onChange={e => setShowName(e.target.value)} onKeyDown={e => e.key === "Enter" && saveShow()} />
          <button className="cb-btn cb-btn-accent" disabled={!showName.trim() || orderedIds.length === 0} onClick={saveShow}>
            <Save size={15} /> Save show
          </button>
        </div>
      </div>

      {savedShows.length === 0 ? (
        <EmptyState text="No shows saved yet — build one above, or save a running order from Build a Show." />
      ) : (
        <div className="cb-card-grid cb-show-grid">
          {savedShows.map(show => (
            <SavedShowCard
              key={show.id} show={show} pieceById={pieceById}
              rolesByPiece={rolesByPiece} assignmentsByRole={assignmentsByRole}
              includeOptional={includeOptional}
              potentialCastIds={potentialCastIds} onDelete={onDelete}
              tracks={tracks} onSetTracks={onSetTracks} people={people}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------------- styles ---------------- */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

.cb-root {
  --bg: #17151a;
  --surface: #211e26;
  --surface-2: #2a2631;
  --border: #3a3540;
  --text: #f2ece1;
  --text-dim: #a89f9a;
  --accent: #e8a23d;
  --accent-2: #c1443c;
  background: var(--bg);
  color: var(--text);
  font-family: 'Inter', sans-serif;
  min-height: 100vh;
  padding: 28px 24px 60px;
  box-sizing: border-box;
}
.cb-root * { box-sizing: border-box; }
.cb-loading { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
.cb-loading-text { color: var(--text-dim); font-family: 'JetBrains Mono', monospace; font-size: 13px; }
.cb-setup { max-width: 460px; text-align: center; }
.cb-setup h2 { font-family: 'Oswald', sans-serif; text-transform: uppercase; }
.cb-setup code { background: var(--surface); padding: 2px 6px; border-radius: 3px; font-family: 'JetBrains Mono', monospace; font-size: 12px; }

.cb-login { display: flex; flex-direction: column; gap: 12px; width: 280px; text-align: left; }
.cb-login-title { margin-bottom: 8px; }
.cb-login-btn { justify-content: center; margin-top: 4px; }

.cb-header { max-width: 980px; margin: 0 auto 24px; }
.cb-title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.cb-signout { display: flex; align-items: center; gap: 6px; background: transparent; border: 1px solid var(--border); color: var(--text-dim); border-radius: 3px; padding: 7px 12px; font-family: 'Inter', sans-serif; font-size: 12.5px; cursor: pointer; margin-top: 2px; }
.cb-signout:hover { color: var(--text); border-color: var(--text-dim); }
.cb-eyebrow { font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent); margin-bottom: 4px; }
.cb-title { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 30px; letter-spacing: 0.01em; margin: 0 0 18px; text-transform: uppercase; }
.cb-tabs { display: flex; gap: 4px; flex-wrap: wrap; border-bottom: 1px solid var(--border); padding-bottom: 0; }
.cb-tab { display: flex; align-items: center; gap: 6px; background: transparent; border: none; cursor: pointer; color: var(--text-dim); font-family: 'Oswald', sans-serif; font-size: 13px; letter-spacing: 0.04em; text-transform: uppercase; padding: 9px 14px; border-bottom: 2px solid transparent; position: relative; top: 1px; transition: color 0.15s ease, border-color 0.15s ease; }
.cb-tab:hover { color: var(--text); }
.cb-tab-active { color: var(--accent); border-bottom-color: var(--accent); }

.cb-error-banner { max-width: 980px; margin: 0 auto 16px; display: flex; align-items: center; gap: 8px; background: rgba(193,68,60,0.15); border: 1px solid rgba(193,68,60,0.4); color: #ecb3ae; font-size: 13px; padding: 10px 14px; border-radius: 4px; }

.cb-main { max-width: 980px; margin: 0 auto; }
.cb-section-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 14px; }
.cb-section-head h2 { font-family: 'Oswald', sans-serif; text-transform: uppercase; letter-spacing: 0.03em; font-size: 18px; margin: 0; font-weight: 600; }
.cb-count { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-dim); }

.cb-addrow { display: flex; gap: 8px; margin-bottom: 18px; flex-wrap: wrap; }
.cb-addrow-piece .cb-input:first-child { flex: 1 1 220px; }
.cb-colon { display: flex; align-items: center; color: var(--text-dim); font-family: 'JetBrains Mono', monospace; }

.cb-input { background: var(--surface); border: 1px solid var(--border); color: var(--text); border-radius: 3px; padding: 9px 11px; font-family: 'Inter', sans-serif; font-size: 13.5px; flex: 1; min-width: 120px; outline: none; transition: border-color 0.15s ease; }
.cb-input:focus { border-color: var(--accent); }
.cb-input-num { flex: 0 0 66px; min-width: 0; }

.cb-btn { display: flex; align-items: center; gap: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 3px; padding: 9px 14px; font-family: 'Oswald', sans-serif; font-size: 12.5px; letter-spacing: 0.03em; text-transform: uppercase; cursor: pointer; white-space: nowrap; transition: background 0.15s ease, border-color 0.15s ease; }
.cb-btn-accent { background: var(--accent); color: #1a1408; border-color: var(--accent); font-weight: 600; }
.cb-btn-accent:hover { filter: brightness(1.08); }
.cb-btn:focus-visible, .cb-input:focus-visible, .cb-select:focus-visible, .cb-tab:focus-visible, .cb-icon-btn:focus-visible, .cb-subtab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.cb-empty { color: var(--text-dim); font-size: 13px; border: 1px dashed var(--border); border-radius: 4px; padding: 16px; margin-bottom: 16px; font-style: italic; }

.cb-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
.cb-card { background: var(--surface); border: 1px solid var(--border); border-radius: 5px; padding: 13px 14px; position: relative; }
.cb-card-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.cb-cue { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--accent); background: rgba(232,162,61,0.12); border: 1px solid rgba(232,162,61,0.35); padding: 2px 6px; border-radius: 2px; letter-spacing: 0.03em; }
.cb-cue-inline { color: var(--accent); font-size: 11px; }
.cb-card-name { font-family: 'Oswald', sans-serif; font-size: 15.5px; font-weight: 600; margin-bottom: 6px; }
.cb-card-sub { font-size: 12.5px; color: var(--text); line-height: 1.6; }
.cb-dim { color: var(--text-dim); }
.cb-mono { font-family: 'JetBrains Mono', monospace; }
.cb-accent-text { color: var(--accent); }
.cb-taglist { list-style: none; margin: 0; padding: 0; }
.cb-taglist li { padding: 1px 0; }

.cb-icon-btn { background: transparent; border: none; color: var(--text-dim); cursor: pointer; padding: 4px; border-radius: 3px; display: flex; align-items: center; transition: color 0.15s ease, background 0.15s ease; }
.cb-icon-btn:hover { color: var(--accent-2); background: rgba(193,68,60,0.12); }

.cb-piece-groups { display: flex; flex-direction: column; gap: 22px; }
.cb-piece-group { border-left: 2px solid var(--accent); padding-left: 16px; }
.cb-piece-group-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
.cb-piece-group-toggle { background: none; border: none; cursor: pointer; width: 100%; text-align: left; padding: 0; margin-bottom: 0; color: inherit; font-family: inherit; }
.cb-piece-group-toggle .cb-piece-group-name { flex: 1; }
.cb-piece-group-body { margin-top: 12px; }
.cb-piece-group-name { font-family: 'Oswald', sans-serif; font-size: 15px; text-transform: uppercase; letter-spacing: 0.02em; }

.cb-role-row { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 10px 12px; margin-bottom: 8px; }
.cb-role-row-top { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.cb-role-name { font-weight: 600; font-size: 13.5px; flex: 1; }
.cb-role-people { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }

.cb-chip { display: inline-flex; align-items: center; gap: 5px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 20px; padding: 4px 6px 4px 10px; font-size: 12.5px; }
.cb-chip-static { padding-right: 10px; }
.cb-chip-x { background: transparent; border: none; color: var(--text-dim); cursor: pointer; display: flex; padding: 2px; border-radius: 50%; }
.cb-chip-x:hover { color: var(--accent-2); }
.cb-chiplist { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 4px; }

.cb-select { background: var(--surface); border: 1px solid var(--border); color: var(--text-dim); border-radius: 20px; padding: 5px 10px; font-size: 12.5px; font-family: 'Inter', sans-serif; cursor: pointer; }
.cb-select-inline { max-width: 180px; }

.cb-conflict { display: flex; align-items: center; gap: 6px; background: rgba(193,68,60,0.15); border: 1px solid rgba(193,68,60,0.4); color: #ecb3ae; font-size: 12.5px; padding: 8px 12px; border-radius: 4px; margin-bottom: 14px; }

.cb-subtabs { display: flex; gap: 6px; margin-bottom: 18px; flex-wrap: wrap; }
.cb-subtab { background: var(--surface); border: 1px solid var(--border); color: var(--text-dim); border-radius: 20px; padding: 7px 14px; font-size: 12.5px; cursor: pointer; font-family: 'Inter', sans-serif; }
.cb-subtab-active { color: #1a1408; background: var(--accent); border-color: var(--accent); font-weight: 600; }

.cb-report-lede { color: var(--text-dim); font-size: 13px; margin: 0 0 16px; }
.cb-runtime-target { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.cb-runtime-target label { font-size: 12.5px; color: var(--text-dim); }
.cb-runtime-list { display: flex; flex-direction: column; gap: 2px; margin-bottom: 14px; }
.cb-runtime-row { display: flex; align-items: center; gap: 10px; padding: 7px 4px; border-bottom: 1px solid var(--border); cursor: pointer; }
.cb-runtime-row input[type=checkbox] { accent-color: var(--accent); width: 15px; height: 15px; }
.cb-runtime-name { flex: 1; font-size: 13.5px; }
.cb-runtime-total { display: flex; align-items: center; gap: 10px; font-size: 13.5px; padding: 12px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; }
.cb-runtime-over { border-color: var(--accent-2); }

.cb-report-label { font-family: 'Oswald', sans-serif; text-transform: uppercase; letter-spacing: 0.03em; font-size: 12.5px; color: var(--text-dim); }
.cb-linklike { background: none; border: none; color: var(--accent); cursor: pointer; font-size: 12px; padding: 0; display: inline-flex; align-items: center; gap: 4px; font-family: 'Inter', sans-serif; }
.cb-linklike:hover { text-decoration: underline; }

.cb-picker { margin-bottom: 18px; }
.cb-picker-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.cb-picker-grid { display: flex; flex-wrap: wrap; gap: 6px; }
.cb-picker-chip { display: inline-flex; align-items: center; gap: 6px; background: var(--surface); border: 1px solid var(--border); border-radius: 20px; padding: 6px 12px 6px 10px; font-size: 12.5px; cursor: pointer; }
.cb-picker-chip input { accent-color: var(--accent); }

.cb-coverage-block { margin: 18px 0; }
.cb-coverage-head { display: flex; align-items: center; gap: 7px; font-family: 'Oswald', sans-serif; text-transform: uppercase; letter-spacing: 0.03em; font-size: 13px; margin-bottom: 10px; }
.cb-coverage-good { color: var(--accent); }
.cb-coverage-bad { color: #ecb3ae; }

.cb-build-btn { margin-bottom: 6px; }
.cb-builder-results { margin-top: 20px; }
.cb-show-grid { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
.cb-show-option { display: flex; flex-direction: column; }
.cb-show-piece-list { margin: 4px 0 10px; }
.cb-show-piece-list li { display: flex; justify-content: space-between; gap: 8px; }
.cb-show-prop-toggle { margin-top: auto; }
.cb-show-props { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); font-size: 12px; display: flex; flex-direction: column; gap: 4px; }
.cb-show-prop-group { line-height: 1.5; }
.cb-export-btn { display: flex; align-items: center; gap: 6px; margin-top: 10px; justify-content: center; }

.cb-type-select { margin-top: 10px; width: 100%; }
.cb-select-full { width: 100%; }
.cb-type-badge { color: var(--accent); font-family: 'JetBrains Mono', monospace; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; margin-left: 6px; }
.cb-card-edit-actions { display: flex; gap: 2px; }
.cb-edit-name { width: 100%; margin-bottom: 8px; font-family: 'Oswald', sans-serif; font-size: 14.5px; }
.cb-edit-time { margin-bottom: 0; }

.cb-wizard-steps { display: flex; gap: 18px; margin-bottom: 20px; border-bottom: 1px solid var(--border); padding-bottom: 12px; }
.cb-wizard-step { font-family: 'Oswald', sans-serif; text-transform: uppercase; letter-spacing: 0.03em; font-size: 12.5px; color: var(--text-dim); }
.cb-wizard-step-active { color: var(--accent); }
.cb-wizard-nav { display: flex; gap: 8px; margin-top: 18px; }
.cb-toggle-row { display: flex; gap: 22px; flex-wrap: wrap; margin-bottom: 16px; }
.cb-toggle { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12.5px; }
.cb-toggle-input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.cb-toggle-role { width: 34px; height: 18px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--border); position: relative; transition: background 0.15s ease, border-color 0.15s ease; flex-shrink: 0; }
.cb-toggle-thumb { position: absolute; top: 1px; left: 1px; width: 14px; height: 14px; border-radius: 50%; background: var(--text-dim); transition: transform 0.15s ease, background 0.15s ease; }
.cb-toggle-input:checked + .cb-toggle-role { background: var(--accent); border-color: var(--accent); }
.cb-toggle-input:checked + .cb-toggle-role .cb-toggle-thumb { transform: translateX(16px); background: #1a1408; }
.cb-toggle-input:focus-visible + .cb-toggle-role { outline: 2px solid var(--accent); outline-offset: 2px; }
.cb-toggle-label { color: var(--text); }

.cb-inline-checkbox { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-dim); white-space: nowrap; }
.cb-inline-checkbox input { accent-color: var(--accent); width: 15px; height: 15px; }

.cb-preset-panel { margin: 14px 0 18px; }
.cb-preset-list { margin-top: 10px; }
.cb-preset-chip { padding-left: 2px; }
.cb-preset-load { background: none; border: none; color: var(--text); cursor: pointer; font-size: 12.5px; font-family: 'Inter', sans-serif; padding: 4px 4px 4px 8px; }
.cb-preset-load:hover { color: var(--accent); }
.cb-linklike:disabled { opacity: 0.4; cursor: not-allowed; }
.cb-linklike:disabled:hover { text-decoration: none; }

.cb-save-show-row { display: flex; gap: 8px; align-items: center; margin-top: 10px; }

.cb-order-item { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.cb-order-item-right { display: flex; align-items: center; gap: 6px; }

.cb-saved-show-title { display: flex; align-items: center; gap: 6px; flex: 1; text-align: left; }
.cb-saved-show-list { margin-top: 10px; }
.cb-piece-not-covered { color: #ecb3ae; }
.cb-not-covered-detail { color: #ecb3ae; font-size: 11.5px; }

.cb-card-archived { opacity: 0.55; }
.cb-card-archived:hover { opacity: 0.85; }
.cb-archive-section { margin-top: 22px; border-top: 1px solid var(--border); padding-top: 14px; }
.cb-archive-toggle { font-family: 'Oswald', sans-serif; text-transform: uppercase; letter-spacing: 0.03em; font-size: 12.5px; }
.cb-archive-grid { margin-top: 14px; }

.cb-piece-selects { display: flex; gap: 8px; margin-top: 10px; }
.cb-piece-selects .cb-type-select { margin-top: 0; }

.cb-role-name-edit { flex: 1; margin-right: 6px; }
.cb-role-track-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }

.cb-track-add-role { margin-top: 12px; }
.cb-saved-show-tracks { margin-top: 10px; }
.cb-saved-show-track-add { margin-top: 8px; }

@media (max-width: 560px) {
  .cb-title { font-size: 24px; }
  .cb-card-grid { grid-template-columns: 1fr; }
}
`;
