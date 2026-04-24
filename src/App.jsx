import { useState, useEffect, useMemo } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const LS_DATA = "debtview_loans_v1";
const LS_PIN  = "debtview_pin_hash";

function loadData()     { try { const v = localStorage.getItem(LS_DATA); return v ? JSON.parse(v) : null; } catch { return null; } }
function saveData(data) { try { localStorage.setItem(LS_DATA, JSON.stringify(data)); } catch {} }
function loadPinHash()  { return localStorage.getItem(LS_PIN) || null; }
function savePinHash(h) { localStorage.setItem(LS_PIN, h); }
function clearPinHash() { localStorage.removeItem(LS_PIN); }

async function hashPin(pin) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin + "debtview_salt"));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

const TYPES = ["Home Loan","Personal Loan","Credit Card EMI","Informal / Family","Vehicle Loan","Education Loan","Other"];
const TYPE_ICON  = { "Home Loan":"⌂","Personal Loan":"◈","Credit Card EMI":"▪","Informal / Family":"♡","Vehicle Loan":"◎","Education Loan":"◇","Other":"◉" };
const TYPE_COLOR = { "Home Loan":"#4f9cf9","Personal Loan":"#f97316","Credit Card EMI":"#a855f7","Informal / Family":"#22c55e","Vehicle Loan":"#eab308","Education Loan":"#06b6d4","Other":"#94a3b8" };

const fmt    = n => "₹" + Number(n).toLocaleString("en-IN");
const fmtK   = n => n >= 100000 ? "₹"+(n/100000).toFixed(1)+"L" : n >= 1000 ? "₹"+(n/1000).toFixed(0)+"K" : "₹"+n;
const uid    = () => Math.random().toString(36).slice(2,9);
const moStr  = m => m <= 0 ? "Done!" : m < 12 ? `${m}mo` : `${Math.floor(m/12)}y ${m%12}mo`;
const emptyL = () => ({ id:uid(), name:"", type:"Personal Loan", originalAmount:"", outstanding:"", interestRate:"", emi:"", monthsLeft:"", notes:"", active:true });

function buildLoanSchedule(loan) {
  const outstanding = Math.max(0, Number(loan.outstanding) || 0);
  const emi = Math.max(0, Number(loan.emi) || 0);
  const monthsLeft = Math.max(0, Number(loan.monthsLeft) || 0);
  const monthlyRate = Math.max(0, Number(loan.interestRate) || 0) / 12 / 100;

  if (outstanding <= 0 || emi <= 0 || monthsLeft <= 0) {
    return { schedule: [], summary: null, warnings: [] };
  }

  const warnings = [];
  const firstMonthInterest = outstanding * monthlyRate;
  if (monthlyRate > 0 && emi <= firstMonthInterest) {
    warnings.push("EMI is too low to reduce principal at the current interest rate.");
  }

  let balance = outstanding;
  let cursor = new Date();
  let totalPrincipal = 0;
  let totalInterest = 0;
  const schedule = [];

  for (let index = 0; index < monthsLeft && balance > 0; index += 1) {
    const rawInterest = balance * monthlyRate;
    const interest = Math.min(balance, Number(rawInterest.toFixed(2)));
    let payment = emi;

    if (monthlyRate > 0 && payment <= interest) {
      payment = interest;
    }

    payment = Math.min(payment, Number((balance + interest).toFixed(2)));
    const principal = Math.min(balance, Number((payment - interest).toFixed(2)));
    balance = Math.max(0, Number((balance - principal).toFixed(2)));

    totalPrincipal += principal;
    totalInterest += interest;

    schedule.push({
      index,
      year: cursor.getFullYear(),
      month: cursor.toLocaleString("en-IN", { month: "short" }),
      monthLabel: cursor.toLocaleString("en-IN", { month: "short", year: "numeric" }),
      emi: payment,
      principal,
      interest,
      balance,
    });

    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  return {
    schedule,
    warnings,
    summary: {
      totalPrincipal: Number(totalPrincipal.toFixed(2)),
      totalInterest: Number(totalInterest.toFixed(2)),
      totalPaid: Number((totalPrincipal + totalInterest).toFixed(2)),
      endBalance: Number(balance.toFixed(2)),
    },
  };
}

function currentYearBreakdown(schedule) {
  if (!schedule.length) return null;

  const year = new Date().getFullYear();
  const rows = schedule.filter(entry => entry.year === year);
  const targetRows = rows.length ? rows : schedule;

  return {
    year: rows.length ? year : targetRows[0].year,
    emi: Number(targetRows.reduce((sum, item) => sum + item.emi, 0).toFixed(2)),
    principal: Number(targetRows.reduce((sum, item) => sum + item.principal, 0).toFixed(2)),
    interest: Number(targetRows.reduce((sum, item) => sum + item.interest, 0).toFixed(2)),
    balance: targetRows[targetRows.length - 1]?.balance ?? 0,
    rows: targetRows,
    isFallback: rows.length === 0,
  };
}

function prioritise(loans, strategy) {
  const a = loans.filter(l => l.active && Number(l.outstanding) > 0);
  if (strategy === "avalanche") return [...a].sort((x,y) => Number(y.interestRate||0) - Number(x.interestRate||0));
  if (strategy === "snowball")  return [...a].sort((x,y) => Number(x.outstanding) - Number(y.outstanding));
  return a;
}

function payoffProjection(loans) {
  const max = Math.max(...loans.filter(l=>l.active).map(l=>Number(l.monthsLeft)||0), 1);
  const data = [];
  for (let m = 0; m <= Math.min(max, 60); m += m < 12 ? 1 : 3) {
    const total = loans.filter(l=>l.active).reduce((sum,l) => {
      const ml=Number(l.monthsLeft)||0, out=Number(l.outstanding)||0, emi=Number(l.emi)||0;
      return sum + (m >= ml ? 0 : Math.max(0, out - emi*m));
    }, 0);
    data.push({ month:m, label: m===0?"Now":`M${m}`, total:Math.round(total) });
  }
  return data;
}

function PinScreen({ onUnlock }) {
  const [mode, setMode]       = useState("check");
  const [pin, setPin]         = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError]     = useState("");
  const [shake, setShake]     = useState(false);

  useEffect(() => { setMode(loadPinHash() ? "enter" : "setup"); }, []);

  const doShake = () => { setShake(true); setTimeout(() => setShake(false), 500); };

  const handleSetup = async () => {
    if (pin.length < 4) { setError("PIN must be at least 4 digits"); return; }
    if (pin !== confirm) { setError("PINs don't match"); doShake(); setConfirm(""); return; }
    savePinHash(await hashPin(pin));
    onUnlock();
  };

  const handleEnter = async () => {
    if ((await hashPin(pin)) === loadPinHash()) { onUnlock(); }
    else { setError("Wrong PIN"); doShake(); setPin(""); }
  };

  const C = { bg:"#f8f4ef", card:"#ffffff", border:"#e8e0d5", navy:"#1e2d4a", accent:"#c8622a", muted:"#8c7b6b" };

  return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Crimson Pro', serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Crimson+Pro:wght@400;500;600&family=DM+Mono:wght@400;500;600&display=swap');
        @keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        *{box-sizing:border-box} input:focus{border-color:#c8622a!important;outline:none}
      `}</style>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:"48px 40px", width:380, boxShadow:"0 8px 40px #00000012", animation: shake ? "shake 0.4s ease" : "fadeIn 0.4s ease" }}>
        <div style={{ textAlign:"center", marginBottom:36 }}>
          <div style={{ fontSize:32, marginBottom:12 }}>⌂</div>
          <div style={{ fontFamily:"'Playfair Display', serif", fontSize:26, fontWeight:700, color:C.navy }}>DebtView</div>
          <div style={{ fontSize:12, color:C.muted, letterSpacing:"0.12em", textTransform:"uppercase", fontFamily:"'DM Mono', monospace", marginTop:6 }}>
            {mode === "setup" ? "Set your access PIN" : "Enter your PIN"}
          </div>
        </div>

        {mode === "setup" && (
          <>
            <div style={{ marginBottom:14 }}>
              <label style={{ fontSize:11, color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase", display:"block", marginBottom:6, fontFamily:"'DM Mono', monospace" }}>Choose PIN</label>
              <input type="password" inputMode="numeric" maxLength={8} value={pin} placeholder="Min 4 digits"
                onChange={e => { setPin(e.target.value.replace(/\D/g,"")); setError(""); }}
                onKeyDown={e => e.key==="Enter" && confirm && handleSetup()}
                style={{ width:"100%", background:"#faf8f5", border:`1px solid ${C.border}`, borderRadius:8, padding:"12px 14px", fontSize:20, fontFamily:"'DM Mono', monospace", letterSpacing:"0.3em", textAlign:"center", color:C.navy }} />
            </div>
            <div style={{ marginBottom:20 }}>
              <label style={{ fontSize:11, color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase", display:"block", marginBottom:6, fontFamily:"'DM Mono', monospace" }}>Confirm PIN</label>
              <input type="password" inputMode="numeric" maxLength={8} value={confirm} placeholder="Repeat PIN"
                onChange={e => { setConfirm(e.target.value.replace(/\D/g,"")); setError(""); }}
                onKeyDown={e => e.key==="Enter" && handleSetup()}
                style={{ width:"100%", background:"#faf8f5", border:`1px solid ${C.border}`, borderRadius:8, padding:"12px 14px", fontSize:20, fontFamily:"'DM Mono', monospace", letterSpacing:"0.3em", textAlign:"center", color:C.navy }} />
            </div>
            {error && <div style={{ color:"#dc2626", fontSize:12, fontFamily:"'DM Mono', monospace", marginBottom:14, textAlign:"center" }}>{error}</div>}
            <button onClick={handleSetup} style={{ width:"100%", background:C.navy, border:"none", color:"#e8d5b7", padding:"13px", borderRadius:8, cursor:"pointer", fontSize:14, fontFamily:"'DM Mono', monospace", fontWeight:600, letterSpacing:"0.08em" }}>Set PIN & Enter</button>
            <div style={{ marginTop:14, fontSize:11, color:C.muted, textAlign:"center", fontFamily:"'DM Mono', monospace", lineHeight:1.6 }}>PIN stored only in this browser. No data leaves your device.</div>
          </>
        )}

        {mode === "enter" && (
          <>
            <div style={{ marginBottom:20 }}>
              <input type="password" inputMode="numeric" maxLength={8} value={pin} placeholder="Enter PIN" autoFocus
                onChange={e => { setPin(e.target.value.replace(/\D/g,"")); setError(""); }}
                onKeyDown={e => e.key==="Enter" && handleEnter()}
                style={{ width:"100%", background:"#faf8f5", border:`1px solid ${C.border}`, borderRadius:8, padding:"14px", fontSize:24, fontFamily:"'DM Mono', monospace", letterSpacing:"0.4em", textAlign:"center", color:C.navy }} />
            </div>
            {error && <div style={{ color:"#dc2626", fontSize:12, fontFamily:"'DM Mono', monospace", marginBottom:14, textAlign:"center" }}>{error}</div>}
            <button onClick={handleEnter} style={{ width:"100%", background:C.navy, border:"none", color:"#e8d5b7", padding:"13px", borderRadius:8, cursor:"pointer", fontSize:14, fontFamily:"'DM Mono', monospace", fontWeight:600, letterSpacing:"0.08em" }}>Unlock</button>
            <div style={{ marginTop:16, textAlign:"center" }}>
              <button onClick={() => { clearPinHash(); setMode("setup"); setPin(""); setError(""); }}
                style={{ background:"transparent", border:"none", color:C.muted, fontSize:11, fontFamily:"'DM Mono', monospace", cursor:"pointer", textDecoration:"underline" }}>
                Forgot PIN? Reset (clears all data)
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [loans, setLoans]       = useState([]);
  const [strategy, setStrategy] = useState("avalanche");
  const [view, setView]         = useState("dashboard");
  const [form, setForm]         = useState(emptyL());
  const [editId, setEditId]     = useState(null);
  const [toast, setToast]       = useState(null);
  const [expandId, setExpandId] = useState(null);

  // ── ALL hooks MUST be before any early return ──────────────────────────
  const active      = useMemo(() => loans.filter(l => l.active), [loans]);
  const totalOut    = useMemo(() => active.reduce((s,l) => s + Number(l.outstanding||0), 0), [active]);
  const totalEMI    = useMemo(() => active.reduce((s,l) => s + Number(l.emi||0), 0), [active]);
  const totalOrig   = useMemo(() => active.reduce((s,l) => s + Number(l.originalAmount||l.outstanding||0), 0), [active]);
  const pctPaid     = useMemo(() => totalOrig > 0 ? Math.min(100, Math.round((1 - totalOut/totalOrig)*100)) : 0, [totalOut, totalOrig]);
  const longestMo   = useMemo(() => Math.max(...active.map(l => Number(l.monthsLeft)||0), 0), [active]);
  const prioritised = useMemo(() => prioritise(loans, strategy), [loans, strategy]);
  const projData    = useMemo(() => payoffProjection(loans), [loans]);

  useEffect(() => {
    if (!unlocked) return;
    const d = loadData();
    if (d?.loans)    setLoans(d.loans);
    if (d?.strategy) setStrategy(d.strategy);
  }, [unlocked]);

  useEffect(() => { if (unlocked) saveData({ loans, strategy }); }, [loans, strategy, unlocked]);

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  // ── Early return AFTER all hooks ───────────────────────────────────────
  if (!unlocked) return <PinScreen onUnlock={() => setUnlocked(true)} />;

  const openAdd  = () => { setForm(emptyL()); setEditId(null); setView("add"); };
  const openEdit = l  => {
    setForm({ ...l, originalAmount:String(l.originalAmount||""), outstanding:String(l.outstanding||""),
      interestRate:String(l.interestRate||""), emi:String(l.emi||""), monthsLeft:String(l.monthsLeft||"") });
    setEditId(l.id); setView("add");
  };

  const handleSubmit = () => {
    if (!form.name.trim() || !form.outstanding) return;
    const loan = { ...form,
      originalAmount: Number(form.originalAmount)||Number(form.outstanding),
      outstanding: Number(form.outstanding), interestRate: Number(form.interestRate)||0,
      emi: Number(form.emi)||0, monthsLeft: Number(form.monthsLeft)||0 };
    if (editId) { setLoans(p => p.map(l => l.id===editId ? {...l,...loan} : l)); showToast("Updated ✓"); }
    else        { setLoans(p => [...p, loan]); showToast("Loan added ✓"); }
    setView("dashboard"); setEditId(null);
  };

  const markPaid  = id => { setLoans(p => p.map(l => l.id===id ? {...l, outstanding:0, monthsLeft:0, active:false} : l)); showToast("🎉 Loan cleared!"); };
  const delLoan   = id => { setLoans(p => p.filter(l => l.id!==id)); showToast("Removed"); };

  const exportCSV = () => {
    const h    = ["Name","Type","Original","Outstanding","Rate%","EMI","Months Left","Notes"];
    const rows = loans.map(l => [l.name,l.type,l.originalAmount,l.outstanding,l.interestRate,l.emi,l.monthsLeft,`"${l.notes||""}"`]);
    const blob = new Blob([[h,...rows].map(r=>r.join(",")).join("\n")], {type:"text/csv"});
    const a    = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `loans-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    showToast("Exported ✓");
  };

  const handleLock = () => { setUnlocked(false); setLoans([]); setView("dashboard"); };

  const C = { bg:"#f8f4ef", card:"#ffffff", border:"#e8e0d5", text:"#1a1410", muted:"#8c7b6b", accent:"#c8622a", navy:"#1e2d4a" };
  const S = {
    root:   { background:C.bg, minHeight:"100vh", fontFamily:"'Crimson Pro', serif", color:C.text },
    header: { background:C.navy, padding:"0 28px", display:"flex", alignItems:"center", justifyContent:"space-between", height:58 },
    logo:   { color:"#e8d5b7", fontFamily:"'Playfair Display', serif", fontSize:18, fontWeight:700 },
    logoSub:{ color:"#7a8fa8", fontSize:10, fontFamily:"'DM Mono', monospace", letterSpacing:"0.15em", textTransform:"uppercase", marginTop:1 },
    navBtn: a => ({ background:a?"#ffffff18":"transparent", border:"none", color:a?"#e8d5b7":"#7a8fa8", padding:"6px 16px", borderRadius:4, cursor:"pointer", fontSize:12, fontFamily:"'DM Mono', monospace", letterSpacing:"0.08em" }),
    addBtn: { background:C.accent, border:"none", color:"#fff", padding:"7px 18px", borderRadius:4, cursor:"pointer", fontSize:12, fontFamily:"'DM Mono', monospace", fontWeight:600 },
    outBtn: { background:"transparent", border:"1px solid #7a8fa844", color:"#7a8fa8", padding:"6px 14px", borderRadius:4, cursor:"pointer", fontSize:11, fontFamily:"'DM Mono', monospace" },
    body:   { padding:28, maxWidth:1080, margin:"0 auto" },
    sg:     { display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:24 },
    sc:     { background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:"18px 20px", boxShadow:"0 1px 3px #00000008" },
    sn:     { fontFamily:"'Playfair Display', serif", fontSize:26, fontWeight:700, lineHeight:1 },
    sl:     { fontSize:10, color:C.muted, letterSpacing:"0.12em", textTransform:"uppercase", marginTop:6, fontFamily:"'DM Mono', monospace" },
    panel:  { background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:"20px 22px", marginBottom:16, boxShadow:"0 1px 3px #00000008" },
    pt:     { fontFamily:"'Playfair Display', serif", fontSize:14, color:C.navy, marginBottom:14, paddingBottom:10, borderBottom:`1px solid ${C.border}`, fontWeight:600 },
    pill:   (a,c) => ({ background:a?c:"transparent", border:`1px solid ${a?c:C.border}`, color:a?"#fff":C.muted, padding:"5px 14px", borderRadius:20, cursor:"pointer", fontSize:11, fontFamily:"'DM Mono', monospace" }),
    lc:     color => ({ background:C.card, border:`1px solid ${C.border}`, borderLeft:`4px solid ${color}`, borderRadius:8, padding:"16px 18px", marginBottom:10 }),
    ln:     { fontFamily:"'Playfair Display', serif", fontSize:16, fontWeight:600, color:C.navy },
    lm:     { display:"flex", gap:10, flexWrap:"wrap", alignItems:"center", marginTop:5 },
    tag:    c => ({ fontSize:10, color:c, background:c+"18", padding:"2px 8px", borderRadius:3, fontFamily:"'DM Mono', monospace", fontWeight:600 }),
    pb:     { height:6, background:"#f0ebe4", borderRadius:3, marginTop:12, overflow:"hidden" },
    lbl:    { fontSize:11, color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:5, display:"block", fontFamily:"'DM Mono', monospace" },
    inp:    { width:"100%", background:"#faf8f5", border:`1px solid ${C.border}`, borderRadius:6, color:C.text, padding:"9px 12px", fontSize:14, fontFamily:"'Crimson Pro', serif", outline:"none", boxSizing:"border-box" },
    sel:    { width:"100%", background:"#faf8f5", border:`1px solid ${C.border}`, borderRadius:6, color:C.text, padding:"9px 12px", fontSize:14, fontFamily:"'Crimson Pro', serif", outline:"none", appearance:"none", boxSizing:"border-box" },
    fg:     { display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 },
    subBtn: { background:C.navy, border:"none", color:"#e8d5b7", padding:"11px 26px", borderRadius:6, cursor:"pointer", fontSize:13, fontFamily:"'DM Mono', monospace", fontWeight:600 },
    canBtn: { background:"transparent", border:`1px solid ${C.border}`, color:C.muted, padding:"10px 22px", borderRadius:6, cursor:"pointer", fontSize:13, fontFamily:"'DM Mono', monospace" },
    ab:     c => ({ background:"transparent", border:`1px solid ${c}44`, color:c, padding:"4px 10px", borderRadius:4, cursor:"pointer", fontSize:10, fontFamily:"'DM Mono', monospace" }),
    dc:     { marginTop:16, paddingTop:16, borderTop:`1px solid ${C.border}` },
    dg:     { display:"grid", gridTemplateColumns:"repeat(4, minmax(0, 1fr))", gap:10, marginBottom:14 },
    ds:     { background:"#faf8f5", border:`1px solid ${C.border}`, borderRadius:8, padding:"12px 14px" },
    dsv:    { fontFamily:"'Playfair Display', serif", fontSize:20, color:C.navy, fontWeight:700, lineHeight:1.1 },
    dsl:    { fontSize:10, color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase", marginTop:6, fontFamily:"'DM Mono', monospace" },
    warn:   { marginBottom:14, padding:"10px 12px", borderRadius:8, background:"#fff3cd", color:"#8a5a00", border:"1px solid #f3d58a", fontSize:12, fontFamily:"'DM Mono', monospace" },
    tableW: { overflowX:"auto", border:`1px solid ${C.border}`, borderRadius:8 },
    table:  { width:"100%", borderCollapse:"collapse", background:"#fff" },
    th:     { textAlign:"left", fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", color:C.muted, fontFamily:"'DM Mono', monospace", padding:"11px 12px", background:"#faf8f5", borderBottom:`1px solid ${C.border}` },
    td:     { padding:"11px 12px", borderBottom:`1px solid ${C.border}`, fontSize:13, color:C.text, fontFamily:"'Crimson Pro', serif", whiteSpace:"nowrap" },
    empty:  { textAlign:"center", padding:"60px 20px", color:C.muted },
    toast:  { position:"fixed", bottom:24, right:24, background:C.navy, color:"#e8d5b7", padding:"11px 22px", borderRadius:6, fontSize:12, fontFamily:"'DM Mono', monospace", zIndex:999, boxShadow:"0 4px 20px #00000030", animation:"slideUp 0.25s ease" },
  };

  return (
    <div style={S.root}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Crimson+Pro:wght@400;500;600&family=DM+Mono:wght@400;500;600&display=swap');
        *{box-sizing:border-box} button:hover{opacity:0.88} input:focus,select:focus{border-color:#c8622a!important;outline:none}
        @keyframes slideUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @media (max-width: 900px){
          .stats-grid{grid-template-columns:repeat(2,1fr)!important}
          .detail-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}
        }
        @media (max-width: 640px){
          .stats-grid,.detail-grid,.form-grid{grid-template-columns:1fr!important}
        }
      `}</style>

      <div style={S.header}>
        <div>
          <div style={S.logo}>DebtView</div>
          <div style={S.logoSub}>loan portfolio tracker</div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <nav style={{ display:"flex", gap:4 }}>
            <button style={S.navBtn(view==="dashboard")} onClick={() => setView("dashboard")}>Dashboard</button>
            <button style={S.navBtn(view==="loans")} onClick={() => setView("loans")}>My Loans ({active.length})</button>
          </nav>
          <button style={S.outBtn} onClick={exportCSV}>↓ CSV</button>
          <button style={S.outBtn} onClick={handleLock}>🔒 Lock</button>
          <button style={S.addBtn} onClick={openAdd}>+ Add Loan</button>
        </div>
      </div>

      <div style={S.body}>

        {view === "dashboard" && (
          <>
            {loans.length === 0 ? (
              <div style={S.empty}>
                <div style={{ fontSize:48, marginBottom:16 }}>⌂</div>
                <div style={{ fontFamily:"'Playfair Display', serif", fontSize:22, color:C.navy, marginBottom:8 }}>No loans tracked yet</div>
                <div style={{ fontSize:14, marginBottom:24 }}>Add your loans once — come back anytime to check progress.</div>
                <button style={S.addBtn} onClick={openAdd}>+ Add your first loan</button>
              </div>
            ) : (
              <>
                <div className="stats-grid" style={S.sg}>
                  {[
                    { label:"Total Outstanding", value:fmtK(totalOut),   sub:`${active.length} active loans`, color:"#dc2626" },
                    { label:"Monthly Outgo",     value:fmtK(totalEMI),   sub:"combined EMIs",                 color:C.accent  },
                    { label:"Overall Paid Off",  value:`${pctPaid}%`,    sub:"across all loans",              color:"#16a34a" },
                    { label:"Debt-Free In",      value:moStr(longestMo), sub:"longest loan",                  color:C.navy    },
                  ].map(({ label, value, sub, color }) => (
                    <div key={label} style={S.sc}>
                      <div style={{ ...S.sn, color }}>{value}</div>
                      <div style={S.sl}>{label}</div>
                      <div style={{ fontSize:11, color:"#b0a090", marginTop:4, fontFamily:"'DM Mono', monospace" }}>{sub}</div>
                    </div>
                  ))}
                </div>

                <div style={S.panel}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14, paddingBottom:10, borderBottom:`1px solid ${C.border}` }}>
                    <div style={{ fontFamily:"'Playfair Display', serif", fontSize:14, color:C.navy, fontWeight:600 }}>🎯 Repayment Priority</div>
                    <div style={{ display:"flex", gap:6 }}>
                      {[["avalanche","Avalanche ↑ Rate"],["snowball","Snowball ↓ Balance"],["custom","As Added"]].map(([k,lb]) => (
                        <button key={k} style={S.pill(strategy===k, C.accent)} onClick={() => setStrategy(k)}>{lb}</button>
                      ))}
                    </div>
                  </div>
                  <div style={{ fontSize:11, color:C.muted, fontFamily:"'DM Mono', monospace", marginBottom:14 }}>
                    {strategy==="avalanche" && "Pay minimums on all · Throw extra cash at highest interest first — saves most money overall"}
                    {strategy==="snowball"  && "Pay minimums on all · Attack smallest balance first — builds momentum"}
                    {strategy==="custom"    && "Loans shown in the order you added them"}
                  </div>
                  {prioritised.map((loan, idx) => {
                    const pct   = loan.originalAmount > 0 ? Math.min(100, Math.round((1 - loan.outstanding/loan.originalAmount)*100)) : 0;
                    const color = TYPE_COLOR[loan.type];
                    return (
                      <div key={loan.id} style={{ display:"flex", alignItems:"center", gap:14, padding:"12px 0", borderBottom: idx < prioritised.length-1 ? `1px solid ${C.border}` : "none" }}>
                        <div style={{ width:28, height:28, borderRadius:"50%", background:idx===0?C.accent:C.border, color:idx===0?"#fff":C.muted, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Mono', monospace", fontSize:12, fontWeight:700, flexShrink:0 }}>{idx+1}</div>
                        <div style={{ flex:1 }}>
                          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                            <span style={{ fontFamily:"'Crimson Pro', serif", fontSize:14, fontWeight:600, color:C.navy }}>
                              {TYPE_ICON[loan.type]} {loan.name}
                              {idx===0 && <span style={{ fontSize:10, color:C.accent, fontFamily:"'DM Mono', monospace", marginLeft:8 }}>← FOCUS HERE</span>}
                            </span>
                            <span style={{ fontFamily:"'DM Mono', monospace", fontSize:12, fontWeight:600 }}>{fmt(loan.outstanding)}</span>
                          </div>
                          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                            <div style={{ flex:1, height:5, background:"#f0ebe4", borderRadius:3, overflow:"hidden" }}>
                              <div style={{ height:"100%", width:`${pct}%`, background:color, borderRadius:3 }}/>
                            </div>
                            <span style={{ fontSize:10, color:C.muted, fontFamily:"'DM Mono', monospace" }}>{pct}%</span>
                            {loan.interestRate > 0 && <span style={S.tag(color)}>{loan.interestRate}% p.a.</span>}
                            <span style={S.tag("#94a3b8")}>{moStr(loan.monthsLeft)}</span>
                            {loan.emi > 0 && <span style={{ fontSize:10, color:C.muted, fontFamily:"'DM Mono', monospace" }}>EMI {fmtK(loan.emi)}/mo</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={S.panel}>
                  <div style={S.pt}>📉 Outstanding Balance Projection</div>
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={projData} margin={{ top:5, right:16, left:10, bottom:0 }}>
                      <defs>
                        <linearGradient id="dg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#1e2d4a" stopOpacity={0.25}/>
                          <stop offset="95%" stopColor="#1e2d4a" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe4"/>
                      <XAxis dataKey="label" tick={{ fill:"#8c7b6b", fontSize:10, fontFamily:"'DM Mono', monospace" }} axisLine={false} tickLine={false}/>
                      <YAxis tickFormatter={v => fmtK(v)} tick={{ fill:"#8c7b6b", fontSize:10, fontFamily:"'DM Mono', monospace" }} axisLine={false} tickLine={false}/>
                      <Tooltip formatter={v => [fmt(v),"Outstanding"]} contentStyle={{ background:"#fff", border:`1px solid ${C.border}`, borderRadius:6, fontSize:12 }}/>
                      <Area type="monotone" dataKey="total" stroke="#1e2d4a" fill="url(#dg)" strokeWidth={2}/>
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </>
        )}

        {view === "loans" && (
          <>
            {loans.length === 0
              ? <div style={S.empty}><button style={S.addBtn} onClick={openAdd}>+ Add Loan</button></div>
              : loans.map(loan => {
                const color = TYPE_COLOR[loan.type];
                const pct   = loan.originalAmount > 0 ? Math.min(100, Math.round((1 - loan.outstanding/loan.originalAmount)*100)) : 0;
                return (
                  <div key={loan.id} style={{ ...S.lc(color), opacity:loan.active?1:0.6 }}>
                    {(() => {
                      const details = buildLoanSchedule(loan);
                      const yearView = currentYearBreakdown(details.schedule);
                      return (
                        <>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                      <div style={{ flex:1, cursor:"pointer" }} onClick={() => setExpandId(expandId===loan.id?null:loan.id)}>
                        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                          <span style={{ fontSize:18 }}>{TYPE_ICON[loan.type]}</span>
                          <span style={S.ln}>{loan.name}</span>
                          {!loan.active && <span style={S.tag("#16a34a")}>CLEARED ✓</span>}
                        </div>
                        <div style={S.lm}>
                          <span style={S.tag(color)}>{loan.type}</span>
                          <span style={{ fontSize:13, fontWeight:600, color:C.navy, fontFamily:"'DM Mono', monospace" }}>{fmt(loan.outstanding)} left</span>
                          {loan.interestRate > 0 && <span style={{ fontSize:12, color:C.muted, fontFamily:"'DM Mono', monospace" }}>{loan.interestRate}% p.a.</span>}
                          {loan.emi > 0 && <span style={{ fontSize:12, color:C.muted, fontFamily:"'DM Mono', monospace" }}>EMI {fmt(loan.emi)}/mo</span>}
                          {loan.monthsLeft > 0 && <span style={{ fontSize:12, color:C.muted, fontFamily:"'DM Mono', monospace" }}>{moStr(loan.monthsLeft)} left</span>}
                        </div>
                        <div style={S.pb}><div style={{ height:"100%", width:`${pct}%`, background:color, borderRadius:3 }}/></div>
                        <div style={{ fontSize:10, color:C.muted, fontFamily:"'DM Mono', monospace", marginTop:5 }}>
                          {pct}% paid · {fmt(loan.originalAmount - loan.outstanding)} cleared of {fmt(loan.originalAmount)}
                        </div>
                        {expandId===loan.id && (
                          <div style={S.dc}>
                            {loan.notes && <div style={{ marginBottom:12, fontSize:13, color:C.muted, fontStyle:"italic", lineHeight:1.6 }}>{loan.notes}</div>}
                            {details.warnings.map(warning => <div key={warning} style={S.warn}>{warning}</div>)}
                            {yearView ? (
                              <>
                                <div style={{ fontFamily:"'Playfair Display', serif", fontSize:15, color:C.navy, marginBottom:12, fontWeight:600 }}>
                                  {yearView.isFallback ? `Projected repayment snapshot (${yearView.year})` : `Projected ${yearView.year} repayment snapshot`}
                                </div>
                                <div className="detail-grid" style={S.dg}>
                                  <div style={S.ds}>
                                    <div style={S.dsv}>{fmt(yearView.emi)}</div>
                                    <div style={S.dsl}>EMI This Year</div>
                                  </div>
                                  <div style={S.ds}>
                                    <div style={S.dsv}>{fmt(yearView.principal)}</div>
                                    <div style={S.dsl}>Principal This Year</div>
                                  </div>
                                  <div style={S.ds}>
                                    <div style={S.dsv}>{fmt(yearView.interest)}</div>
                                    <div style={S.dsl}>Interest This Year</div>
                                  </div>
                                  <div style={S.ds}>
                                    <div style={S.dsv}>{fmt(yearView.balance)}</div>
                                    <div style={S.dsl}>Balance Left</div>
                                  </div>
                                </div>
                                <div style={{ fontFamily:"'Playfair Display', serif", fontSize:14, color:C.navy, marginBottom:10, fontWeight:600 }}>
                                  Monthly repayment schedule
                                </div>
                                <div style={S.tableW}>
                                  <table style={S.table}>
                                    <thead>
                                      <tr>
                                        <th style={S.th}>Month</th>
                                        <th style={S.th}>EMI</th>
                                        <th style={S.th}>Principal</th>
                                        <th style={S.th}>Interest</th>
                                        <th style={S.th}>Balance</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {details.schedule.map((row, index) => (
                                        <tr key={`${loan.id}-${row.monthLabel}-${index}`}>
                                          <td style={S.td}>{row.monthLabel}</td>
                                          <td style={S.td}>{fmt(row.emi)}</td>
                                          <td style={S.td}>{fmt(row.principal)}</td>
                                          <td style={S.td}>{fmt(row.interest)}</td>
                                          <td style={{ ...S.td, borderBottom:index===details.schedule.length-1 ? "none" : S.td.borderBottom }}>{fmt(row.balance)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </>
                            ) : (
                              <div style={{ fontSize:12, color:C.muted, fontFamily:"'DM Mono', monospace" }}>
                                Add EMI, interest rate, and months remaining to see the monthly breakdown.
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div style={{ display:"flex", gap:6, marginLeft:12, flexShrink:0, marginTop:2 }}>
                        {loan.active && <button style={S.ab("#16a34a")} onClick={() => markPaid(loan.id)}>✓ Cleared</button>}
                        <button style={S.ab("#8c7b6b")} onClick={() => openEdit(loan)}>Edit</button>
                        <button style={S.ab("#dc2626")} onClick={() => delLoan(loan.id)}>✕</button>
                      </div>
                    </div>
                        </>
                      );
                    })()}
                  </div>
                );
              })
            }
          </>
        )}

        {view === "add" && (
          <div style={S.panel}>
            <div style={S.pt}>{editId ? "Edit Loan" : "Add a Loan"}</div>
            <div style={{ marginBottom:14 }}>
              <label style={S.lbl}>Loan Name *</label>
              <input style={S.inp} value={form.name} placeholder="e.g. SBI Home Loan, HDFC Personal, Relative – Raju Bhai…"
                onChange={e => setForm(f => ({ ...f, name:e.target.value }))}/>
            </div>
            <div className="form-grid" style={{ ...S.fg, marginBottom:14 }}>
              <div>
                <label style={S.lbl}>Loan Type</label>
                <select style={S.sel} value={form.type} onChange={e => setForm(f => ({ ...f, type:e.target.value }))}>
                  {TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label style={S.lbl}>Current Outstanding (₹) *</label>
                <input style={S.inp} type="number" value={form.outstanding} placeholder="e.g. 850000"
                  onChange={e => setForm(f => ({ ...f, outstanding:e.target.value }))}/>
              </div>
              <div>
                <label style={S.lbl}>Original / Total Amount (₹)</label>
                <input style={S.inp} type="number" value={form.originalAmount} placeholder="e.g. 1000000"
                  onChange={e => setForm(f => ({ ...f, originalAmount:e.target.value }))}/>
              </div>
              <div>
                <label style={S.lbl}>Interest Rate (% p.a.) — 0 if none</label>
                <input style={S.inp} type="number" value={form.interestRate} placeholder="e.g. 10.5"
                  onChange={e => setForm(f => ({ ...f, interestRate:e.target.value }))}/>
              </div>
              <div>
                <label style={S.lbl}>Monthly EMI (₹)</label>
                <input style={S.inp} type="number" value={form.emi} placeholder="e.g. 12500"
                  onChange={e => setForm(f => ({ ...f, emi:e.target.value }))}/>
              </div>
              <div>
                <label style={S.lbl}>Months Remaining</label>
                <input style={S.inp} type="number" value={form.monthsLeft} placeholder="e.g. 54"
                  onChange={e => setForm(f => ({ ...f, monthsLeft:e.target.value }))}/>
              </div>
            </div>
            <div style={{ marginBottom:20 }}>
              <label style={S.lbl}>Notes (optional)</label>
              <input style={S.inp} value={form.notes} placeholder="e.g. Interest-free, promised by Diwali…"
                onChange={e => setForm(f => ({ ...f, notes:e.target.value }))}/>
            </div>
            <div style={{ display:"flex", gap:10 }}>
              <button style={S.subBtn} onClick={handleSubmit}>{editId ? "Save Changes" : "Add Loan"}</button>
              <button style={S.canBtn} onClick={() => setView(editId?"loans":"dashboard")}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {toast && <div style={S.toast}>{toast}</div>}
    </div>
  );
}
