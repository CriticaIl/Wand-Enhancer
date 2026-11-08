// Trainer stylesheet (lives inside a Shadow DOM, so it cannot leak into the game).
export const TRAINER_CSS = `
:host { all: initial; }
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
.root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; font: 14px/1.35 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; color: #f4f6fb; -webkit-font-smoothing: antialiased; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
input, select, textarea { font: inherit; color: inherit; }
svg { width: 18px; height: 18px; fill: currentColor; flex: 0 0 auto; }

/* panel */
.panel { position: absolute; left: 3vw; top: max(8px, env(safe-area-inset-top)); width: min(360px, 94vw); pointer-events: auto; display: flex; flex-direction: column;
  background: rgba(8, 9, 14, 0.9); border-radius: 6px; overflow: hidden; box-shadow: 0 18px 60px rgba(0,0,0,.65), 0 0 0 1px rgba(255,255,255,.07);
  animation: in .22s cubic-bezier(.2,1.2,.4,1); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); touch-action: manipulation; }
@keyframes in { from { opacity: 0; transform: translateY(-8px) scale(.97); } }
.panel.collapsed .body, .panel.collapsed .desc, .panel.collapsed .tools, .panel.collapsed .sub, .panel.collapsed .sources { display: none; }

/* banner */
.banner { position: relative; height: 64px; display: flex; align-items: center; justify-content: flex-start; padding-left: 16px; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none;
  background: radial-gradient(120% 140% at 0% 0%, #3df5a7 0%, transparent 45%), radial-gradient(120% 140% at 100% 100%, #22d3ee 0%, transparent 50%), linear-gradient(135deg, #0f5132, #0b3d52 55%, #241046); overflow: hidden; }
.banner::after { content: ""; position: absolute; inset: 0; background: repeating-linear-gradient(115deg, rgba(255,255,255,.06) 0 2px, transparent 2px 9px); pointer-events: none; }
.title { font-size: 30px; font-weight: 900; font-style: italic; letter-spacing: .02em; color: #fff; text-shadow: 3px 3px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000; transform: skewX(-6deg); }
.title small { display: block; font-size: 10px; letter-spacing: .5em; text-align: center; font-style: normal; text-shadow: 1px 1px 0 #000; opacity: .95; margin-top: -2px; }
.hbtns { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); display: flex; gap: 4px; z-index: 1; }
.hbtn { width: 32px; height: 32px; border-radius: 8px; background: rgba(0,0,0,.45); display: grid; place-items: center; }
.hbtn svg { width: 16px; height: 16px; }

/* source chips */
.sources { display: flex; gap: 6px; padding: 8px 8px 0; overflow-x: auto; scrollbar-width: none; background: #050608; }
.sources::-webkit-scrollbar { display: none; }
.chip { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; border-radius: 999px; background: #151926; border: 1px solid #262c3d; font-size: 12px; font-weight: 700; white-space: nowrap; }
.chip[aria-pressed=true] { background: #f4f6fb; color: #06070b; border-color: #f4f6fb; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #64748b; }
.dot.live { background: #3df5a7; box-shadow: 0 0 8px #3df5a7; }
.dot.live-generic { background: #a3e635; }
.dot.reload { background: #fbbf24; }
.dot.file { background: #60a5fa; }

/* subheader */
.sub { display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 12px; background: #050608; font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #7dd3fc; }
.sub .crumb { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.sub .count { color: #cbd5e1; font-variant-numeric: tabular-nums; }
.badge { display: inline-flex; align-items: center; gap: 5px; padding: 2px 7px; border-radius: 5px; font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; background: #151926; color: #cbd5e1; white-space: nowrap; }
.badge.live { background: rgba(61,245,167,.15); color: #3df5a7; }
.badge.live-generic { background: rgba(163,230,53,.15); color: #bef264; }
.badge.reload { background: rgba(251,191,36,.15); color: #fbbf24; }
.badge.file { background: rgba(96,165,250,.15); color: #93c5fd; }
.badge.readonly { background: rgba(148,163,184,.15); color: #cbd5e1; }
.badge.high { background: rgba(61,245,167,.15); color: #3df5a7; }
.badge.medium { background: rgba(251,191,36,.15); color: #fbbf24; }
.badge.low, .badge.unknown { background: rgba(251,113,133,.15); color: #fda4af; }

/* virtual list */
.body { position: relative; }
.list { position: relative; height: min(40vh, 468px); overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
.spacer { position: relative; width: 100%; }
.row { position: absolute; left: 0; right: 0; height: 56px; display: flex; align-items: center; gap: 8px; padding: 0 6px 0 12px; background: rgba(0,0,0,.55); border-bottom: 1px solid rgba(255,255,255,.04); }
.row.sel { background: #f4f6fb; color: #06070b; }
.row.sel .sub2, .row.sel .val .orig { color: #475569; }
.row .lbl { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; height: 100%; }
.row .name { font-size: 15px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row .sub2 { font-size: 11.5px; color: #8b95ad; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: ui-monospace, Menlo, monospace; }
.row .star { color: #fbbf24; font-size: 12px; margin-right: 2px; }
.row.edited .name::after { content: " •"; color: #fbbf24; }
.row .nav { display: flex; align-items: center; gap: 6px; color: #94a3b8; font-weight: 700; font-variant-numeric: tabular-nums; }
.row.sel .nav { color: #334155; }
.row .ico { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: rgba(61,245,167,.12); color: #3df5a7; flex: 0 0 auto; }
.row.sel .ico { background: #06070b; }
.val { display: flex; align-items: center; gap: 2px; font-weight: 800; font-variant-numeric: tabular-nums; }
.arrow { width: 34px; height: 40px; display: grid; place-items: center; border-radius: 8px; font-size: 18px; font-weight: 900; }
.arrow:active { background: rgba(127,127,127,.3); }
.num { min-width: 54px; max-width: 108px; height: 36px; padding: 0 6px; border-radius: 7px; display: grid; place-items: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row:not(.sel) .num { background: rgba(255,255,255,.06); }
.row.sel .num { background: rgba(0,0,0,.08); }
.toggle { width: 58px; height: 30px; border-radius: 15px; font-size: 11px; font-weight: 900; letter-spacing: .08em; background: #2a3145; color: #cbd5e1; }
.toggle.on { background: #3df5a7; color: #04140d; }
.text { max-width: 120px; height: 36px; padding: 0 8px; border-radius: 7px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: grid; place-items: center; background: rgba(255,255,255,.06); font-weight: 600; }
.lock { opacity: .6; display: flex; gap: 4px; align-items: center; font-weight: 700; max-width: 120px; overflow: hidden; }
.info { width: 34px; height: 40px; display: grid; place-items: center; border-radius: 8px; color: #7dd3fc; font-weight: 900; font-size: 17px; }
.row.sel .info { color: #0369a1; }
.empty { padding: 26px 16px; text-align: center; color: #94a3b8; }

/* description box (GTA-style) */
.desc { padding: 9px 12px; background: rgba(0,0,0,.8); border-top: 3px solid #3df5a7; font-size: 12.5px; color: #e2e8f0; min-height: 44px; display: flex; gap: 8px; align-items: flex-start; }
.desc .t { flex: 1; }

/* toolbar */
.tools { display: flex; gap: 4px; padding: 6px; background: #050608; }
.tool { flex: 1; min-width: 0; height: 42px; border-radius: 9px; background: #151926; display: flex; align-items: center; justify-content: center; gap: 5px; font-size: 12px; font-weight: 800; }
.tool:disabled { opacity: .35; }
.tool.primary { background: #fbbf24; color: #1b1300; flex: 2; animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 50% { box-shadow: 0 0 0 4px rgba(251,191,36,.25); } }
.tool .n { background: #1b1300; color: #fbbf24; border-radius: 9px; padding: 0 6px; font-size: 11px; }

/* sheets (info / edit / confirm) */
.sheet { height: min(46vh, 520px); overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; padding: 14px; background: rgba(5,6,9,.94); animation: slide .2s ease; }
@keyframes slide { from { opacity: 0; transform: translateX(14px); } }
.sheet h2 { margin: 0 0 4px; font-size: 18px; font-weight: 850; }
.sheet h3 { margin: 14px 0 4px; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: #7dd3fc; }
.sheet p { margin: 4px 0; color: #dbe3f0; }
.sheet ul { margin: 4px 0; padding-left: 18px; color: #dbe3f0; }
.sheet li { margin: 3px 0; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 4px; }
.kv { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; font-size: 13px; }
.kv dt { color: #94a3b8; }
.kv dd { margin: 0; font-family: ui-monospace, Menlo, monospace; overflow-wrap: anywhere; }
.path { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: #8b95ad; overflow-wrap: anywhere; }
.meter { height: 6px; border-radius: 3px; background: #1e2433; overflow: hidden; margin: 6px 0; }
.meter i { display: block; height: 100%; background: linear-gradient(90deg, #fb7185, #fbbf24, #3df5a7); }
.btns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.btn { min-height: 42px; padding: 0 14px; border-radius: 10px; background: #1b2131; font-weight: 800; display: inline-flex; align-items: center; gap: 6px; }
.btn.go { background: #3df5a7; color: #04140d; }
.btn.warn { background: #fbbf24; color: #1b1300; }
.btn.bad { background: rgba(251,113,133,.15); color: #fda4af; }
.field { width: 100%; height: 48px; border-radius: 10px; border: 1px solid #2c3346; background: #0a0c12; padding: 0 12px; font-size: 20px; font-weight: 800; outline: none; font-variant-numeric: tabular-nums; }
.field:focus { border-color: #3df5a7; }
.field.bad { border-color: #fb7185; }
textarea.field { height: 90px; font-size: 15px; padding: 10px 12px; font-weight: 500; }
.quick { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 8px; }
.quick button { height: 40px; border-radius: 9px; background: #151926; font-weight: 800; font-size: 13px; }
.note { font-size: 12px; color: #94a3b8; margin-top: 8px; }
.warnbox { padding: 10px 12px; border-radius: 10px; background: rgba(251,191,36,.1); border: 1px solid rgba(251,191,36,.35); color: #fde68a; font-size: 13px; margin: 8px 0; }
.btn.mini { min-height: 30px; padding: 4px 10px; font-size: 12px; margin: 4px 0 2px 6px; }
.excluded-vars li { margin-bottom: 6px; }
.field.report { min-height: 180px; font: 11px ui-monospace, monospace; }
.okbox { padding: 10px 12px; border-radius: 10px; background: rgba(61,245,167,.1); border: 1px solid rgba(61,245,167,.35); color: #bbf7d0; font-size: 13px; margin: 8px 0; }
.badbox { padding: 10px 12px; border-radius: 10px; background: rgba(251,113,133,.1); border: 1px solid rgba(251,113,133,.35); color: #fecdd3; font-size: 13px; margin: 8px 0; }
.search { padding: 8px; background: #050608; }
.search input { width: 100%; height: 42px; border-radius: 10px; border: 1px solid #2c3346; background: #0a0c12; padding: 0 12px; font-size: 16px; outline: none; }

/* minimized orb */
.orb { position: absolute; right: 14px; bottom: calc(90px + env(safe-area-inset-bottom)); width: 58px; height: 58px; border-radius: 18px; pointer-events: auto; touch-action: none;
  background: conic-gradient(from 210deg, #3df5a7, #22d3ee, #3df5a7); color: #04140d; display: grid; place-items: center; box-shadow: 0 10px 28px rgba(0,0,0,.5), inset 0 0 0 2px rgba(255,255,255,.3); animation: in .2s; }
.orb svg { width: 28px; height: 28px; }
.orb .n { position: absolute; top: -6px; right: -6px; min-width: 22px; height: 22px; border-radius: 11px; background: #fbbf24; color: #1b1300; font-size: 12px; font-weight: 900; line-height: 22px; padding: 0 6px; }
.toast { position: absolute; left: 50%; bottom: calc(24px + env(safe-area-inset-bottom)); transform: translateX(-50%); pointer-events: none; padding: 10px 14px; border-radius: 10px; background: rgba(10,12,18,.95); border: 1px solid #2c3346; font-weight: 700; max-width: 90vw; animation: in .2s; }
.toast.bad { border-color: #fb7185; color: #fecdd3; }
/* verification statuses, compatibility, settings, translations */
.st { display: inline-block; min-width: 16px; margin-right: 4px; font-weight: 900; }
.st-verified { color: #3df5a7; } .st-adjusted { color: #7dd3fc; } .st-reverted, .st-failed { color: #fb7185; } .st-locked { color: #fbbf24; } .st-checking { color: #94a3b8; } .st-reload, .st-export { color: #fbbf24; }
.row.sel .st-verified { color: #047857; } .row.sel .st-reverted, .row.sel .st-failed { color: #be123c; }
.statusbox { padding: 10px 12px; border-radius: 10px; background: #111522; border: 1px solid #262c3d; font-size: 13px; color: #dbe3f0; margin: 6px 0; }
.statusbox b { display: block; margin-bottom: 2px; }
.statusbox.st-verified { border-color: rgba(61,245,167,.45); background: rgba(61,245,167,.08); }
.statusbox.st-adjusted { border-color: rgba(125,211,252,.45); background: rgba(125,211,252,.08); }
.statusbox.st-reverted, .statusbox.st-failed { border-color: rgba(251,113,133,.5); background: rgba(251,113,133,.08); }
.statusbox.st-locked, .statusbox.st-reload, .statusbox.st-export { border-color: rgba(251,191,36,.45); background: rgba(251,191,36,.08); }
.compat { display: flex; align-items: center; gap: 8px; padding: 6px 12px 0; background: #050608; font-size: 11.5px; color: #cbd5e1; }
.cdot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; background: #64748b; }
.cdot.full { background: #3df5a7; box-shadow: 0 0 8px #3df5a7; } .cdot.partial { background: #a3e635; } .cdot.saves { background: #fbbf24; } .cdot.none { background: #fb7185; }
.setrow { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid #1e2433; }
.tr { padding: 8px 0; border-bottom: 1px solid #1e2433; }
/* compact view, search, display refresh, text */
.panel.compact .row { height: 44px; }
.panel.compact .row .sub2 { display: none; }
.panel.compact .arrow, .panel.compact .info { height: 34px; }
.panel.compact .num, .panel.compact .text { height: 30px; }
.num { font-size: 15px; }
.sfield { position: relative; }
.sfield input { padding-right: 46px; -webkit-appearance: none; appearance: none; }
.sfield input::-webkit-search-cancel-button { display: none; }
.clr { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); width: 38px; height: 38px; border-radius: 19px; font-size: 22px; line-height: 38px; color: #cbd5e1; background: #1b2131; }
.filters { display: flex; gap: 6px; margin-top: 8px; overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; padding-bottom: 2px; }
.filters::-webkit-scrollbar { display: none; }
.fchip { flex: 0 0 auto; height: 32px; padding: 0 11px; border-radius: 16px; background: #151926; border: 1px solid #262c3d; font-size: 12.5px; font-weight: 750; white-space: nowrap; }
.fchip.on { background: #f4f6fb; color: #06070b; border-color: #f4f6fb; }
.fsep { flex: 0 0 1px; background: #262c3d; margin: 4px 2px; }
.sinfo { padding: 6px 12px; font-size: 12px; color: #94a3b8; background: #050608; }
.linkbtn { color: #7dd3fc; font-weight: 700; font-size: 12px; padding: 4px 0; }
.sugg { padding: 14px; height: min(30vh, 300px); }
.displine { margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,.08); }
.ds-shown b, .ds-auto b { color: #3df5a7; } .ds-stale b { color: #fbbf24; } .ds-unknown b, .ds-checking b { color: #94a3b8; }
.cand { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px solid #1e2433; }
.cand b { font-family: ui-monospace, Menlo, monospace; font-size: 13px; }
.textval { white-space: pre-wrap; overflow-wrap: anywhere; font-family: inherit; }
.fulltext summary { cursor: pointer; color: #dbe3f0; }
.fulltext .textval { margin-top: 6px; padding: 8px; border-radius: 8px; background: #0f1320; max-height: 40vh; overflow: auto; }
.trbox { margin-top: 8px; }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
`;
