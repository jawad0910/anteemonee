const SUPABASE_URL='https://zkuytvjeqkpexcbyoyhz.supabase.co';
const ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprdXl0dmplcWtwZXhjYnlveWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MjUwNDAsImV4cCI6MjEwMzAwMTA0MH0.8tMbR057BmGaO0_T4nMOVLt1AAmWsPKBEopoSYYis44';
const SERVICE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprdXl0dmplcWtwZXhjYnlveWh6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzQyNTA0MCwiZXhwIjoyMTAzMDAxMDQwfQ.-JhbfB9qVYvHd5Rah8jW6XSFvPwop_YMgJgusYxYn3k';
let db=null;
function getKey(){ try{let h=location.hostname; if(h==='127.0.0.1'||h==='localhost') return SERVICE_KEY;}catch(e){} return ANON_KEY; }
function ensureDb(){ if(!db && window.supabase){ try{db=supabase.createClient(SUPABASE_URL,getKey());}catch(e){} } }
try{ensureDb();}catch(e){}
window.addEventListener('load',ensureDb);
const P='cpanteemonee_v1';
function g(k,d){ try{let v=JSON.parse(localStorage.getItem(P+'_'+k)); return v??d;}catch(e){return d;} }
function s(k,v){ try{localStorage.setItem(P+'_'+k,JSON.stringify(v));}catch(e){} }
function toast(m){ let t=document.getElementById('toast'); if(!t) return; t.textContent=m; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2200); }
function esc(x){ return String(x||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function uid(){ return 'id_'+Date.now()+'_'+Math.floor(Math.random()*9999); }
function isAuth(){ try{ return sessionStorage.getItem('cp_auth')==='1' || localStorage.getItem(P+'_stay')==='1'; }catch(e){return false;} }
function logout(){ try{sessionStorage.removeItem('cp_auth'); localStorage.removeItem(P+'_stay');}catch(e){} location.reload(); }
let usersCache=[],ebooksCache=[],papersCache=[],notesCache=[],fcCache=[],defsCache=[],testsCache=[],keysCache=[],modelsCache=[],coupCache=[],taxCache=[];
(function(){
 try{
  if(!g('ebooks',null)) s('ebooks',[{id:uid(),title:'Physics FSc Part 1',subject:'Physics',class_level:'11th',status:'published'}]);
  if(!g('pastpapers',null)) s('pastpapers',[{id:uid(),type:'yearly',subject:'Physics',board:'BISE Lahore',year:2024,status:'published'}]);
  if(!g('notes',null)) s('notes',[{id:uid(),title:'Enzyme Action',subject:'Biology',chapter:'Ch 3',status:'published'}]);
  if(!g('flashcards',null)) s('flashcards',[{id:uid(),front:'What is enzyme?',back:'Protein catalyst',subject:'Biology'}]);
  if(!g('definitions',null)) s('definitions',[{id:uid(),term:'Osmosis',definition:'Water movement',subject:'Biology'}]);
  if(!g('apikeys',null)) s('apikeys',[{id:uid(),provider:'Groq',key:'gsk_•••',model:'llama-3.1',active:true}]);
  if(!g('models',null)) s('models',[{id:uid(),name:'Chipa Sahab',provider:0,role:'tutor',prompt:'Your name is Chipa Sahab...'}]);
  if(!g('mock_users',null)) s('mock_users',Array.from({length:8}).map((_,i)=>({id:uid(),username:'student'+(100+i),email:'s'+(100+i)+'@ex.com',full_name:'Student '+(100+i),plan_type:i%3===0?'lifetime':'free',subscription_status:i%3===0?'active':'inactive',created_at:new Date(Date.now()-i*86400000).toISOString()})));
 }catch(e){}
})();
function nav(n){
 ensureDb();
 document.querySelectorAll('.cp-nav button').forEach(b=>b.classList.toggle('active',b.dataset.n===n));
 document.querySelectorAll('.cp-section').forEach(x=>x.classList.remove('active'));
 let sec=document.getElementById('sec-'+n); if(sec) sec.classList.add('active');
 let t=document.getElementById('title'); if(t) t.textContent=n;
 if(n==='dash') loadDash();
 if(n==='users') loadUsers();
 if(n==='ebooks') loadEbooks();
 if(n==='papers') loadPapers();
 if(n==='notes') loadNotes();
 if(n==='flashcards') loadFc();
 if(n==='defs') loadDefs();
 if(n==='tests') loadTests();
 if(n==='ai') loadAI();
 if(n==='keys') loadKeys();
 if(n==='voice') loadVoice();
 if(n==='pay') loadCoupons();
 if(n==='boards') loadBoards();
 if(n==='tax') loadTax();
 if(n==='settings') loadSettings();
 let sb=document.getElementById('sidebar'); if(sb) sb.classList.remove('open');
}
function openM(id){ let el=document.getElementById(id); if(el) el.classList.add('open'); }
function closeM(id){ let el=document.getElementById(id); if(el) el.classList.remove('open'); }
document.addEventListener('click',e=>{ if(e.target.classList.contains('cp-modal')) e.target.classList.remove('open'); });
async function loadDash(){
 ensureDb();
 let u=0,paid=0;
 if(db){
  try{let r=await db.from('profiles').select('id',{count:'exact',head:true}); u=r.count||0;}catch(e){}
  try{let r=await db.from('profiles').select('id',{count:'exact',head:true}).eq('plan_type','lifetime'); paid=r.count||0;}catch(e){}
 }
 if(!u) u=g('mock_users',[]).length;
 if(!paid) paid=g('mock_users',[]).filter(x=>x.plan_type==='lifetime').length;
 let su=document.getElementById('s-users'); if(su) su.textContent=u||0;
 let sp=document.getElementById('s-paid'); if(sp) sp.textContent=paid||0;
 let setStat=(id,table,key)=>{
  let el=document.getElementById(id); if(!el) return;
  if(!db){ el.textContent=g(key,[]).length; return; }
  db.from(table).select('id',{count:'exact',head:true}).then(r=>{
   if(r.error) el.textContent=g(key,[]).length;
   else el.textContent=r.count??g(key,[]).length;
  }).catch(()=>{ el.textContent=g(key,[]).length; });
 };
 setStat('s-ebooks','books','ebooks');
 setStat('s-papers','past_papers','pastpapers');
 setStat('s-notes','board_notes','notes');
 setStat('s-fc','flashcards','flashcards');
 setStat('s-defs','definitions','definitions');
 let sk=document.getElementById('s-keys');
 if(sk){
  if(!db) sk.textContent=g('apikeys',[]).filter(x=>x.active).length;
  else db.from('api_keys').select('id',{count:'exact',head:true}).eq('active',true).then(r=>{ sk.textContent=r.count??g('apikeys',[]).filter(x=>x.active).length; }).catch(()=>{ sk.textContent=g('apikeys',[]).filter(x=>x.active).length; });
 }
 try{ let m=document.getElementById('db-mode'); if(m) m.textContent='mode: '+(location.hostname==='127.0.0.1'||location.hostname==='localhost'?'service_role (localhost)':'anon')+' @ '+SUPABASE_URL; }catch(e){}
}
async function loadUsers(){
 ensureDb();
 let tb=document.getElementById('tb-users'); if(!tb) return;
 tb.innerHTML='<tr><td colspan=5 style="text-align:center;padding:20px">loading…</td></tr>';
 if(!db){ usersCache=g('mock_users',[]); renderUsers(); tb.insertAdjacentHTML('beforeend','<tr><td colspan=5 style="color:#FBBF24;font-size:11px;text-align:center">offline — local mock</td></tr>'); return; }
 let res=await db.from('profiles').select('id,username,email,full_name,plan_type,subscription_status,created_at').order('created_at',{ascending:false}).limit(200);
 if(res.error){ usersCache=g('mock_users',[]); renderUsers(); tb.insertAdjacentHTML('beforeend','<tr><td colspan=5 style="color:#F87171;font-size:11px">'+esc(res.error.message)+' — local</td></tr>'); return; }
 usersCache=res.data||[]; if(!usersCache.length) usersCache=g('mock_users',[]); renderUsers();
}
function renderUsers(){
 let qEl=document.getElementById('q-users'); let fEl=document.getElementById('f-users');
 let q=(qEl&&qEl.value||'').toLowerCase(); let f=fEl?fEl.value:'all';
 let d=usersCache.filter(x=>{ if(f!=='all'&&x.plan_type!==f) return false; if(q && !((x.username||'')+(x.email||'')).toLowerCase().includes(q)) return false; return true; });
 let tb=document.getElementById('tb-users'); if(!tb) return;
 tb.innerHTML=d.map(u=>'<tr><td><b>'+esc(u.username||'—')+'</b><div style="color:var(--text-muted);font-size:11px">'+esc(u.email||'')+'</div></td><td><span class="cp-badge '+(u.plan_type==='lifetime'?'on':'')+'">'+esc(u.plan_type||'free')+'</span></td><td>'+esc(u.subscription_status||'')+'</td><td style="font-size:11px">'+(u.created_at||'').slice(0,10)+'</td><td><button class="cp-btn ghost" style="padding:4px 8px" onclick="editUser(\''+u.id+'\')">edit</button> <button class="cp-btn ghost" style="padding:4px 8px" onclick="togglePlan(\''+u.id+'\')">'+(u.plan_type==='lifetime'?'revoke':'grant')+'</button></td></tr>').join('')||'<tr><td colspan=5 style="text-align:center;color:var(--text-muted)">no users</td></tr>';
}
function editUser(id){ let u=usersCache.find(x=>String(x.id)===String(id)); if(!u) return; document.getElementById('mu-id').value=u.id; document.getElementById('mu-name').value=u.username||''; document.getElementById('mu-email').value=u.email||''; document.getElementById('mu-full').value=u.full_name||''; document.getElementById('mu-plan').value=u.plan_type||'free'; document.getElementById('mu-status').value=u.subscription_status||'inactive'; openM('m-user'); }
async function togglePlan(id){ let u=usersCache.find(x=>String(x.id)===String(id)); if(!u) return; let next=u.plan_type==='lifetime'?'free':'lifetime'; let st=next==='lifetime'?'active':'inactive'; if(!db){ u.plan_type=next; u.subscription_status=st; let a=g('mock_users',[]); let i=a.findIndex(x=>String(x.id)===String(id)); if(i>=0) a[i]=u; s('mock_users',a); renderUsers(); return toast('updated (local)'); } let res=await db.from('profiles').update({plan_type:next,subscription_status:st}).eq('id',id); if(res.error){ let a=g('mock_users',[]); let i=a.findIndex(x=>String(x.id)===String(id)); if(i>=0) a[i]=u; s('mock_users',a); toast(res.error.message+' — updated locally'); } else { u.plan_type=next; u.subscription_status=st; } renderUsers(); toast('updated'); }
async function loadEbooks(){
 ensureDb();
 let tb=document.getElementById('tb-ebooks'); if(!tb) return;
 tb.innerHTML='<tr><td colspan=5 style="text-align:center;padding:20px">loading…</td></tr>';
 if(!db){ ebooksCache=g('ebooks',[]); renderEbooks(); return; }
 let res=await db.from('books').select('*').order('created_at',{ascending:false}).limit(200);
 if(res.error){ ebooksCache=g('ebooks',[]); renderEbooks(); tb.insertAdjacentHTML('beforeend','<tr><td colspan=5 style="color:#FBBF24;font-size:11px">'+esc(res.error.message)+' — local</td></tr>'); return; }
 ebooksCache=res.data||[]; if(!ebooksCache.length) ebooksCache=g('ebooks',[]); renderEbooks();
}
function renderEbooks(){ let q=(document.getElementById('q-ebooks')&&document.getElementById('q-ebooks').value||'').toLowerCase(); let d=ebooksCache.filter(x=>!q||(x.title||'').toLowerCase().includes(q)); let tb=document.getElementById('tb-ebooks'); if(!tb) return; tb.innerHTML=d.map(x=>'<tr><td><b>'+esc(x.title)+'</b></td><td>'+esc(x.subject||'')+'</td><td>'+esc(x.class_level||'')+'</td><td><span class="cp-badge '+(x.status==='published'?'on':'')+'">'+esc(x.status||'')+'</span></td><td><button class="cp-btn ghost" style="padding:4px 8px" onclick="editEbook(\''+x.id+'\')">edit</button> <button class="cp-btn ghost danger" style="padding:4px 8px" onclick="delEbook(\''+x.id+'\')">del</button></td></tr>').join('')||'<tr><td colspan=5 style="text-align:center;color:var(--text-muted)">empty</td></tr>'; }
function editEbook(id){ let x=ebooksCache.find(v=>String(v.id)===String(id)); if(!x){ x={id:uid(),title:'',author:'',subject:'General',class_level:'11th',file_url:'',status:'draft'}; ebooksCache.unshift(x);} document.getElementById('me-id').value=x.id; document.getElementById('me-title').value=x.title||''; document.getElementById('me-author').value=x.author||''; document.getElementById('me-subject').value=x.subject||''; document.getElementById('me-class').value=x.class_level||''; document.getElementById('me-file').value=x.file_url||''; document.getElementById('me-status').value=x.status||'draft'; openM('m-ebook'); }
async function delEbook(id){ if(!confirm('delete?')) return; if(!db){ let a=g('ebooks',[]).filter(x=>String(x.id)!==String(id)); s('ebooks',a); ebooksCache=a; renderEbooks(); return toast('deleted (local)'); } let res=await db.from('books').delete().eq('id',id); if(res.error){ let a=g('ebooks',[]).filter(x=>String(x.id)!==String(id)); s('ebooks',a); toast(res.error.message+' — deleted locally'); } ebooksCache=ebooksCache.filter(x=>String(x.id)!==String(id)); renderEbooks(); toast('deleted'); }
let boardsCache=[], subjectsCache=[], classLevelsCache=[], eduCache=[];
async function loadTaxonomyOptions(){
 ensureDb(); if(!db) return;
 if(!boardsCache.length){ let r=await db.from('boards').select('id,name').order('name'); if(!r.error) boardsCache=r.data||[]; }
 if(!subjectsCache.length){ let r=await db.from('subjects').select('id,name').order('name'); if(!r.error) subjectsCache=r.data||[]; }
 if(!classLevelsCache.length){ let r=await db.from('class_levels').select('id,label,value,education_system_id').order('id'); if(!r.error) classLevelsCache=r.data||[]; }
 if(!eduCache.length){ let r=await db.from('education_systems').select('id,name').order('id'); if(!r.error) eduCache=r.data||[]; }
}
function boardName(id){ let b=boardsCache.find(x=>String(x.id)===String(id)); return b?b.name:String(id||'—'); }
function subjectName(id){ let s=subjectsCache.find(x=>String(x.id)===String(id)); return s?s.name:String(id||'—'); }
function className(id){
 let c=classLevelsCache.find(x=>String(x.id)===String(id));
 if(!c) return String(id||'—');
 if(c.value===11) return '11th';
 if(c.value===12) return '12th';
 return c.label||'—';
}
function eduNameById(id){ let e=eduCache.find(x=>String(x.id)===String(id)); return e?e.name:String(id||''); }
async function loadPapers(){
 ensureDb();
 let tb=document.getElementById('tb-papers'); if(!tb) return;
 tb.innerHTML='<tr><td colspan=7 style="text-align:center;padding:20px">loading…</td></tr>';
 await loadTaxonomyOptions();
 if(!db){ papersCache=g('pastpapers',[]); renderPapers(); return; }
 let res=await db.from('past_papers').select('*').order('created_at',{ascending:false}).limit(200);
 if(res.error){ papersCache=g('pastpapers',[]); renderPapers(); tb.insertAdjacentHTML('beforeend','<tr><td colspan=6 style="color:#FBBF24;font-size:11px">'+esc(res.error.message)+' — local fallback</td></tr>'); return; }
 papersCache=res.data||[]; renderPapers();
}
function renderPapers(){
 let q=(document.getElementById('q-papers')&&document.getElementById('q-papers').value||'').toLowerCase();
 let f=(document.getElementById('f-papers')&&document.getElementById('f-papers').value||'all');
 let d=papersCache.filter(x=>{
  let type=(x.paper_type||x.type||'').toLowerCase();
  if(f!=='all'&&type!==f) return false;
  if(q){
   let hay=( (x.title||'')+' '+(boardName(x.board_id))+' '+(subjectName(x.subject_id))+' '+(className(x.class_level_id))+' '+(x.year||'') ).toLowerCase();
   if(!hay.includes(q)) return false;
  }
  return true;
 });
 let tb=document.getElementById('tb-papers'); if(!tb) return;
 if(!d.length){ tb.innerHTML='<tr><td colspan=7 style="text-align:center;color:var(--text-muted);padding:20px">no papers — add one</td></tr>'; return; }
 tb.innerHTML=d.map(x=>'<tr><td><span class="cp-badge">'+esc(x.paper_type||x.type||'—')+'</span></td><td>'+esc(subjectName(x.subject_id)||x.subject||'—')+'<div style="font-size:11px;color:var(--text-muted)">'+esc(x.title||'')+'</div></td><td>'+esc(boardName(x.board_id)||x.board||'—')+'</td><td>'+esc(className(x.class_level_id)||'—')+'</td><td>'+esc(x.year||'')+'</td><td><span class="cp-badge '+(x.status==='published'?'on':'')+'">'+esc(x.status||'')+'</span></td><td><button class="cp-btn ghost" style="padding:4px 8px" onclick="editPaper(\''+x.id+'\')">edit</button> <button class="cp-btn ghost danger" style="padding:4px 8px" onclick="delPaper(\''+x.id+'\')">del</button></td></tr>').join('');
}
async function editPaper(id){
 await loadTaxonomyOptions();
 let x=papersCache.find(v=>String(v.id)===String(id));
 let isNew=!x;
 if(isNew){ x={id:'',title:'',board_id:boardsCache[0]?.id||1,subject_id:subjectsCache[0]?.id||1,class_level_id:classLevelsCache[0]?.id||1,year:new Date().getFullYear(),paper_type:'annual',file_path:'',status:'published'}; }
 // populate selects with system context for class
 let bSel=document.getElementById('mp-board'); if(bSel){ bSel.innerHTML=boardsCache.map(b=>'<option value="'+b.id+'">'+esc(b.name)+'</option>').join(''); bSel.value=String(x.board_id||x.board||boardsCache[0]?.id||''); }
 let sSel=document.getElementById('mp-subject'); if(sSel){ sSel.innerHTML=subjectsCache.map(s=>'<option value="'+s.id+'">'+esc(s.name)+'</option>').join(''); sSel.value=String(x.subject_id||x.subject||subjectsCache[0]?.id||''); }
 let cSel=document.getElementById('mp-class'); if(cSel){
  cSel.innerHTML='<option value="1">11th</option><option value="2">12th</option>';
  let cur=classLevelsCache.find(c=>String(c.id)===String(x.class_level_id));
  let is11=cur?cur.value===11:String(x.class_level_id)==='1'||String(x.class_level).includes('11');
  cSel.value=is11?'1':'2';
 }
 document.getElementById('mp-id').value=x.id||'';
 document.getElementById('mp-title').value=x.title||'';
 document.getElementById('mp-type').value=x.paper_type||x.type||'annual';
 document.getElementById('mp-year').value=x.year||'';
 document.getElementById('mp-file').value=x.file_path||x.file_url||x.source_url||'';
 document.getElementById('mp-status').value=x.status||'published';
 openM('m-paper');
}
async function delPaper(id){ if(!confirm('delete?')) return; if(!db){ let a=g('pastpapers',[]).filter(x=>String(x.id)!==String(id)); s('pastpapers',a); papersCache=a; renderPapers(); return toast('deleted (local)'); } let res=await db.from('past_papers').delete().eq('id',id); if(res.error) return toast(res.error.message); papersCache=papersCache.filter(x=>String(x.id)!==String(id)); renderPapers(); toast('deleted'); }
async function loadNotes(){
 ensureDb();
 let tb=document.getElementById('tb-notes'); if(!tb) return;
 tb.innerHTML='<tr><td colspan=5 style="text-align:center;padding:20px">loading…</td></tr>';
 if(!db){ notesCache=g('notes',[]); renderNotes(); return; }
 let res=await db.from('board_notes').select('*').order('created_at',{ascending:false}).limit(200);
 if(res.error){ notesCache=g('notes',[]); renderNotes(); tb.insertAdjacentHTML('beforeend','<tr><td colspan=5 style="color:#FBBF24;font-size:11px">'+esc(res.error.message)+' — local</td></tr>'); return; }
 notesCache=res.data||[]; if(!notesCache.length) notesCache=g('notes',[]); renderNotes();
}
function renderNotes(){ let q=(document.getElementById('q-notes')&&document.getElementById('q-notes').value||'').toLowerCase(); let d=notesCache.filter(x=>!q||(x.title||'').toLowerCase().includes(q)); let tb=document.getElementById('tb-notes'); if(!tb) return; tb.innerHTML=d.map(x=>'<tr><td><b>'+esc(x.title)+'</b></td><td>'+esc(x.subject||'')+'</td><td>'+esc(x.chapter||'')+'</td><td><span class="cp-badge '+(x.status==='published'?'on':'')+'">'+esc(x.status||'')+'</span></td><td><button class="cp-btn ghost" style="padding:4px 8px" onclick="editNote(\''+x.id+'\')">edit</button> <button class="cp-btn ghost danger" style="padding:4px 8px" onclick="delNote(\''+x.id+'\')">del</button></td></tr>').join('')||'<tr><td colspan=5 style="text-align:center;color:var(--text-muted)">empty</td></tr>'; }
function editNote(id){ let x=notesCache.find(v=>String(v.id)===String(id)); if(!x){ x={id:uid(),title:'',subject:'Biology',chapter:'',content:'',status:'draft'}; notesCache.unshift(x);} document.getElementById('mn-id').value=x.id; document.getElementById('mn-title').value=x.title||''; document.getElementById('mn-subject').value=x.subject||''; document.getElementById('mn-chapter').value=x.chapter||''; document.getElementById('mn-content').value=x.content||''; document.getElementById('mn-status').value=x.status||'draft'; openM('m-note'); }
async function delNote(id){ if(!confirm('delete?')) return; if(!db){ let a=g('notes',[]).filter(x=>String(x.id)!==String(id)); s('notes',a); notesCache=a; renderNotes(); return toast('deleted (local)'); } let res=await db.from('board_notes').delete().eq('id',id); if(res.error){ let a=g('notes',[]).filter(x=>String(x.id)!==String(id)); s('notes',a); toast(res.error.message+' — deleted locally'); } notesCache=notesCache.filter(x=>String(x.id)!==String(id)); renderNotes(); toast('deleted'); }
async function loadFc(){
 ensureDb();
 let tb=document.getElementById('tb-fc'); if(!tb) return;
 tb.innerHTML='<tr><td colspan=4 style="text-align:center;padding:20px">loading…</td></tr>';
 if(!db){ fcCache=g('flashcards',[]); renderFc(); return; }
 let res=await db.from('flashcards').select('id,front,back,subject,box,created_at').order('created_at',{ascending:false}).limit(200);
 if(res.error){ fcCache=g('flashcards',[]); renderFc(); tb.insertAdjacentHTML('beforeend','<tr><td colspan=4 style="color:#FBBF24;font-size:11px">'+esc(res.error.message)+' — local</td></tr>'); return; }
 fcCache=res.data||[]; if(!fcCache.length) fcCache=g('flashcards',[]); renderFc();
}
function renderFc(){ let q=(document.getElementById('q-fc')&&document.getElementById('q-fc').value||'').toLowerCase(); let d=fcCache.filter(x=>!q||(x.front||'').toLowerCase().includes(q)); let tb=document.getElementById('tb-fc'); if(!tb) return; tb.innerHTML=d.map(x=>'<tr><td>'+esc(x.front||'')+'</td><td>'+esc(x.back||'')+'</td><td>'+esc(x.subject||'')+'</td><td><button class="cp-btn ghost" style="padding:4px 8px" onclick="editFc(\''+x.id+'\')">edit</button> <button class="cp-btn ghost danger" style="padding:4px 8px" onclick="delFc(\''+x.id+'\')">del</button></td></tr>').join('')||'<tr><td colspan=4 style="text-align:center;color:var(--text-muted)">empty</td></tr>'; }
function editFc(id){ let x=fcCache.find(v=>String(v.id)===String(id)); if(!x){ x={id:uid(),front:'',back:'',subject:'General'}; fcCache.unshift(x);} document.getElementById('mf-id').value=x.id; document.getElementById('mf-front').value=x.front||''; document.getElementById('mf-back').value=x.back||''; document.getElementById('mf-subject').value=x.subject||''; openM('m-fc'); }
async function delFc(id){ if(!confirm('delete?')) return; if(!db){ let a=g('flashcards',[]).filter(x=>String(x.id)!==String(id)); s('flashcards',a); fcCache=a; renderFc(); return toast('deleted (local)'); } let res=await db.from('flashcards').delete().eq('id',id); if(res.error){ let a=g('flashcards',[]).filter(x=>String(x.id)!==String(id)); s('flashcards',a); toast(res.error.message+' — deleted locally'); } fcCache=fcCache.filter(x=>String(x.id)!==String(id)); renderFc(); toast('deleted'); }
async function loadDefs(){
 ensureDb();
 let tb=document.getElementById('tb-defs'); if(!tb) return;
 tb.innerHTML='<tr><td colspan=4 style="text-align:center;padding:20px">loading…</td></tr>';
 if(!db){ defsCache=g('definitions',[]); renderDefs(); return; }
 let res=await db.from('definitions').select('*').order('created_at',{ascending:false}).limit(200);
 if(res.error){ defsCache=g('definitions',[]); renderDefs(); tb.insertAdjacentHTML('beforeend','<tr><td colspan=4 style="color:#FBBF24;font-size:11px">'+esc(res.error.message)+' — local</td></tr>'); return; }
 defsCache=res.data||[]; if(!defsCache.length) defsCache=g('definitions',[]); renderDefs();
}
function renderDefs(){ let q=(document.getElementById('q-defs')&&document.getElementById('q-defs').value||'').toLowerCase(); let d=defsCache.filter(x=>!q||(x.term||'').toLowerCase().includes(q)); let tb=document.getElementById('tb-defs'); if(!tb) return; tb.innerHTML=d.map(x=>'<tr><td><b>'+esc(x.term)+'</b></td><td>'+esc(x.definition||'')+'</td><td>'+esc(x.subject||'')+'</td><td><button class="cp-btn ghost" style="padding:4px 8px" onclick="editDef(\''+x.id+'\')">edit</button> <button class="cp-btn ghost danger" style="padding:4px 8px" onclick="delDef(\''+x.id+'\')">del</button></td></tr>').join('')||'<tr><td colspan=4 style="text-align:center;color:var(--text-muted)">empty</td></tr>'; }
function editDef(id){ let x=defsCache.find(v=>String(v.id)===String(id)); if(!x){ x={id:uid(),term:'',definition:'',subject:'Biology'}; defsCache.unshift(x);} document.getElementById('md-id').value=x.id; document.getElementById('md-term').value=x.term||''; document.getElementById('md-def').value=x.definition||''; document.getElementById('md-subject').value=x.subject||''; openM('m-def'); }
async function delDef(id){ if(!confirm('delete?')) return; if(!db){ let a=g('definitions',[]).filter(x=>String(x.id)!==String(id)); s('definitions',a); defsCache=a; renderDefs(); return toast('deleted (local)'); } let res=await db.from('definitions').delete().eq('id',id); if(res.error){ let a=g('definitions',[]).filter(x=>String(x.id)!==String(id)); s('definitions',a); toast(res.error.message+' — deleted locally'); } defsCache=defsCache.filter(x=>String(x.id)!==String(id)); renderDefs(); toast('deleted'); }
async function loadTests(){
 ensureDb();
 let tb=document.getElementById('tb-tests'); if(!tb) return;
 tb.innerHTML='<tr><td colspan=5 style="text-align:center;padding:20px">loading…</td></tr>';
 if(!db){ testsCache=g('testbuilder',[]); renderTests(); return; }
 let res=await db.from('test_templates').select('*').order('created_at',{ascending:false}).limit(100);
 if(res.error){ testsCache=g('testbuilder',[]); renderTests(); tb.insertAdjacentHTML('beforeend','<tr><td colspan=5 style="color:#FBBF24;font-size:11px">'+esc(res.error.message)+' — local</td></tr>'); return; }
 testsCache=res.data||[]; if(!testsCache.length) testsCache=g('testbuilder',[]); renderTests();
}
function renderTests(){ let tb=document.getElementById('tb-tests'); if(!tb) return; tb.innerHTML=testsCache.map(x=>'<tr><td>'+esc(x.title||'')+'</td><td>'+esc(x.subject||'')+'</td><td>'+(x.questions||'')+'</td><td>'+esc(x.difficulty||'')+'</td><td><button class="cp-btn ghost" style="padding:4px 8px" onclick="editTest(\''+x.id+'\')">edit</button> <button class="cp-btn ghost danger" style="padding:4px 8px" onclick="delTest(\''+x.id+'\')">del</button></td></tr>').join('')||'<tr><td colspan=5 style="text-align:center;color:var(--text-muted)">empty</td></tr>'; }
function editTest(id){ let x=testsCache.find(v=>String(v.id)===String(id)); if(!x){ x={id:uid(),title:'',subject:'Physics',questions:20,difficulty:'medium'}; testsCache.unshift(x);} document.getElementById('mt-id').value=x.id; document.getElementById('mt-title').value=x.title||''; document.getElementById('mt-subject').value=x.subject||''; document.getElementById('mt-qs').value=x.questions||20; document.getElementById('mt-diff').value=x.difficulty||'medium'; openM('m-test'); }
async function delTest(id){ if(!confirm('delete?')) return; if(!db){ let a=g('testbuilder',[]).filter(x=>String(x.id)!==String(id)); s('testbuilder',a); testsCache=a; renderTests(); return toast('deleted (local)'); } let res=await db.from('test_templates').delete().eq('id',id); if(res.error){ let a=g('testbuilder',[]).filter(x=>String(x.id)!==String(id)); s('testbuilder',a); toast(res.error.message+' — deleted locally'); } testsCache=testsCache.filter(x=>String(x.id)!==String(id)); renderTests(); toast('deleted'); }
async function loadAI(){
 ensureDb();
 if(!db){ modelsCache=g('models',[]); renderAI(); return; }
 let res=await db.from('ai_models').select('*').order('created_at',{ascending:false});
 if(res.error){ modelsCache=g('models',[]); renderAI(); let el=document.getElementById('ai-list'); if(el) el.insertAdjacentHTML('beforeend','<div style="color:#FBBF24;font-size:11px">'+esc(res.error.message)+' — local</div>'); return; }
 modelsCache=res.data||[]; if(!modelsCache.length) modelsCache=g('models',[]); renderAI();
}
function renderAI(){ let el=document.getElementById('ai-list'); if(!el) return; el.innerHTML=modelsCache.map(x=>'<div class="cp-card"><b>'+esc(x.name||'')+'</b> <span style="font-size:11px;color:var(--text-muted)">'+esc(x.role||'')+' · '+(x.provider_index??'')+'</span><div style="font-size:11px;color:var(--text-secondary);margin:6px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc((x.system_prompt||'').slice(0,80))+'</div><div style="display:flex;gap:6px"><button class="cp-btn ghost" style="padding:4px 8px" onclick="editModel(\''+x.id+'\')">edit</button><button class="cp-btn ghost danger" style="padding:4px 8px" onclick="delModel(\''+x.id+'\')">del</button></div></div>').join('')||'<div style="color:var(--text-muted)">empty</div>'; let prov=document.getElementById('ai-prov'); if(prov) prov.value=g('ai_prov',0); let urlEl=document.getElementById('ai-url'); if(urlEl) urlEl.value=g('ai_url','https://zkuytvjeqkpexcbyoyhz.supabase.co/functions/v1/ai-chat'); }
function editModel(id){ let x=modelsCache.find(v=>String(v.id)===String(id)); if(!x){ x={id:uid(),name:'',role:'',provider_index:0,system_prompt:''}; modelsCache.unshift(x);} document.getElementById('mm-id').value=x.id; document.getElementById('mm-name').value=x.name||''; document.getElementById('mm-role').value=x.role||''; document.getElementById('mm-prov').value=x.provider_index||0; document.getElementById('mm-prompt').value=x.system_prompt||''; openM('m-model'); }
async function delModel(id){ if(!confirm('delete?')) return; if(!db){ let a=g('models',[]).filter(x=>String(x.id)!==String(id)); s('models',a); modelsCache=a; renderAI(); return toast('deleted (local)'); } let res=await db.from('ai_models').delete().eq('id',id); if(res.error){ let a=g('models',[]).filter(x=>String(x.id)!==String(id)); s('models',a); toast(res.error.message+' — deleted locally'); } modelsCache=modelsCache.filter(x=>String(x.id)!==String(id)); renderAI(); toast('deleted'); }
function saveAI(){ s('ai_prov',parseInt(document.getElementById('ai-prov').value)||0); s('ai_url',document.getElementById('ai-url').value); toast('saved'); }
async function loadKeys(){
 ensureDb();
 let tb=document.getElementById('tb-keys'); if(!tb) return;
 tb.innerHTML='<tr><td colspan=5 style="text-align:center;padding:20px">loading…</td></tr>';
 if(!db){ keysCache=g('apikeys',[]); renderKeys(); return; }
 let res=await db.from('api_keys').select('*').order('created_at',{ascending:false});
 if(res.error){ keysCache=g('apikeys',[]); renderKeys(); tb.insertAdjacentHTML('beforeend','<tr><td colspan=5 style="color:#FBBF24;font-size:11px">'+esc(res.error.message)+' — local</td></tr>'); return; }
 keysCache=res.data||[]; if(!keysCache.length) keysCache=g('apikeys',[]); renderKeys();
}
function renderKeys(){ let tb=document.getElementById('tb-keys'); if(!tb) return; tb.innerHTML=keysCache.map(x=>'<tr><td><b>'+esc(x.provider||'')+'</b></td><td style="font-family:monospace;font-size:11px">'+esc(x.key_masked||x.key||'')+'</td><td>'+esc(x.model||'')+'</td><td><span class="cp-badge '+(x.active?'on':'')+'">'+(x.active?'on':'off')+'</span></td><td><button class="cp-btn ghost" style="padding:4px 8px" onclick="editKey(\''+x.id+'\')">edit</button> <button class="cp-btn ghost" style="padding:4px 8px" onclick="toggleKey(\''+x.id+'\')">toggle</button> <button class="cp-btn ghost danger" style="padding:4px 8px" onclick="delKey(\''+x.id+'\')">del</button></td></tr>').join('')||'<tr><td colspan=5 style="text-align:center;color:var(--text-muted)">empty</td></tr>'; }
function editKey(id){ let x=keysCache.find(v=>String(v.id)===String(id)); if(!x){ x={id:uid(),provider:'Groq',key_masked:'',model:'',active:true}; keysCache.unshift(x);} document.getElementById('mk-id').value=x.id; document.getElementById('mk-prov').value=x.provider; document.getElementById('mk-key').value=x.key_masked||''; document.getElementById('mk-model').value=x.model||''; document.getElementById('mk-on').checked=x.active; openM('m-key'); }
async function delKey(id){ if(!confirm('delete?')) return; if(!db){ let a=g('apikeys',[]).filter(x=>String(x.id)!==String(id)); s('apikeys',a); keysCache=a; renderKeys(); return toast('deleted (local)'); } let res=await db.from('api_keys').delete().eq('id',id); if(res.error){ let a=g('apikeys',[]).filter(x=>String(x.id)!==String(id)); s('apikeys',a); toast(res.error.message+' — deleted locally'); } keysCache=keysCache.filter(x=>String(x.id)!==String(id)); renderKeys(); toast('deleted'); }
async function toggleKey(id){ let x=keysCache.find(v=>String(v.id)===String(id)); if(!x) return; if(!db){ x.active=!x.active; let a=g('apikeys',[]); let i=a.findIndex(v=>String(v.id)===String(id)); if(i>=0) a[i]=x; s('apikeys',a); renderKeys(); return toast('toggled (local)'); } let res=await db.from('api_keys').update({active:!x.active}).eq('id',id); if(res.error){ x.active=!x.active; let a=g('apikeys',[]); let i=a.findIndex(v=>String(v.id)===String(id)); if(i>=0) a[i]=x; s('apikeys',a); toast(res.error.message+' — toggled locally'); } else x.active=!x.active; renderKeys(); toast('toggled'); }
async function loadVoice(){
 ensureDb();
 let v1=g('v_openai',''), v2=g('v_gemini',''), t1=g('v_tts','alloy'), s1=g('v_stt','whisper-1');
 let o=document.getElementById('v-openai'); if(o) o.value=v1;
 let gm=document.getElementById('v-gemini'); if(gm) gm.value=v2;
 let tts=document.getElementById('v-tts'); if(tts) tts.value=t1;
 let stt=document.getElementById('v-stt'); if(stt) stt.value=s1;
 if(db){ try{let res=await db.from('user_call_keys').select('user_id,openai_key,gemini_key').limit(1); if(res.data&&res.data[0]&&o) o.placeholder=res.data[0].openai_key?'has key (masked)':'no key';}catch(e){} }
}
function saveVoice(){ s('v_openai',document.getElementById('v-openai').value); s('v_gemini',document.getElementById('v-gemini').value); s('v_tts',document.getElementById('v-tts').value); s('v_stt',document.getElementById('v-stt').value); toast('saved locally — set Edge secrets for prod'); }
async function loadCoupons(){
 ensureDb();
 let tb=document.getElementById('tb-coupons'); if(!tb) return;
 tb.innerHTML='<tr><td colspan=6 style="text-align:center;padding:20px">loading…</td></tr>';
 if(!db){ coupCache=g('coupons',[]); renderCoupons(); return; }
 let res=await db.from('coupons').select('*').order('created_at',{ascending:false}).limit(100);
 if(res.error){ coupCache=g('coupons',[]); renderCoupons(); tb.insertAdjacentHTML('beforeend','<tr><td colspan=6 style="color:#FBBF24;font-size:11px">'+esc(res.error.message)+' — local</td></tr>'); return; }
 coupCache=res.data||[]; if(!coupCache.length) coupCache=g('coupons',[]); renderCoupons();
}
function renderCoupons(){ let tb=document.getElementById('tb-coupons'); if(!tb) return; tb.innerHTML=coupCache.map(x=>'<tr><td><b>'+esc(x.code||'')+'</b></td><td>'+(x.discount||'')+'%</td><td>'+(x.used||0)+'/'+(x.max_uses||'—')+'</td><td>'+esc((x.expires_at||'').slice(0,10))+'</td><td><span class="cp-badge '+(x.active?'on':'')+'">'+(x.active?'on':'off')+'</span></td><td><button class="cp-btn ghost" style="padding:4px 8px" onclick="editCoupon(\''+x.id+'\')">edit</button> <button class="cp-btn ghost danger" style="padding:4px 8px" onclick="delCoupon(\''+x.id+'\')">del</button></td></tr>').join('')||'<tr><td colspan=6 style="text-align:center;color:var(--text-muted)">empty</td></tr>'; }
function editCoupon(id){ let x=coupCache.find(v=>String(v.id)===String(id)); if(!x){ x={id:uid(),code:'',discount:10,expires_at:'',active:true}; coupCache.unshift(x);} document.getElementById('mc-id').value=x.id; document.getElementById('mc-code').value=x.code||''; document.getElementById('mc-disc').value=x.discount||10; document.getElementById('mc-exp').value=(x.expires_at||'').slice(0,10); document.getElementById('mc-on').checked=x.active; openM('m-coupon'); }
async function delCoupon(id){ if(!confirm('delete?')) return; if(!db){ let a=g('coupons',[]).filter(x=>String(x.id)!==String(id)); s('coupons',a); coupCache=a; renderCoupons(); return toast('deleted (local)'); } let res=await db.from('coupons').delete().eq('id',id); if(res.error){ let a=g('coupons',[]).filter(x=>String(x.id)!==String(id)); s('coupons',a); toast(res.error.message+' — deleted locally'); } coupCache=coupCache.filter(x=>String(x.id)!==String(id)); renderCoupons(); toast('deleted'); }
async function loadTax(){
 ensureDb();
 let tb=document.getElementById('tb-tax'); if(!tb) return;
 tb.innerHTML='<tr><td colspan=4 style="text-align:center;padding:20px">loading…</td></tr>';
 if(!db){ taxCache=g('taxonomy',[]); renderTaxFromCache(); return; }
 let f=(document.getElementById('f-tax')&&document.getElementById('f-tax').value||'all');
 let type=f==='all'?'boards':f;
 let table={board:'boards',class_level:'class_levels',subject:'subjects',education_system:'education_systems',group:'groups'}[type]||'boards';
 let res=await db.from(table).select('*').limit(100);
 if(res.error){ taxCache=g('taxonomy',[]); renderTaxFromCache(); tb.insertAdjacentHTML('beforeend','<tr><td colspan=4 style="color:#FBBF24;font-size:11px">'+esc(res.error.message)+' — local</td></tr>'); return; }
 taxCache=res.data||[]; if(!taxCache.length) taxCache=g('taxonomy',[]); renderTaxFromCache();
}
function renderTax(){ loadTax(); }
function renderTaxFromCache(){ let q=(document.getElementById('q-tax')&&document.getElementById('q-tax').value||'').toLowerCase(); let d=taxCache.filter(x=>!q||JSON.stringify(x).toLowerCase().includes(q)); let tb=document.getElementById('tb-tax'); if(!tb) return; tb.innerHTML=d.map(x=>'<tr><td>'+esc(document.getElementById('f-tax').value)+'</td><td>'+esc(x.name||x.label||'—')+'</td><td>'+esc(x.code||x.id||'')+'</td><td><button class="cp-btn ghost" style="padding:4px 8px" onclick="editTax(\''+x.id+'\')">edit</button> <button class="cp-btn ghost danger" style="padding:4px 8px" onclick="delTax(\''+x.id+'\')">del</button></td></tr>').join('')||'<tr><td colspan=4 style="text-align:center;color:var(--text-muted)">empty</td></tr>'; }
function editTax(id){ let x=taxCache.find(v=>String(v.id)===String(id)); if(!x){ x={id:uid(),name:'',code:''};} document.getElementById('mx-id').value=x.id; document.getElementById('mx-type').value=document.getElementById('f-tax').value; document.getElementById('mx-name').value=x.name||x.label||''; document.getElementById('mx-code').value=x.code||''; openM('m-tax'); }
async function delTax(id){ if(!confirm('delete?')) return; if(!db){ let a=g('taxonomy',[]).filter(x=>String(x.id)!==String(id)); s('taxonomy',a); taxCache=a; renderTaxFromCache(); return toast('deleted (local)'); } let table={board:'boards',class_level:'class_levels',subject:'subjects',education_system:'education_systems',group:'groups'}[document.getElementById('f-tax').value]||'boards'; let res=await db.from(table).delete().eq('id',id); if(res.error){ let a=g('taxonomy',[]).filter(x=>String(x.id)!==String(id)); s('taxonomy',a); toast(res.error.message+' — deleted locally'); } taxCache=taxCache.filter(x=>String(x.id)!==String(id)); renderTaxFromCache(); toast('deleted'); }
async function loadBoards(){
 ensureDb();
 let tb=document.getElementById('tb-boards'); if(!tb) return;
 tb.innerHTML='<tr><td colspan=4 style="text-align:center;padding:20px">loading…</td></tr>';
 if(!db){ tb.innerHTML='<tr><td colspan=4 style="text-align:center;color:var(--text-muted)">no db</td></tr>'; return; }
 let res=await db.from('boards').select('id,name,region,is_active').order('name');
 if(res.error){ tb.innerHTML='<tr><td colspan=4 style="color:#F87171">'+esc(res.error.message)+'</td></tr>'; return; }
 boardsCache=res.data||[];
 let q=(document.getElementById('q-boards')&&document.getElementById('q-boards').value||'').toLowerCase();
 let d=boardsCache.filter(x=>!q||x.name.toLowerCase().includes(q));
 tb.innerHTML=d.map(x=>'<tr><td>'+x.id+'</td><td><b>'+esc(x.name)+'</b></td><td>'+esc(x.region||'')+'</td><td><button class="cp-btn ghost" style="padding:4px 8px" onclick="editBoard(\''+x.id+'\')">edit</button> <button class="cp-btn ghost danger" style="padding:4px 8px" onclick="delBoard(\''+x.id+'\')">del</button></td></tr>').join('')||'<tr><td colspan=4 style="text-align:center;color:var(--text-muted)">no boards</td></tr>';
}
function editBoard(id){
 let x=boardsCache.find(v=>String(v.id)===String(id));
 if(!x){ x={id:'',name:'',region:''}; }
 document.getElementById('mb-id').value=x.id||'';
 document.getElementById('mb-name').value=x.name||'';
 document.getElementById('mb-region').value=x.region||'';
 openM('m-board');
}
async function delBoard(id){ if(!confirm('delete board?')) return; if(!db) return toast('no db'); let res=await db.from('boards').delete().eq('id',id); if(res.error) return toast(res.error.message); toast('deleted'); loadBoards(); loadTaxonomyOptions(); }
function loadSettings(){ let v=document.getElementById('set-ver'); if(v) v.value=g('site_ver','1.0.9'); let m=document.getElementById('set-maint'); if(m) m.checked=g('maint',false); let a=document.getElementById('set-ann'); if(a) a.value=g('ann',''); let st=document.getElementById('set-stats'); if(st) st.value=JSON.stringify(g('home_stats',{user_count:1284}),null,2); }
function saveSettings(){ let v=document.getElementById('set-ver'); if(v) s('site_ver',v.value); let m=document.getElementById('set-maint'); if(m) s('maint',m.checked); let a=document.getElementById('set-ann'); if(a) s('ann',a.value); let st=document.getElementById('set-stats'); if(st){ try{s('home_stats',JSON.parse(st.value));}catch(e){return toast('bad json');} } toast('saved'); }
function exportJSON(){ let o={}; ['ebooks','pastpapers','notes','flashcards','definitions','testbuilder'].forEach(k=>o[k]=g(k,[])); let b=new Blob([JSON.stringify(o,null,2)],{type:'application/json'}); let a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download='cp-'+new Date().toISOString().slice(0,10)+'.json'; a.click(); }
function importJSON(e){ let f=e.target.files[0]; if(!f) return; let r=new FileReader(); r.onload=()=>{ try{let j=JSON.parse(r.result); Object.keys(j).forEach(k=>s(k,j[k])); toast('imported'); loadDash(); }catch(e){toast('bad file');} }; r.readAsText(f); }
function initGate(){ let gate=document.getElementById('gate'),app=document.getElementById('app'); if(!gate||!app) return; if(isAuth()){gate.style.display='none';app.style.display='flex';loadDash();}else{gate.style.display='block';app.style.display='none';} }
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',initGate); else initGate();
function initForms(){ let gate=document.getElementById('gate'),app=document.getElementById('app'); if(!gate||!app) return; let form=document.getElementById('login'); if(form&&!form.dataset.bound){ form.dataset.bound='1'; form.addEventListener('submit',e=>{e.preventDefault();let u=document.getElementById('u').value.trim(),p=document.getElementById('p').value;if(u==='admin'&&p==='Anteemonee@2026'){try{sessionStorage.setItem('cp_auth','1'); if(document.getElementById('stay').checked) localStorage.setItem(P+'_stay','1');}catch(e){} gate.style.display='none';app.style.display='flex';loadDash();toast('logged in');}else{let er=document.getElementById('err'); if(er){er.style.display='block';er.textContent='wrong login — use admin / Anteemonee@2026';}}}); } }
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',initForms); else initForms();
function initMain(){
 document.querySelectorAll('.cp-nav button').forEach(b=>{if(!b.dataset.bound){b.dataset.bound='1';b.addEventListener('click',()=>nav(b.dataset.n));}});
 let upLocal=(k,o)=>{let a=g(k,[]),i=a.findIndex(x=>String(x.id)===String(o.id)); if(i>=0) a[i]={...a[i],...o}; else a.unshift(o); s(k,a); };
 let fUser=document.getElementById('f-user'); if(fUser) fUser.addEventListener('submit',async e=>{e.preventDefault();let id=document.getElementById('mu-id').value;let upd={username:document.getElementById('mu-name').value,email:document.getElementById('mu-email').value,full_name:document.getElementById('mu-full').value,plan_type:document.getElementById('mu-plan').value,subscription_status:document.getElementById('mu-status').value}; if(!db){ let a=g('mock_users',[]),i=a.findIndex(x=>String(x.id)===String(id)); if(i>=0) Object.assign(a[i],upd); s('mock_users',a); closeM('m-user'); loadUsers(); return toast('saved (local)'); } let res=await db.from('profiles').update(upd).eq('id',id); if(res.error){ let a=g('mock_users',[]),i=a.findIndex(x=>String(x.id)===String(id)); if(i>=0) Object.assign(a[i],upd); s('mock_users',a); toast(res.error.message+' — saved locally'); } closeM('m-user'); loadUsers(); toast('saved');});
 let fEbook=document.getElementById('f-ebook'); if(fEbook) fEbook.addEventListener('submit',async e=>{e.preventDefault();let p={id:document.getElementById('me-id').value,title:document.getElementById('me-title').value,author:document.getElementById('me-author').value,subject:document.getElementById('me-subject').value,class_level:document.getElementById('me-class').value,file_url:document.getElementById('me-file').value,status:document.getElementById('me-status').value}; if(!db){ upLocal('ebooks',p); closeM('m-ebook'); loadEbooks(); return toast('saved (local)'); } let res=await db.from('books').upsert(p,{onConflict:'id'}); if(res.error){ upLocal('ebooks',p); toast(res.error.message+' — saved locally'); } closeM('m-ebook'); loadEbooks(); toast('saved');});
 let fPaper=document.getElementById('f-paper'); if(fPaper) fPaper.addEventListener('submit',async e=>{
  e.preventDefault();
  let id=document.getElementById('mp-id').value.trim();
  let payload={
   title:document.getElementById('mp-title').value.trim()||'Untitled Paper',
   board_id:parseInt(document.getElementById('mp-board').value)||null,
   subject_id:parseInt(document.getElementById('mp-subject').value)||null,
   class_level_id:parseInt(document.getElementById('mp-class').value)||null,
   year:parseInt(document.getElementById('mp-year').value)||null,
   paper_type:document.getElementById('mp-type').value||'annual',
   file_path:document.getElementById('mp-file').value.trim()||'',
   status:document.getElementById('mp-status').value||'published'
  };
  if(!payload.year) return toast('year required');
  if(!db){
   let local={id:uid(),...payload,board:boardName(payload.board_id),subject:subjectName(payload.subject_id),type:payload.paper_type,file_url:payload.file_path,created_at:new Date().toISOString()};
   upLocal('pastpapers',local); closeM('m-paper'); loadPapers(); return toast('saved (local)');
  }
  let res;
  if(!id){ res=await db.from('past_papers').insert(payload).select().single(); }
  else { res=await db.from('past_papers').update(payload).eq('id',id).select().single(); }
  if(res.error){ toast(res.error.message); return; }
  closeM('m-paper'); await loadPapers(); toast('saved');
 });
 let fNote=document.getElementById('f-note'); if(fNote) fNote.addEventListener('submit',async e=>{e.preventDefault();let p={id:document.getElementById('mn-id').value,title:document.getElementById('mn-title').value,subject:document.getElementById('mn-subject').value,chapter:document.getElementById('mn-chapter').value,content:document.getElementById('mn-content').value,status:document.getElementById('mn-status').value}; if(!db){ upLocal('notes',p); closeM('m-note'); loadNotes(); return toast('saved (local)'); } let res=await db.from('board_notes').upsert(p,{onConflict:'id'}); if(res.error){ upLocal('notes',p); toast(res.error.message+' — saved locally'); } closeM('m-note'); loadNotes(); toast('saved');});
 let fFc=document.getElementById('f-fc'); if(fFc) fFc.addEventListener('submit',async e=>{e.preventDefault();let p={id:document.getElementById('mf-id').value,front:document.getElementById('mf-front').value,back:document.getElementById('mf-back').value,subject:document.getElementById('mf-subject').value}; if(!db){ upLocal('flashcards',p); closeM('m-fc'); loadFc(); return toast('saved (local)'); } let res=await db.from('flashcards').upsert(p,{onConflict:'id'}); if(res.error){ upLocal('flashcards',p); toast(res.error.message+' — saved locally'); } closeM('m-fc'); loadFc(); toast('saved');});
 let fDef=document.getElementById('f-def'); if(fDef) fDef.addEventListener('submit',async e=>{e.preventDefault();let p={id:document.getElementById('md-id').value,term:document.getElementById('md-term').value,definition:document.getElementById('md-def').value,subject:document.getElementById('md-subject').value}; if(!db){ upLocal('definitions',p); closeM('m-def'); loadDefs(); return toast('saved (local)'); } let res=await db.from('definitions').upsert(p,{onConflict:'id'}); if(res.error){ upLocal('definitions',p); toast(res.error.message+' — saved locally'); } closeM('m-def'); loadDefs(); toast('saved');});
 let fTest=document.getElementById('f-test'); if(fTest) fTest.addEventListener('submit',async e=>{e.preventDefault();let p={id:document.getElementById('mt-id').value,title:document.getElementById('mt-title').value,subject:document.getElementById('mt-subject').value,questions:parseInt(document.getElementById('mt-qs').value)||20,difficulty:document.getElementById('mt-diff').value}; if(!db){ upLocal('testbuilder',p); closeM('m-test'); loadTests(); return toast('saved (local)'); } let res=await db.from('test_templates').upsert(p,{onConflict:'id'}); if(res.error){ upLocal('testbuilder',p); toast(res.error.message+' — saved locally'); } closeM('m-test'); loadTests(); toast('saved');});
 let fModel=document.getElementById('f-model'); if(fModel) fModel.addEventListener('submit',async e=>{e.preventDefault();let p={id:document.getElementById('mm-id').value,name:document.getElementById('mm-name').value,role:document.getElementById('mm-role').value,provider_index:parseInt(document.getElementById('mm-prov').value)||0,system_prompt:document.getElementById('mm-prompt').value}; if(!db){ upLocal('models',p); closeM('m-model'); loadAI(); return toast('saved (local)'); } let res=await db.from('ai_models').upsert(p,{onConflict:'id'}); if(res.error){ upLocal('models',p); toast(res.error.message+' — saved locally'); } closeM('m-model'); loadAI(); toast('saved');});
 let fKey=document.getElementById('f-key'); if(fKey) fKey.addEventListener('submit',async e=>{e.preventDefault();let p={id:document.getElementById('mk-id').value,provider:document.getElementById('mk-prov').value,key_masked:document.getElementById('mk-key').value,model:document.getElementById('mk-model').value,active:document.getElementById('mk-on').checked}; if(!db){ upLocal('apikeys',p); closeM('m-key'); loadKeys(); return toast('saved (local)'); } let res=await db.from('api_keys').upsert(p,{onConflict:'id'}); if(res.error){ upLocal('apikeys',p); toast(res.error.message+' — saved locally'); } closeM('m-key'); loadKeys(); toast('saved');});
 let fCoupon=document.getElementById('f-coupon'); if(fCoupon) fCoupon.addEventListener('submit',async e=>{e.preventDefault();let p={id:document.getElementById('mc-id').value,code:document.getElementById('mc-code').value.toUpperCase(),discount:parseInt(document.getElementById('mc-disc').value)||0,expires_at:document.getElementById('mc-exp').value||null,active:document.getElementById('mc-on').checked}; if(!db){ upLocal('coupons',p); closeM('m-coupon'); loadCoupons(); return toast('saved (local)'); } let res=await db.from('coupons').upsert(p,{onConflict:'id'}); if(res.error){ upLocal('coupons',p); toast(res.error.message+' — saved locally'); } closeM('m-coupon'); loadCoupons(); toast('saved');});
 let fTax=document.getElementById('f-tax'); if(fTax) fTax.addEventListener('submit',async e=>{e.preventDefault();let t=document.getElementById('mx-type').value,table={board:'boards',class_level:'class_levels',subject:'subjects'}[t]||'boards';let p={id:document.getElementById('mx-id').value,name:document.getElementById('mx-name').value,code:document.getElementById('mx-code').value}; if(!db){ upLocal('taxonomy',p); closeM('m-tax'); loadTax(); return toast('saved (local)'); } let res=await db.from(table).upsert(p,{onConflict:'id'}); if(res.error){ upLocal('taxonomy',p); toast(res.error.message+' — saved locally'); } closeM('m-tax'); loadTax(); toast('saved');});
 let fBoard=document.getElementById('f-board'); if(fBoard) fBoard.addEventListener('submit',async e=>{e.preventDefault();let id=document.getElementById('mb-id').value.trim();let payload={name:document.getElementById('mb-name').value.trim(),region:document.getElementById('mb-region').value.trim()||'Punjab'}; if(!payload.name) return toast('name required'); if(!id){ let res=await db.from('boards').insert(payload).select().single(); if(res.error) return toast(res.error.message); } else { let res=await db.from('boards').update(payload).eq('id',id); if(res.error) return toast(res.error.message); } closeM('m-board'); await loadBoards(); await loadTaxonomyOptions(); toast('saved'); });
 let qBoards=document.getElementById('q-boards'); if(qBoards) qBoards.addEventListener('input',()=>{ let tb=document.getElementById('tb-boards'); if(!tb) return; let q=qBoards.value.toLowerCase(); let d=boardsCache.filter(x=>!q||x.name.toLowerCase().includes(q)); tb.innerHTML=d.map(x=>'<tr><td>'+x.id+'</td><td><b>'+esc(x.name)+'</b></td><td>'+esc(x.region||'')+'</td><td><button class="cp-btn ghost" style="padding:4px 8px" onclick="editBoard(\''+x.id+'\')">edit</button> <button class="cp-btn ghost danger" style="padding:4px 8px" onclick="delBoard(\''+x.id+'\')">del</button></td></tr>').join('')||'<tr><td colspan=4 style="text-align:center;color:var(--text-muted)">no boards</td></tr>'; });
 let qs=['q-users','q-ebooks','q-papers','q-notes','q-fc','q-defs','q-tax']; qs.forEach(id=>{ let el=document.getElementById(id); if(el) el.addEventListener('input',()=>{ if(id==='q-users')renderUsers(); if(id==='q-ebooks')renderEbooks(); if(id==='q-papers')renderPapers(); if(id==='q-notes')renderNotes(); if(id==='q-fc')renderFc(); if(id==='q-defs')renderDefs(); if(id==='q-tax')renderTaxFromCache(); }); });
 let fu=document.getElementById('f-users'); if(fu) fu.addEventListener('change',renderUsers); let fp=document.getElementById('f-papers'); if(fp) fp.addEventListener('change',renderPapers); let ft=document.getElementById('f-tax'); if(ft) ft.addEventListener('change',loadTax);
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',initMain); else initMain();
window.nav=nav; window.logout=logout; window.loadBoards=loadBoards; window.editBoard=editBoard; window.delBoard=delBoard; window.openM=openM; window.closeM=closeM;
try{ let m=document.getElementById('db-mode'); if(m) m.textContent='mode: '+(location.hostname==='127.0.0.1'||location.hostname==='localhost'?'service_role (localhost)':'anon')+' @ '+SUPABASE_URL; }catch(e){}
setTimeout(()=>{ try{ensureDb(); if(document.getElementById('app') && document.getElementById('app').style.display!=='none') loadDash(); }catch(e){} },800);
