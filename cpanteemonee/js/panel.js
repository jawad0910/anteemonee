const SUPABASE_URL='https://zkuytvjeqkpexcbyoyhz.supabase.co';
const ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprdXl0dmplcWtwZXhjYnlveWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MjUwNDAsImV4cCI6MjEwMzAwMTA0MH0.8tMbR057BmGaO0_T4nMOVLt1AAmWsPKBEopoSYYis44';
const SERVICE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprdXl0dmplcWtwZXhjYnlveWh6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzQyNTA0MCwiZXhwIjoyMTAzMDAxMDQwfQ.-JhbfB9qVYvHd5Rah8jW6XSFvPwop_YMgJgusYxYn3k';
let db=null;
function getKey(){ return SERVICE_KEY; }
function ensureDb(){ if(!db && window.supabase){ try{db=supabase.createClient(SUPABASE_URL,getKey());console.log('[DB] initialized, key type='+(getKey()===SERVICE_KEY?'service':'anon'));}catch(e){console.error('[DB] init failed',e);} }else if(!db){console.log('[DB] window.supabase not loaded yet');}else if(db){ try{let curKey=db.supabaseKey||''; if(curKey!==SERVICE_KEY){ db=supabase.createClient(SUPABASE_URL,SERVICE_KEY); console.log('[DB] switched to service key'); }}catch(e){} } }
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
let boardsCache=[], subjectsCache=[], classLevelsCache=[], eduCache=[], groupsCache=[];
(function(){
 try{
  if(!g('ebooks',null)) s('ebooks',[{id:uid(),title:'Physics FSc Part 1',subject:'Physics',class_level:'11th',status:'published'}]);
  if(!g('pastpapers',null)) s('pastpapers',[{id:uid(),type:'yearly',subject:'Physics',board:'BISE Lahore',year:2024,status:'published'}]);
  if(!g('notes',null)) s('notes',[{id:uid(),title:'Enzyme Action',subject:'Biology',chapter:'Ch 3',status:'published'}]);
  if(!g('official_flashcards',null)) s('official_flashcards',[{id:uid(),front:'What is enzyme?',back:'Protein catalyst — official',subject:'Biology'}]);
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
 if(n==='requests') loadRequests();
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
 setStat('s-fc','official_flashcards','official_flashcards');
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
 tb.innerHTML=d.map(u=>'<tr><td><b>'+esc(u.username||'—')+'</b><div style="color:var(--text-muted);font-size:11px">'+esc(u.email||'')+'</div></td><td><span class="cp-badge '+((u.plan_type==='lifetime'||u.plan_type==='exam')?'on':'')+'">'+esc(u.plan_type||'free')+'</span></td><td>'+esc(u.subscription_status||'')+'</td><td style="font-size:11px">'+(u.created_at||'').slice(0,10)+'</td><td><button class="cp-btn ghost" style="padding:4px 8px" onclick="editUser(\''+u.id+'\')">edit</button> <button class="cp-btn ghost" style="padding:4px 8px" onclick="togglePlan(\''+u.id+'\')">'+(u.plan_type==='lifetime'?'revoke':'grant')+'</button></td></tr>').join('')||'<tr><td colspan=5 style="text-align:center;color:var(--text-muted)">no users</td></tr>';
}
function editUser(id){ let u=usersCache.find(x=>String(x.id)===String(id)); if(!u) return; document.getElementById('mu-id').value=u.id; document.getElementById('mu-name').value=u.username||''; document.getElementById('mu-email').value=u.email||''; document.getElementById('mu-full').value=u.full_name||''; document.getElementById('mu-plan').value=u.plan_type||'free'; document.getElementById('mu-status').value=u.subscription_status||'inactive'; openM('m-user'); }
async function togglePlan(id){ let u=usersCache.find(x=>String(x.id)===String(id)); if(!u) return; let next=u.plan_type==='lifetime'?'free':'lifetime'; let st=next==='lifetime'?'active':'inactive'; if(!db){ u.plan_type=next; u.subscription_status=st; let a=g('mock_users',[]); let i=a.findIndex(x=>String(x.id)===String(id)); if(i>=0) a[i]=u; s('mock_users',a); renderUsers(); return toast('updated (local)'); } let res=await db.from('profiles').update({plan_type:next,subscription_status:st}).eq('id',id); if(res.error){ let a=g('mock_users',[]); let i=a.findIndex(x=>String(x.id)===String(id)); if(i>=0) a[i]=u; s('mock_users',a); toast(res.error.message+' — updated locally'); } else { u.plan_type=next; u.subscription_status=st; } renderUsers(); toast('updated'); }
async function loadEbooks(){
 ensureDb();
 let tb=document.getElementById('tb-ebooks'); if(!tb) return;
 tb.innerHTML='<tr><td colspan=7 style="text-align:center;padding:20px">loading…</td></tr>';
 await loadTaxonomyOptions();
 if(!db){ ebooksCache=g('ebooks',[]); renderEbooks(); return; }
 let res=await db.from('books').select('id,title,subject_id,education_system_id,board_id,class_level_id,group_id,edition,total_pages,source_url,is_verified,is_active').order('title').limit(200);
 if(res.error){ ebooksCache=g('ebooks',[]); renderEbooks(); tb.insertAdjacentHTML('beforeend','<tr><td colspan=7 style="color:#FBBF24;font-size:11px">'+esc(res.error.message)+' — local</td></tr>'); return; }
 ebooksCache=res.data||[]; if(!ebooksCache.length) ebooksCache=g('ebooks',[]); renderEbooks();
}
function groupName(id){ let x=(groupsCache||[]).find(v=>String(v.id)===String(id)); return x?x.name:''; }
function renderEbooks(){
 let q=(document.getElementById('q-ebooks')&&document.getElementById('q-ebooks').value||'').toLowerCase();
 let d=ebooksCache.filter(x=>!q||(x.title||'').toLowerCase().includes(q)||subjectName(x.subject_id).toLowerCase().includes(q));
 let tb=document.getElementById('tb-ebooks'); if(!tb) return;
 tb.innerHTML=d.map(x=>{
  let status=x.is_verified?'verified':(x.is_active===false?'inactive':'draft');
  return '<tr><td><b>'+esc(x.title||'Untitled book')+'</b><div style="font-size:11px;color:var(--text-muted)">'+esc(x.edition||'')+'</div></td><td>'+esc(subjectName(x.subject_id))+'</td><td>'+esc(className(x.class_level_id))+'</td><td>'+esc(boardName(x.board_id))+'</td><td>'+esc(x.total_pages==null?'—':x.total_pages)+'</td><td><span class="cp-badge '+(x.is_verified?'on':'')+'">'+esc(status)+'</span></td><td><button class="cp-btn ghost" style="padding:4px 8px" onclick="editEbook(\''+x.id+'\')">edit</button> <button class="cp-btn ghost danger" style="padding:4px 8px" onclick="delEbook(\''+x.id+'\')">del</button></td></tr>';
 }).join('')||'<tr><td colspan=7 style="text-align:center;color:var(--text-muted)">empty</td></tr>';
}
const EBOOK_SUBJECTS=['Physics','Chemistry','Biology','Computer Science','Mathematics','English'];
const EBOOK_CLASSES=['11th','12th'];
const EBOOK_BOARDS=['Punjab','Balochistan','KPK','Sindh','Kashmir','Gilgit Baltistan'];
function ebookBoardRegionMatch(storedName,region){
 let n=String(storedName||'').toLowerCase(), r=String(region||'').toLowerCase();
 if(!n||!r) return false;
 if(n===r||n===r+' board') return true;
 if(r==='kpk') return n.includes('kpk')||n.includes('khyber')||n.includes('paktunkhwa')||n.includes('pakhtunkhwa');
 if(r==='gilgit baltistan') return n.includes('gilgit')||n.includes('baltistan')||n==='gb';
 return n.includes(r);
}
function findEbookOptionValue(select,value){
 if(!select||!value) return '';
 let match=[...select.options].find(o=>String(o.value).toLowerCase()===String(value).toLowerCase()||String(o.textContent).toLowerCase()===String(value).toLowerCase());
 return match?match.value:'';
}
function ensureEbookOption(select,value){
 if(!select||!value) return;
 let exists=[...select.options].some(o=>String(o.value).toLowerCase()===String(value).toLowerCase());
 if(!exists){ let o=document.createElement('option'); o.value=value; o.textContent=value; select.appendChild(o); }
}
const EBOOK_PDF_BUCKET='ebooks-pdf';
function bindEbookModalOnce(){
 let pdf=document.getElementById('me-pdf');
 if(pdf&&!pdf.dataset.bound){ pdf.dataset.bound='1'; pdf.addEventListener('change',updateEbookIngestButton); }
}
function updateEbookIngestButton(){
 let id=parseInt(document.getElementById('me-id')&&document.getElementById('me-id').value,10);
 let fileEl=document.getElementById('me-pdf');
 let hasFile=fileEl&&fileEl.files&&fileEl.files.length>0;
 let rec=ebooksCache.find(x=>String(x.id)===String(id));
 let hasStored=rec&&rec.source_url;
 let btn=document.getElementById('me-ingest');
 if(!btn) return;
 btn.style.display=(Number.isFinite(id)&&id>0&&(hasFile||hasStored))?'':'none';
}
function setEbookIngestStatus(message,isError){
 let el=document.getElementById('me-ingest-status'); if(!el) return;
 if(!message){ el.style.display='none'; el.innerHTML=''; return; }
 el.style.display='block';
 el.style.color=isError?'#F87171':'var(--text-muted)';
 el.textContent=message;
}
async function editEbook(id){
 await loadTaxonomyOptions();
 bindEbookModalOnce();
 let x=ebooksCache.find(v=>String(v.id)===String(id));
 let isNew=!x;
 if(isNew){ x={id:'',subject_id:'',class_level_id:'',board_id:'',edition:'',total_pages:'',source_url:'',is_verified:false}; }
 let subjectSel=document.getElementById('me-subject');
 let classSel=document.getElementById('me-class');
 let boardSel=document.getElementById('me-board');
 let subjectNameExisting=x.subject_id?subjectName(x.subject_id):'';
 let classNameExisting=x.class_level_id?className(x.class_level_id):'';
 let boardNameExisting=x.board_id?boardName(x.board_id):'';
 ensureEbookOption(subjectSel,subjectNameExisting);
 ensureEbookOption(classSel,classNameExisting);
 ensureEbookOption(boardSel,boardNameExisting);
 subjectSel.value=findEbookOptionValue(subjectSel,subjectNameExisting)||EBOOK_SUBJECTS[0];
 classSel.value=findEbookOptionValue(classSel,classNameExisting)||EBOOK_CLASSES[0];
 boardSel.value=findEbookOptionValue(boardSel,boardNameExisting)||EBOOK_BOARDS[0];
 if(boardNameExisting){
  let region=EBOOK_BOARDS.find(r=>ebookBoardRegionMatch(boardNameExisting,r));
  if(region) boardSel.value=region;
 }
 document.getElementById('me-id').value=x.id||'';
 document.getElementById('me-pdf').value='';
 document.getElementById('me-edition').value=x.edition||'';
 document.getElementById('me-status').value=x.is_verified?'published':'draft';
 document.getElementById('me-pages').value=(x.total_pages==null||x.total_pages==='')?'':x.total_pages;
 setEbookIngestStatus(x.source_url?'stored file: '+String(x.source_url).split('/').pop():'');
 updateEbookIngestButton();
 openM('m-ebook');
}
async function delEbook(id){ if(!confirm('delete?')) return; if(!db){ let a=g('ebooks',[]).filter(x=>String(x.id)!==String(id)); s('ebooks',a); ebooksCache=a; renderEbooks(); return toast('deleted (local)'); } let res=await db.from('books').delete().eq('id',id); if(res.error){ let a=g('ebooks',[]).filter(x=>String(x.id)!==String(id)); s('ebooks',a); toast(res.error.message+' — deleted locally'); } ebooksCache=ebooksCache.filter(x=>String(x.id)!==String(id)); renderEbooks(); toast('deleted'); }
async function resolveEbookSubject(name){
 let row=(subjectsCache||[]).find(x=>String(x.name||'').trim().toLowerCase()===String(name).trim().toLowerCase())
  ||(subjectsCache||[]).find(x=>String(x.name||'').trim().toLowerCase().includes(String(name).trim().toLowerCase()))
  ||(subjectsCache||[]).find(x=>String(name).trim().toLowerCase().includes(String(x.name||'').trim().toLowerCase())&&x.name);
 if(row) return {id:Number(row.id),education_system_id:row.education_system_id??null};
 if(!db) throw new Error('database connection is required');
 let eduId=(eduCache||[])[0]?Number(eduCache[0].id):null;
 let r=await db.from('subjects').insert({name,education_system_id:eduId,group_id:null}).select('id,name,education_system_id').single();
 if(r.error) throw new Error(r.error.message);
 subjectsCache.push(r.data);
 return {id:Number(r.data.id),education_system_id:r.data.education_system_id??eduId};
}
async function resolveEbookClass(label,eduId){
 let value=label==='12th'?12:11;
 let row=(classLevelsCache||[]).find(x=>Number(x.value)===value&&eduId!=null&&String(x.education_system_id)===String(eduId))
  ||(classLevelsCache||[]).find(x=>Number(x.value)===value)
  ||(classLevelsCache||[]).find(x=>String(x.label||'').trim().toLowerCase()===String(label).trim().toLowerCase());
 if(row) return Number(row.id);
 if(!db) throw new Error('database connection is required');
 let r=await db.from('class_levels').insert({label,value,education_system_id:eduId??null}).select('id,label,value,education_system_id').single();
 if(r.error) throw new Error(r.error.message);
 classLevelsCache.push(r.data);
 return Number(r.data.id);
}
async function resolveEbookBoard(region){
 let row=(boardsCache||[]).find(x=>String(x.name||'').trim().toLowerCase()===String(region).trim().toLowerCase())
  ||(boardsCache||[]).find(x=>ebookBoardRegionMatch(x.name,region));
 if(row) return Number(row.id);
 if(!db) throw new Error('database connection is required');
 let name=region==='Gilgit Baltistan'?'Gilgit Baltistan Board':region+' Board';
 let r=await db.from('boards').insert({name,region}).select('id,name,region').single();
 if(r.error) throw new Error(r.error.message);
 boardsCache.push(r.data);
 return Number(r.data.id);
}
async function uploadEbookPdf(file,subjectLabel,classLabel,boardRegion){
 if(!db) throw new Error('database connection is required for eBook upload');
 let slug=(subjectLabel+'-'+classLabel+'-'+boardRegion).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
 let path=slug+'-'+Date.now()+'.pdf';
 let up=await db.storage.from(EBOOK_PDF_BUCKET).upload(path,file,{contentType:'application/pdf',upsert:false});
 if(up.error) throw new Error(up.error.message||'PDF upload failed');
 let pub=db.storage.from(EBOOK_PDF_BUCKET).getPublicUrl(path);
 return (pub&&pub.data&&pub.data.publicUrl)||'';
}
async function ingestEbook(){
 ensureDb();
 let idEl=document.getElementById('me-id'), fileEl=document.getElementById('me-pdf'), btn=document.getElementById('me-ingest');
 let bookId=parseInt(idEl&&idEl.value,10);
 if(!Number.isFinite(bookId)||bookId<=0) return toast('save the eBook before ingesting');
 let file=fileEl&&fileEl.files&&fileEl.files[0];
 let link='';
 if(!file){
  let rec=ebooksCache.find(x=>String(x.id)===String(bookId));
  link=(rec&&rec.source_url)||'';
  if(!link) return toast('upload a PDF first');
 }
 if(!db) return toast('database connection is required for ingestion');
 if(!window.pdfjsLib) return toast('PDF engine not loaded — check connection and retry');
 if(btn){ btn.disabled=true; btn.textContent='Ingesting…'; }
  const WATERMARK_RE=/(web\s*version\s*of\s*pecta|version\s*of\s*pecta|not\s*for\s*sale)/gi;
  const cleanPage=(s)=>String(s||'').replace(/\u0000/g,'').replace(WATERMARK_RE,' ').replace(/[ \t\f\v]+/g,' ').replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n').replace(/ {2,}/g,' ').trim();
 try{
  let buf;
  if(file){
   setEbookIngestStatus('Reading PDF…');
   buf=await file.arrayBuffer();
  } else {
   setEbookIngestStatus('Downloading PDF…');
   let resp=await fetch(link);
   if(!resp.ok) throw new Error('download failed (HTTP '+resp.status+')');
   buf=await resp.arrayBuffer();
  }
  let pdf=await window.pdfjsLib.getDocument({data:new Uint8Array(buf)}).promise;
  let total=pdf.numPages;
  let texts=[];
  for(let p=1;p<=total;p++){
   let page=await pdf.getPage(p);
   let tc=await page.getTextContent();
   let raw=(tc.items||[]).map(it=>it.str||'').join(' ');
   texts.push(cleanPage(raw));
   if(p%10===0||p===total) setEbookIngestStatus('Extracting text… '+p+'/'+total);
  }
  let readable=texts.filter(t=>t.length>=20).length;
  if(readable===0){
   throw new Error('Scanned PDF — no extractable text. Run local OCR: python3 ingest_physics11.py (see repo) then reload.');
  }
  setEbookIngestStatus('Uploading '+total+' pages ('+readable+' readable)…');
   let chapterRows=[];
   let chapterOffset=({4:-3,27:-3,28:-3,5:0,35:-5,7:-4})[String(bookId)];
   if(chapterOffset!==undefined){
    let chapterRes=await db.from('chapters').select('id,number,start_page,end_page').eq('book_id',bookId).order('number');
    if(chapterRes.error) throw new Error(chapterRes.error.message||'could not read textbook chapters');
    chapterRows=Array.isArray(chapterRes.data)?chapterRes.data:[];
    if(!chapterRows.length) throw new Error('Textbook chapters are missing; ingestion stopped to preserve chapter metadata');
   }
   let del=await db.from('book_pages').delete().eq('book_id',bookId);
  if(del.error) throw new Error(del.error.message);
  for(let i=0;i<texts.length;i+=100){
    let batch=texts.slice(i,i+100).map((text,off)=>{
      let pageNumber=i+off+1;
      let firstPrinted=chapterOffset!==undefined?(chapterOffset<0?1-chapterOffset:1):null;
      let printedPage=firstPrinted!==null&&pageNumber>=firstPrinted?pageNumber+chapterOffset:null;
     let chapter=null;
     if(chapterOffset!==undefined&&printedPage!==null){
      let matches=chapterRows.filter(c=>Number(c.start_page)<=printedPage&&printedPage<=Number(c.end_page));
      chapter=matches.sort((a,b)=>Number(b.number)-Number(a.number))[0]||null;
     }
     return {
      book_id:bookId, page_number:pageNumber,
      chapter_id:chapter&&chapter.id!=null?chapter.id:null, topic_id:null, text_content:text,
      printed_page_number:printedPage, content_status:text.length>=20?'extracted':'empty',
     };
    });
   let up=await db.from('book_pages').upsert(batch,{onConflict:'book_id,page_number'});
   if(up.error) throw new Error(up.error.message);
   setEbookIngestStatus('Uploading… '+Math.min(i+100,texts.length)+'/'+texts.length);
  }
  let upd=await db.from('books').update({total_pages:texts.length,is_verified:true,is_active:true}).eq('id',bookId);
  if(upd.error) throw new Error(upd.error.message);
  setEbookIngestStatus('Ingested '+texts.length+' pages ('+readable+' readable).');
  let pagesEl=document.getElementById('me-pages');
  if(pagesEl) pagesEl.value=texts.length;
  await loadEbooks();
  await loadDash();
  toast('ingested '+texts.length+' pages');
 }catch(e){
  console.error(e);
  setEbookIngestStatus(e.message||'ingestion failed',true);
  toast(e.message||'ingestion failed');
 }finally{
  if(btn){ btn.disabled=false; btn.textContent='Ingest PDF'; }
 }
}
async function loadTaxonomyOptions(){
 ensureDb(); if(!db) return;
 if(!boardsCache.length){ let r=await db.from('boards').select('id,name').order('name'); if(!r.error) boardsCache=r.data||[]; }
 if(!subjectsCache.length){ let r=await db.from('subjects').select('id,name,education_system_id,group_id').order('name'); if(!r.error) subjectsCache=r.data||[]; }
 if(!classLevelsCache.length){ let r=await db.from('class_levels').select('id,label,value,education_system_id').order('id'); if(!r.error) classLevelsCache=r.data||[]; }
 if(!eduCache.length){ let r=await db.from('education_systems').select('id,name').order('id'); if(!r.error) eduCache=r.data||[]; }
 if(!groupsCache.length){ let r=await db.from('groups').select('id,name,education_system_id').order('id'); if(!r.error) groupsCache=r.data||[]; }
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
 document.getElementById('mp-file').value='';
 let mpStatus=document.getElementById('mp-file-status');
 if(mpStatus){ let cur=x.file_path||x.file_url||x.source_url||''; mpStatus.textContent=cur?('stored file: '+String(cur).split('/').pop()):''; }
 document.getElementById('mp-status').value=x.status||'published';
 openM('m-paper');
}
const PAPER_PDF_BUCKET='past-papers-pdf';
async function uploadPaperPdf(file,title){
 if(!db) throw new Error('database connection is required for paper upload');
 let slug=String(title||'paper').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'paper';
 let path=slug+'-'+Date.now()+'.pdf';
 let up=await db.storage.from(PAPER_PDF_BUCKET).upload(path,file,{contentType:'application/pdf',upsert:false});
 if(up.error) throw new Error(up.error.message||'PDF upload failed');
 let pub=db.storage.from(PAPER_PDF_BUCKET).getPublicUrl(path);
 return (pub&&pub.data&&pub.data.publicUrl)||'';
}
async function delPaper(id){ if(!confirm('delete?')) return; if(!db){ let a=g('pastpapers',[]).filter(x=>String(x.id)!==String(id)); s('pastpapers',a); papersCache=a; renderPapers(); return toast('deleted (local)'); } let res=await db.from('past_papers').delete().eq('id',id); if(res.error) return toast(res.error.message); papersCache=papersCache.filter(x=>String(x.id)!==String(id)); renderPapers(); toast('deleted'); }

let bulkParsed=[];
function parseFileName(name){
  let n=(name||'').toLowerCase();
  let year=(n.match(/\b(20\d{2})\b/)||[])[1]||null;
  let subject=null;
  for(let s of ['physics','biology','chemistry','english','mathematics','maths','computer science','computer','islamiyat','pakistan studies','urdu']){
    if(n.includes(s)){ subject=s; break; }
  }
  if(subject==='maths') subject='mathematics';
  if(subject==='computer') subject='Computer Science';
  // map to proper case
  let subjMap={physics:'Physics',biology:'Biology',chemistry:'Chemistry',english:'English',mathematics:'Mathematics','computer science':'Computer Science'};
  if(subject) subject=subjMap[subject]||subject;
  let board=null;
  for(let b of boardsCache){
    if(n.includes(b.name.toLowerCase()) || n.includes(b.name.toLowerCase().replace('bise ',''))) { board=b.name; break; }
  }
  if(!board){
    // fallback keywords
    let bkw={lahore:'BISE Lahore',faisalabad:'BISE Faisalabad',gujranwala:'BISE Gujranwala',multan:'BISE Multan',rawalpindi:'BISE Rawalpindi',sargodha:'BISE Sargodha',sahiwal:'BISE Sahiwal',bahawalpur:'BISE Bahawalpur','dg khan':'BISE DG Khan',federal:'FBISE — Federal Board',fbise:'FBISE — Federal Board'};
    for(let k in bkw){ if(n.includes(k)){ board=bkw[k]; break; } }
  }
  let cls=null;
  if(n.includes('11th')||n.includes('11')&&n.includes('class')||n.includes('1st year')||n.includes('1st_year')) cls='11th';
  else if(n.includes('12th')||n.includes('12')&&n.includes('class')||n.includes('2nd year')||n.includes('2nd_year')) cls='12th';
  // also check value
  if(!cls && n.includes('11')) cls='11th';
  if(!cls && n.includes('12')) cls='12th';
  return {year:year?parseInt(year):null, subject, board, class:cls};
}
function extractFolderId(url){
  let m=url.match(/folders\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
  return m?m[1]:null;
}
function extractFileId(url){ try{ let m=url.match(/\/file\/d\/([^\/]+)/) || url.match(/id=([^&]+)/); return m?m[1]:null; }catch(e){return null;} }
async function scanFolder(){
  let folderEl=document.getElementById('pp-folder');
  let bulkEl=document.getElementById('pp-bulk');
  let preview=document.getElementById('pp-bulk-preview');
  let folderUrl=(folderEl&&folderEl.value||'').trim();
  let bulkText=(bulkEl&&bulkEl.value||'').trim();
  let lines=[];
  if(bulkText){
    lines=bulkText.split('\n').map(s=>s.trim()).filter(Boolean);
  }
  if(folderUrl && !lines.length){
    let fid=extractFolderId(folderUrl);
    if(!fid) return toast('invalid folder link — use https://drive.google.com/drive/folders/ID');
    // try Drive API with any AIza key from local or DB
    let apiKey=null;
    try{
      let keys=g('apikeys',[]).concat(keysCache||[]);
      let k=keys.find(x=>String(x.key||'').startsWith('AIza'));
      if(k) apiKey=k.key;
      if(!apiKey){
        let r=await db.from('api_keys').select('key_masked,key').or('provider.eq.Gemini,provider.eq.Drive,provider.eq.Google').limit(1).maybeSingle();
        if(r&&r.data&&r.data.key) apiKey=r.data.key;
        if(r&&r.data&&r.data.key_masked&&String(r.data.key_masked).startsWith('AIza')) apiKey=r.data.key_masked;
      }
    }catch(e){}
    // try Drive API
    if(apiKey){
      try{
        toast('scanning via Drive API…');
        let url='https://www.googleapis.com/drive/v3/files?q=\''+fid+'\'+in+parents&fields=files(id,name,webViewLink,webContentLink)&pageSize=100&key='+encodeURIComponent(apiKey);
        let j=await fetch(url).then(r=>r.json());
        if(j.files && j.files.length){
          lines=j.files.map(f=> (f.name||'file')+' — https://drive.google.com/file/d/'+f.id+'/view');
          if(bulkEl) bulkEl.value=lines.join('\n');
          toast('found '+lines.length+' files via API');
        } else if(j.error) throw new Error(j.error.message||'API error');
      }catch(e){ console.warn('Drive API failed',e); }
    }
    // fallback: CORS proxy scrape with multiple patterns
    if(!lines.length){
      try{
        toast('scanning folder (fallback)…');
        let proxy='https://corsproxy.io/?';
        let html=await fetch(proxy+encodeURIComponent('https://drive.google.com/drive/folders/'+fid)).then(r=>r.text());
        let found=[];
        let patterns=[/"title":"([^"]+\.pdf)"/gi, /"name":"([^"]+\.pdf)"/gi, /title[^>]*>([^<]+\.pdf)</gi];
        for(let re of patterns){
          let m; while((m=re.exec(html))!==null){ if(m[1]&&m[1].length>3) found.push(m[1].trim()); }
          if(found.length) break;
        }
        // try to extract file IDs + titles together
        let idRe=/"id":"([a-zA-Z0-9_-]{25,})"/g, ids=[];
        let m; while((m=idRe.exec(html))!==null) ids.push(m[1]);
        if(found.length){
          // if we have ids, pair them
          if(ids.length===found.length){
            lines=found.map((name,i)=> name+' — https://drive.google.com/file/d/'+ids[i]+'/view');
          } else lines=found;
          if(bulkEl) bulkEl.value=lines.join('\n');
          toast('found '+found.length+' files (scrape)');
        } else {
          toast('no files found — open Drive folder, Ctrl+A → Ctrl+C file names, paste below, then Scan again');
          return;
        }
      }catch(e){
        console.error(e);
        toast('scan failed — paste file names/links below and scan again');
        return;
      }
    }
  }
  if(!lines.length) return toast('paste folder link or file links (one per line)');
  // parse each line: may be "name — url" or just url or just name
  bulkParsed=[];
  for(let line of lines){
    let url=null, name=line;
    let urlMatch=line.match(/https?:\/\/[^\s]+/);
    if(urlMatch){ url=urlMatch[0]; name=line.replace(url,'').replace(/^[\s—\-]+/,'').trim() || url; }
    // if line is just a Drive file link, try to get name from link? use file ID as name fallback
    if(!name || name.startsWith('http')) name=url||line;
    let parsed=parseFileName(name);
    // try to get Drive file ID for link
    let fid=null;
    if(url){
      let mm=url.match(/\/file\/d\/([^\/]+)/) || url.match(/id=([^&]+)/) || url.match(/\/d\/([^\/\s]+)/);
      if(mm) fid=mm[1];
    }
    let driveLink=fid ? 'https://drive.google.com/file/d/'+fid+'/preview' : (url||'');
    bulkParsed.push({name, url:driveLink, raw:line, ...parsed});
  }
  // show preview
  if(preview){
    preview.style.display='block';
    preview.innerHTML='<table class="cp-table"><thead><tr><th>file</th><th>subject</th><th>board</th><th>class</th><th>year</th><th>link</th></tr></thead><tbody>'
      +bulkParsed.map(p=>'<tr><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(p.name)+'</td><td>'+esc(p.subject||'—')+'</td><td>'+esc(p.board||'—')+'</td><td>'+esc(p.class||'—')+'</td><td>'+esc(p.year||'—')+'</td><td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px">'+esc(p.url||'')+'</td></tr>').join('')
      +'</tbody></table><div style="padding:8px;font-size:11px;color:var(--text-muted)">Detected '+bulkParsed.length+' files — check board/year/subject then “Add all to DB”</div>';
  }
  toast('parsed '+bulkParsed.length+' files');
}
async function bulkAdd(){
  if(!bulkParsed.length) return toast('scan first');
  ensureDb();
  let added=0, skipped=0;
  for(let p of bulkParsed){
    if(!p.year || !p.subject) { skipped++; continue; }
    // map to IDs
    let boardId=null, subjectId=null, classId=null;
    if(p.board){ let b=boardsCache.find(x=>x.name===p.board); if(b) boardId=b.id; else { let bb=boardsCache.find(x=>p.board.toLowerCase().includes(x.name.toLowerCase().split(' ').pop())); if(bb) boardId=bb.id; } }
    if(!boardId) boardId=boardsCache[0]?.id||1;
    let s=subjectsCache.find(x=>x.name.toLowerCase()===String(p.subject).toLowerCase());
    if(s) subjectId=s.id; else subjectId=subjectsCache.find(x=>x.name==='Physics')?.id||1;
    if(p.class==='11th') classId=1;
    else if(p.class==='12th') classId=2;
    else classId=1;
    let payload={title:(p.subject+' '+(p.board||'')+' '+p.year).trim(), board_id:boardId, subject_id:subjectId, class_level_id:classId, year:p.year, paper_type:'annual', file_path:p.url||p.raw, status:'published'};
    if(!db){
      let local={id:uid(),...payload,board:p.board,subject:p.subject,type:'annual',file_url:p.url,created_at:new Date().toISOString()};
      let a=g('pastpapers',[]); a.unshift(local); s('pastpapers',a);
      added++;
    } else {
      let res=await db.from('past_papers').insert(payload).select();
      if(!res.error) added++; else { console.warn(res.error); skipped++; }
    }
  }
  toast('added '+added+' papers'+(skipped?' , skipped '+skipped:''));
  await loadPapers();
  await loadDash();
}

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
let fcSelected=new Set();
function updateFcBulkUI(){
  let btn=document.getElementById('fc-bulk-del'), cnt=document.getElementById('fc-bulk-count'), all=document.getElementById('fc-select-all');
  let n=fcSelected.size;
  if(btn) btn.style.display=n?'':'none';
  if(cnt) cnt.textContent=n;
  if(all){
    let visibleChecks=document.querySelectorAll('#tb-fc .fc-chk');
    let visibleIds=[...visibleChecks].map(c=>c.dataset.id);
    let allVisibleChecked=visibleIds.length>0 && visibleIds.every(id=>fcSelected.has(id));
    all.checked=allVisibleChecked;
    all.indeterminate=!allVisibleChecked && visibleIds.some(id=>fcSelected.has(id));
  }
}
async function bulkDelFc(){
  if(!fcSelected.size) return;
  let n=fcSelected.size;
  if(!confirm('Delete '+n+' selected flashcard'+(n>1?'s':'')+'? This cannot be undone.')) return;
  let ids=[...fcSelected];
  let btn=document.getElementById('fc-bulk-del');
  if(btn){ btn.disabled=true; btn.textContent='Deleting…'; }
  let ok=0, fail=0;
  if(!db){
    let a=g('official_flashcards',[]).filter(x=>!fcSelected.has(String(x.id)));
    s('official_flashcards',a);
    fcCache=fcCache.filter(x=>!fcSelected.has(String(x.id)));
    ok=n;
  } else {
    // try bulk delete via IN
    try{
      let res=await db.from('official_flashcards').delete().in('id', ids);
      if(res.error) throw res.error;
      ok=n;
      fcCache=fcCache.filter(x=>!fcSelected.has(String(x.id)));
      // also clean local fallback mirror
      let a=g('official_flashcards',[]).filter(x=>!fcSelected.has(String(x.id)));
      s('official_flashcards',a);
    } catch(e){
      // fallback: delete one by one and mirror locally
      console.warn('[FC BULK] bulk delete failed, trying one-by-one', e);
      for(let id of ids){
        try{
          let r=await db.from('official_flashcards').delete().eq('id', id);
          if(r.error) throw r.error;
          fcCache=fcCache.filter(x=>String(x.id)!==String(id));
          ok++;
        }catch(e2){
          fail++;
          // still remove locally to keep UI consistent if DB row missing
          let a=g('official_flashcards',[]).filter(x=>String(x.id)!==String(id));
          s('official_flashcards',a);
        }
      }
    }
  }
  fcSelected.clear();
  renderFc();
  if(btn){ btn.disabled=false; btn.textContent='Delete selected ('+0+')'; }
  toast(ok?('deleted '+ok+(fail?' , '+fail+' failed':'')):'nothing deleted');
  loadDash();
}
async function loadFc(){
 ensureDb();
 let tb=document.getElementById('tb-fc'); if(!tb) return;
 tb.innerHTML='<tr><td colspan=9 style="text-align:center;padding:20px">loading official…</td></tr>';
 console.log('[FC LOAD] db=',!!db);
 if(!db){ fcCache=g('official_flashcards',[]); console.log('[FC LOAD] fallback to local:',fcCache.length); fcSelected.clear(); renderFc(); return; }
 let res=await db.from('official_flashcards').select('id,front,back,subject,class_level,chapter,topic_no,topic,created_at').order('created_at',{ascending:false}).limit(200);
 console.log('[FC LOAD] res=',res);
 if(res.error){ console.error('[FC LOAD] ERROR:',res.error); fcCache=g('official_flashcards',[]); fcSelected.clear(); renderFc(); tb.insertAdjacentHTML('beforeend','<tr><td colspan=9 style="color:#FBBF24;font-size:11px">'+esc(res.error.message)+' — local / run migration 20250105</td></tr>'); return; }
 fcCache=res.data||[]; if(!fcCache.length) fcCache=g('official_flashcards',[]); console.log('[FC LOAD] loaded',fcCache.length,'cards'); fcSelected.clear(); renderFc();
}
function renderFc(){ let q=(document.getElementById('q-fc')&&document.getElementById('q-fc').value||'').toLowerCase(); let d=fcCache.filter(x=>!q||(x.front||'').toLowerCase().includes(q)||(x.chapter||'').toLowerCase().includes(q)||(x.topic||'').toLowerCase().includes(q)); let tb=document.getElementById('tb-fc'); if(!tb) return; tb.innerHTML=d.map(x=>'<tr><td style="text-align:center"><input type="checkbox" class="fc-chk" data-id="'+x.id+'" '+(fcSelected.has(String(x.id))?'checked':'')+'></td><td style="max-width:180px;overflow:hidden;text-overflow:ellipsis">'+esc(x.front||'')+'</td><td style="max-width:180px">'+esc(x.back||'')+'</td><td>'+esc(x.subject||'')+'</td><td>'+esc(x.class_level||'—')+'</td><td>'+esc(x.chapter||'—')+'</td><td>'+esc(x.topic_no||'—')+'</td><td>'+esc(x.topic||'—')+'</td><td><button class="cp-btn ghost" style="padding:4px 8px" onclick="editFc(\''+x.id+'\')">edit</button> <button class="cp-btn ghost danger" style="padding:4px 8px" onclick="delFc(\''+x.id+'\')">del</button></td></tr>').join('')||'<tr><td colspan=9 style="text-align:center;color:var(--text-muted)">empty</td></tr>';
  // wire checkboxes
  tb.querySelectorAll('.fc-chk').forEach(ch=>{
    ch.addEventListener('change',()=>{
      let id=ch.dataset.id;
      if(ch.checked) fcSelected.add(String(id)); else fcSelected.delete(String(id));
      updateFcBulkUI();
    });
  });
  updateFcBulkUI();
}
function editFc(id){
  let x=fcCache.find(v=>String(v.id)===String(id));
  let isNew=!x;
  if(isNew){ x={id:null,front:'',back:'',subject:'Physics',class_level:'11th',chapter:'',topic_no:1,topic:''}; }
  clearAI();
  document.getElementById('mf-id').value=x.id||'';
  document.getElementById('mf-front').value=x.front||'';
  document.getElementById('mf-back').value=x.back||'';
  document.getElementById('ai-subject').value=x.subject||'Physics';
  document.getElementById('ai-class').value=x.class_level||'11th';
  document.getElementById('ai-chapter').value=x.chapter||'';
  document.getElementById('ai-topicno').value=(x.topic_no==null||x.topic_no==='')?1:x.topic_no;
  document.getElementById('ai-topic').value=x.topic||'';
  let titleEl=document.getElementById('mf-title');
  if(titleEl) titleEl.textContent=isNew?'Add Flashcard':'Edit Flashcard';
  let qa=document.getElementById('mf-qa');
  if(qa) qa.style.display=isNew?'none':'flex';
  let manualActions=document.getElementById('mf-manual-actions');
  if(manualActions) manualActions.style.display=isNew?'none':'flex';
  let aiBlock=document.getElementById('ai-block');
  if(aiBlock) aiBlock.style.display=isNew?'block':'none';
  openM('m-fc');
}
async function delFc(id){ if(!confirm('delete?')) return; fcSelected.delete(String(id)); if(!db){ let a=g('official_flashcards',[]).filter(x=>String(x.id)!==String(id)); s('official_flashcards',a); fcCache=a; renderFc(); return toast('deleted (local)'); } let res=await db.from('official_flashcards').delete().eq('id',id); if(res.error){ let a=g('official_flashcards',[]).filter(x=>String(x.id)!==String(id)); s('official_flashcards',a); toast(res.error.message+' — deleted locally'); } fcCache=fcCache.filter(x=>String(x.id)!==String(id)); renderFc(); toast('deleted'); }

let aiGenerated=[];
let aiMeta={subject:'General',class_level:'11th',chapter:'',topic_no:1,topic:'',page_range:'',sources:[]};
function parseFlashcardPageSpec(raw){
  let text=String(raw||'').trim();
  if(!text) return {ok:true,all:true,ranges:[],singles:new Set(),label:''};
  let ranges=[], singles=new Set(), parts=text.split(/[,;]+/).map(x=>x.trim()).filter(Boolean);
  if(!parts.length) return {ok:false,error:'enter pages like 12, 15 or 12-18'};
  for(let part of parts){
    let m=part.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
    if(m){
      let start=parseInt(m[1],10), end=parseInt(m[2],10);
      if(!(start>0&&end>0)||start>end) return {ok:false,error:'invalid page range: '+part};
      ranges.push([start,end]);
      continue;
    }
    if(/^\d+$/.test(part)){
      let n=parseInt(part,10);
      if(!(n>0)) return {ok:false,error:'invalid page number: '+part};
      singles.add(n);
      continue;
    }
    return {ok:false,error:'invalid page entry: '+part};
  }
  return {ok:true,all:false,ranges,singles,label:parts.join(', ')};
}
function ingestedPageNumber(page){
  let n=Number(page&&(page.printed_page_number!=null?page.printed_page_number:page.page_number));
  return Number.isFinite(n)&&n>0?Math.floor(n):null;
}
function pageInSpec(n,spec){
  if(spec.all) return true;
  if(spec.singles.has(n)) return true;
  return spec.ranges.some(r=>n>=r[0]&&n<=r[1]);
}
const FLASHCARD_SEARCH_STOPWORDS=new Set(['and','the','their','there','with','from','into','about','what','when','where','which','this','that','these','those','for','are','was','were','has','have','had','not','but','its','our','your','chapter','topic','class','part','unit','units']);
function flashcardSearchKeywords(text,maxTerms){
  let terms=String(text||'').toLowerCase().split(/[^a-z0-9]+/).filter(t=>t.length>2&&!FLASHCARD_SEARCH_STOPWORDS.has(t));
  let unique=[];
  terms.forEach(t=>{ if(!unique.includes(t)) unique.push(t); });
  return unique.slice(0,Math.max(maxTerms||0,0));
}
function buildFlashcardSearchQueries(topic,chapter,subject){
  let queries=[];
  let push=q=>{ q=String(q||'').trim().replace(/\s+/g,' '); if(q&&q.length>=3&&!queries.includes(q)) queries.push(q); };
  let topicTerms=flashcardSearchKeywords(topic,4);
  let chapterTerms=flashcardSearchKeywords(chapter,4).filter(t=>!topicTerms.includes(t));
  if(topicTerms[0]&&topicTerms[1]) push(topicTerms[0]+' '+topicTerms[1]);
  if(topicTerms[0]) push(topicTerms[0]);
  if(chapterTerms[0]&&topicTerms[0]) push(chapterTerms[0]+' '+topicTerms[0]);
  if(chapterTerms[0]&&chapterTerms[1]) push(chapterTerms[0]+' '+chapterTerms[1]);
  if(chapterTerms[0]) push(chapterTerms[0]);
  if(subject&&String(subject).trim().toLowerCase()!=='general') push(subject);
  return queries.slice(0,5);
}
async function findIngestedBooksForFlashcards(subject,aiClass){
  ensureDb();
  if(!db) throw new Error('DB not ready');
  await loadTaxonomyOptions();
  let subjectKey=String(subject||'').trim().toLowerCase();
  let subjectIds=(subjectsCache||[]).filter(x=>String(x.name||'').trim().toLowerCase()===subjectKey).map(x=>Number(x.id)).filter(n=>Number.isFinite(n));
  if(!subjectIds.length) throw new Error('Subject "'+subject+'" was not found in the subjects table.');
  let wantedValue=aiClass==='12th'?12:11;
  let classIds=(classLevelsCache||[]).filter(x=>Number(x.value)===wantedValue||String(x.label||'').trim().toLowerCase()===String(aiClass||'').trim().toLowerCase()).map(x=>Number(x.id)).filter(n=>Number.isFinite(n));
  if(!classIds.length) throw new Error('Class "'+aiClass+'" was not found in the class_levels table.');
  let booksRes=await db.from('books').select('id,title,subject_id,class_level_id,is_active').order('title').limit(100);
  if(booksRes.error) throw new Error(booksRes.error.message||'could not read the books table');
  let candidates=(Array.isArray(booksRes.data)?booksRes.data:[]).filter(b=>subjectIds.includes(Number(b.subject_id))&&classIds.includes(Number(b.class_level_id))&&b.is_active!==false);
  if(!candidates.length) throw new Error('No '+subject+' book for class '+aiClass+' is registered in public.books.');
  return candidates;
}
async function searchIngestedBookPages(queries,perQueryLimit,books){
  ensureDb();
  if(!db) throw new Error('DB not ready');
  let candidateIds=new Set(books.map(b=>Number(b.id)));
  let merged=[], seen=new Set();
  let target=Math.max(perQueryLimit*queries.length,1);
  outer:
  for(let book of books){
    for(let queryText of queries){
       let res=await db.rpc('search_textbook_pages_with_chapters',{p_query:queryText,p_book_id:Number(book.id),p_limit:perQueryLimit,p_class_level_id:Number(book.class_level_id)});
       if(res.error) res=await db.rpc('search_textbook_pages',{p_query:queryText,p_book_id:Number(book.id),p_limit:perQueryLimit,p_class_level_id:Number(book.class_level_id)});
       if(res.error) throw new Error(res.error.message||'textbook search failed');
      for(let p of (Array.isArray(res.data)?res.data:[])){
        if(!candidateIds.has(Number(p.book_id))) continue;
         let key=[p.book_title,ingestedPageNumber(p),p.chapter_number,p.chapter_name,p.chapter_id,p.topic_id,String(p.full_text||p.snippet||'').slice(0,160)].join('|');
        if(seen.has(key)) continue;
        seen.add(key);
        merged.push(p);
        if(merged.length>=target) break outer;
      }
    }
  }
  return merged;
}
function subjectTerms(subject){
  let s=String(subject||'').trim().toLowerCase();
  if(s==='computer science') return ['computer science'];
  if(s==='mathematics') return ['mathematics','maths','math'];
  if(s) return [s];
  return [];
}
function subjectHaystack(p,includeText){
  let parts=[p.book_title,p.chapter_number!=null?('chapter '+p.chapter_number):'',p.chapter_name,p.topic_name];
  if(includeText) parts.push(String(p.full_text||p.snippet||'').slice(0,2000));
  return parts.filter(Boolean).join(' ').toLowerCase();
}
function subjectTermMatches(hay,terms){
  let tokens=new Set(hay.split(/[^a-z0-9]+/).filter(Boolean));
  return terms.some(t=>{
    if(t.includes(' ')) return hay.includes(t);
    return tokens.has(t);
  });
}
function scoreBookSource(p,topicTerms,chapterTerms){
  let hay=subjectHaystack(p,true);
  let score=0;
  topicTerms.forEach((t,i)=>{ if(subjectTermMatches(hay,[t])) score+=(topicTerms.length-i)*3; });
  chapterTerms.forEach((t,i)=>{ if(subjectTermMatches(hay,[t])) score+=(chapterTerms.length-i); });
  return score;
}
function summarizeBookSource(p,bookById){
  let page=ingestedPageNumber(p);
  let bookId=Number(p.book_id);
  let book=bookById&&bookById.get(bookId)?bookById.get(bookId):String(p.book_title||'Ingested book');
  return {
    bookId,
    book,
    page,
    chapterNumber:p.chapter_number!=null?Number(p.chapter_number):null,
    chapter:String(p.chapter_name||''),
    topic:String(p.topic_name||''),
    text:String(p.full_text||p.snippet||'').trim(),
    label:book+(p.chapter_name?(' ch.'+(p.chapter_number!=null?p.chapter_number+' ':'')+p.chapter_name):'')+(page?(' p.'+page):'')
  };
}
function getGroqKey(){
  let keys=g('apikeys',[]).concat(keysCache||[]);
  // try to find a real gsk_ key (not masked)
  for(let k of keys){
    let v=String(k.key||k.key_masked||'').trim();
    if(v.startsWith('gsk_') && !v.includes('•') && v.length>20) return v;
  }
  for(let k of keys){
    if(String(k.provider||'').toLowerCase()==='groq'){
      let v=String(k.key||k.key_masked||'').trim();
      if(v && !v.includes('•') && v.length>10) return v;
    }
  }
  return null;
}
async function generateFlashcardsAI(){
  let topic=(document.getElementById('ai-topic')&&document.getElementById('ai-topic').value||'').trim();
  let subject=(document.getElementById('ai-subject')&&document.getElementById('ai-subject').value||'').trim()||'General';
  let aiClass=(document.getElementById('ai-class')&&document.getElementById('ai-class').value||'11th');
  let chapter=(document.getElementById('ai-chapter')&&document.getElementById('ai-chapter').value||'').trim();
  let pageSpec=parseFlashcardPageSpec(document.getElementById('ai-pages')&&document.getElementById('ai-pages').value);
  if(!pageSpec.ok) return toast(pageSpec.error||'invalid pages');
  let topicNo=parseFloat(document.getElementById('ai-topicno')&&document.getElementById('ai-topicno').value)||1;
  let topicName=topic;
  let count=parseInt(document.getElementById('ai-count')&&document.getElementById('ai-count').value)||5;
  if(!topic) return toast('enter topic');
  let btn=document.getElementById('ai-gen-btn');
  let preview=document.getElementById('ai-preview');
  let actions=document.getElementById('ai-actions');
  if(btn){ btn.textContent='Searching book…'; btn.disabled=true; }
  if(preview){ preview.style.display='block'; preview.innerHTML='<div style="padding:20px;text-align:center;color:var(--text-muted)">Searching the ingested '+esc(subject)+' book…</div>'; }
  try{
    let books=await findIngestedBooksForFlashcards(subject,aiClass);
    let bookById=new Map(books.map(b=>[Number(b.id),String(b.title||'Ingested book')]));
    let queries=buildFlashcardSearchQueries(topic,chapter,subject);
    if(!queries.length) return toast('enter a more specific topic');
    let perQueryLimit=Math.min(Math.max(count,8),15);
    let rawPages=await searchIngestedBookPages(queries,perQueryLimit,books);
    let topicTerms=flashcardSearchKeywords(topic,6);
    let chapterTerms=flashcardSearchKeywords(chapter,6);
    let matched=rawPages
      .map(p=>summarizeBookSource(p,bookById))
      .filter(x=>x.text&&pageInSpec(x.page||0,pageSpec))
      .map(x=>({source:x,score:scoreBookSource(x,topicTerms,chapterTerms)}));
    matched.sort((a,b)=>{
      if(b.score!==a.score) return b.score-a.score;
      return (a.source.page||Number.MAX_SAFE_INTEGER)-(b.source.page||Number.MAX_SAFE_INTEGER);
    });
    matched=matched.map(x=>x.source);
    if(!matched.length){
      throw new Error(pageSpec.all
        ? 'No ingested text matched '+subject+' / '+topic+' in the selected '+aiClass+' book(s). Try a shorter topic or check the chapter spelling.'
        : 'No ingested '+subject+' text matched '+topic+' on stored page(s) '+pageSpec.label+'. Widen the page range or check the stored page numbers.');
    }

    const MAX_SOURCE_PAGES=8, MAX_CONTEXT_CHARS=12000;
    let selected=matched.slice(0,MAX_SOURCE_PAGES);
    let perPage=Math.max(800,Math.floor(MAX_CONTEXT_CHARS/Math.max(selected.length,1)));
    let sources=selected.map((x,i)=>({
      ref:i+1,
      bookId:x.bookId,
      book:x.book,
       page:x.page,
       chapterNumber:x.chapterNumber,
       chapter:x.chapter,
       topic:x.topic,
      text:x.text.slice(0,perPage)
    }));
     let bookContext=sources.map(x=>
       '[SOURCE '+x.ref+'] Book: "'+x.book+'"'
       +(x.chapterNumber!=null?'; Chapter '+(x.chapterNumber||'')+(x.chapter?': '+x.chapter:''):(x.chapter?'; Chapter: '+x.chapter:''))
       +(x.topic?'; Topic: '+x.topic:'')
       +(x.page?'; Page: '+x.page:'')
       +'\n'+x.text
     ).join('\n\n---\n\n');
    aiMeta={subject,class_level:aiClass,chapter,topic_no:topicNo,topic:topicName,page_range:pageSpec.all?'':pageSpec.label,sources};

    if(btn) btn.textContent='Generating…';
    if(preview) preview.innerHTML='<div style="padding:20px;text-align:center;color:var(--text-muted)">Generating '+count+' cards from '+sources.length+' book page(s)…</div>';
    ensureDb();
    if(!db) throw new Error('DB not ready');
    let res2=await db.functions.invoke('generate-flashcards',{body:{topic, subject, class_level: aiClass, chapter, topic_no: topicNo, topic: topicName, count, page_range: aiMeta.page_range, book_context: bookContext, source_pages: sources.map(x=>({ref:x.ref,book_id:x.bookId,book:x.book,page:x.page,chapter_number:x.chapterNumber,chapter:x.chapter,topic:x.topic}))}});
    if(res2.error) throw new Error(res2.error.message||'Edge Function error — deploy supabase/functions/generate-flashcards & set GROQ_API_KEY in secrets');
    let arr=res2.data?.cards || res2.data;
    if(!arr || !Array.isArray(arr) || !arr.length) throw new Error('AI returned no cards');
    // all cards keep the single topic_no the user entered (e.g. 1.1 stays 1.1 for every card)
    let normalized=arr.slice(0,count).map((x)=>({front:String(x.front||x.question||'').trim(), back:String(x.back||x.answer||'').trim(), subject, class_level: aiClass, chapter, topic_no: topicNo, topic: topicName}));
    normalized=normalized.filter(x=>x.front && x.back);
    if(!normalized.length) throw new Error('No valid cards');
    aiGenerated=normalized;
    // show preview editable
     preview.innerHTML='<div style="padding:10px 4px 8px;font-size:11px;color:var(--text-muted)">Grounded in: '+esc(sources.map(x=>x.book+(x.chapterNumber!=null?(' ch.'+x.chapterNumber+(x.chapter?(' '+x.chapter):'')):(x.chapter?(' ch. '+x.chapter):''))+(x.page?(' p.'+x.page):'')).join('; '))+'</div>'
      +'<table class="cp-table"><thead><tr><th>#</th><th>front</th><th>back</th><th>topic no</th><th>topic</th></tr></thead><tbody>'
      +aiGenerated.map((c,i)=>'<tr><td>'+esc(c.topic_no!=null?c.topic_no:aiMeta.topic_no)+'</td><td><input class="cp-input" style="padding:6px" value="'+esc(c.front)+'" data-i="'+i+'" data-k="front"></td><td><input class="cp-input" style="padding:6px" value="'+esc(c.back)+'" data-i="'+i+'" data-k="back"></td><td>'+esc(c.class_level||aiClass)+'</td><td>'+esc(c.topic||topicName)+'</td></tr>').join('')
      +'</tbody></table>';
    preview.querySelectorAll('input').forEach(inp=>{
      inp.addEventListener('input',()=>{
        let i=parseInt(inp.dataset.i), k=inp.dataset.k;
        if(aiGenerated[i]) aiGenerated[i][k]=inp.value;
      });
    });
    if(actions) actions.style.display='flex';
    toast('generated '+aiGenerated.length+' cards — review then Confirm');
  }catch(e){
    console.error(e);
    if(preview) preview.innerHTML='<div style="color:#F87171;padding:10px">'+esc(e.message||'failed')+'</div>';
    toast(e.message||'AI failed');
  } finally {
    if(btn){ btn.textContent='Generate'; btn.disabled=false; }
  }
}
function clearAI(){
  aiGenerated=[];
  let p=document.getElementById('ai-preview'), a=document.getElementById('ai-actions');
  if(p){ p.style.display='none'; p.innerHTML=''; }
  if(a) a.style.display='none';
}
async function confirmAI(){
  if(!aiGenerated.length) return toast('nothing to add');
  ensureDb();
  let added=0;
  for(let c of aiGenerated){
    let payload={front:c.front, back:c.back, subject:c.subject||aiMeta.subject||'General', class_level:c.class_level||aiMeta.class_level||'11th', chapter:c.chapter||aiMeta.chapter||'', topic_no:(c.topic_no==null||c.topic_no==='')?aiMeta.topic_no:c.topic_no, topic:c.topic||aiMeta.topic||''};
    if(!db){
      let local={id:uid(),...payload, created_at:new Date().toISOString()};
      let a=g('official_flashcards',[]); a.unshift(local); s('official_flashcards',a); added++;
    } else {
      let res=await db.from('official_flashcards').insert(payload).select();
      if(!res.error) added++;
      else { let a=g('official_flashcards',[]); a.unshift({id:uid(),...payload}); s('official_flashcards',a); added++; }
    }
  }
  toast('added '+added+' cards');
  clearAI();
  closeM('m-fc');
  loadFc();
  loadDash();
}

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

/* ---- Screenshot payment requests: review + apply premium ---- */
// Exam periods come from js/plans.js when the panel is opened through a server
// that serves it, so prices/labels cannot drift from the site. The literal below
// is only a fallback for file:// use.
const EXAM_PERIODS_FALLBACK=[
 {id:'may-jun-2027',label:'May / June 2027',price:999,endsAt:'2027-06-30T23:59:59+05:00'},
 {id:'oct-nov-2027',label:'Oct / Nov 2027',price:1199,endsAt:'2027-11-30T23:59:59+05:00'},
 {id:'may-jun-2028',label:'May / June 2028',price:1399,endsAt:'2028-06-30T23:59:59+05:00'},
 {id:'oct-nov-2028',label:'Oct / Nov 2028',price:1599,endsAt:'2028-11-30T23:59:59+05:00'},
 {id:'may-jun-2029',label:'May / June 2029',price:1799,endsAt:'2029-06-30T23:59:59+05:00'},
 {id:'oct-nov-2029',label:'Oct / Nov 2029',price:1999,endsAt:'2029-11-30T23:59:59+05:00'}
];
let EXAM_PERIODS=EXAM_PERIODS_FALLBACK;
(function syncPlans(){
 try{
   if(typeof window==='undefined') return;
   if(!window.ANTEEM_PLANS){ var s=document.createElement('script'); s.src='../js/plans.js?v=1'; s.onload=function(){ if(window.ANTEEM_PLANS&&window.ANTEEM_PLANS.examPeriods){ EXAM_PERIODS=window.ANTEEM_PLANS.examPeriods; renderRequests(); } }; document.head.appendChild(s); return; }
   if(window.ANTEEM_PLANS.examPeriods) EXAM_PERIODS=window.ANTEEM_PLANS.examPeriods;
 }catch(_){}
})();
function lifetimePrice(){ try{ return (window.ANTEEM_PLANS&&window.ANTEEM_PLANS.lifetimePrice)||4999; }catch(_){ return 4999; } }
function fmtRs(n){ try{ return 'Rs '+Number(n).toLocaleString('en-PK'); }catch(_){ return 'Rs '+n; } }
function expectedAmount(plan,periodId){
 if(plan==='lifetime') return lifetimePrice();
 if(plan!=='exam') return 0;
 let per=EXAM_PERIODS.find(p=>p.id===periodId);
 return per?per.price:0;
}
let reqCache=[];
async function loadRequests(){
 ensureDb();
 let tb=document.getElementById('tb-requests'); if(!tb) return;
 tb.innerHTML='<tr><td colspan=9 style="text-align:center;padding:20px">loading…</td></tr>';
 if(!db){ tb.innerHTML='<tr><td colspan=9 style="text-align:center;color:var(--text-muted)">no database</td></tr>'; return; }
 let f=(document.getElementById('f-requests')&&document.getElementById('f-requests').value)||'pending';
 // Filter BEFORE order/limit. Chaining .eq() onto the result of .limit() only
 // works by accident on a real PostgrestFilterBuilder.
 let q=db.from('payment_requests').select('*');
 if(f!=='all') q=q.eq('status',f);
 q=q.order('created_at',{ascending:false}).limit(300);
 let res=await q;
 if(res.error){ tb.innerHTML='<tr><td colspan=9 style="text-align:center;color:#FBBF24;font-size:11px">'+esc(res.error.message)+'</td></tr>'; return; }
 reqCache=res.data||[];
 try{
   let ids=[...new Set(reqCache.map(r=>r.user_id).filter(Boolean))];
   if(ids.length){
     let pr=await db.from('profiles').select('id,username,email,plan_type').in('id',ids);
     let map={};
     (pr.data||[]).forEach(u=>{ map[u.id]=u; });
     reqCache.forEach(r=>{ r._user=map[r.user_id]||null; });
   }
 }catch(_){}
 renderRequests();
}
function reqQuery(){
 let el=document.getElementById('q-requests');
 return (el&&el.value||'').trim().toLowerCase();
}
function renderRequests(){
 let tb=document.getElementById('tb-requests'); if(!tb) return;
 let qy=reqQuery();
 let rows=reqCache.filter(r=>{
   if(!qy) return true;
   let u=r._user||{};
   return [u.username,u.email,r.sender_number,r.plan,r.status,r.method].join(' ').toLowerCase().includes(qy);
 });
 let sum=document.getElementById('rq-summary');
 if(sum) sum.textContent=rows.length+' shown'+(qy?' (filtered)':'')+' / '+reqCache.length+' loaded';
 tb.innerHTML=rows.map(r=>{
   let u=r._user||{};
   let who='<b>'+esc(u.username||'—')+'</b><div style="color:var(--text-muted);font-size:11px">'+esc(u.email||String(r.user_id||'').slice(0,8))+'</div>'
     +(u.plan_type?'<div style="font-size:10px;color:var(--text-muted)">now: '+esc(u.plan_type)+'</div>':'');
   let lock=r.status!=='pending'?' disabled':'';
   let planOpts=['exam','lifetime','free'].map(p=>'<option value="'+p+'"'+(r.plan===p?' selected':'')+'>'+p+'</option>').join('');
   let perOpts='<option value="">— no period —</option>'+EXAM_PERIODS.map(p=>'<option value="'+p.id+'"'+(r.exam_period===p.id?' selected':'')+'>'+esc(p.label)+'</option>').join('');
   // Warn when the amount the user sent does not match the plan we would apply.
   let amt=Number(r.amount)||0, exp=expectedAmount(r.plan,r.exam_period), mismatch=(exp&&amt!==exp);
   let amtCell='<b>'+esc(fmtRs(amt))+'</b>'+(mismatch?'<div style="font-size:10px;color:#FBBF24" title="expected '+esc(fmtRs(exp))+'">≠ '+esc(fmtRs(exp))+'</div>':'');
   let proof=r.screenshot_url
     ? '<a href="javascript:void(0)" onclick="viewProof(\''+r.id+'\')" title="view full size"><img src="'+esc(r.screenshot_url)+'" style="width:56px;height:40px;object-fit:cover;border-radius:6px;border:1px solid var(--border)" loading="lazy" onerror="this.style.opacity=.3"></a>'
     : '<span style="color:#FBBF24;font-size:11px">no proof</span>';
   let acts;
   if(r.status==='pending'){
     acts='<button class="cp-btn" style="padding:4px 10px" onclick="approveRequest(\''+r.id+'\')">Apply premium</button> '
        +'<button class="cp-btn ghost" onclick="editRequestNote(\''+r.id+'\')">note</button> '
        +'<button class="cp-btn ghost danger" style="padding:4px 8px" onclick="rejectRequest(\''+r.id+'\')">reject</button>';
   }else{
     acts='<span class="cp-badge '+(r.status==='approved'?'on':'')+'">'+esc(r.status)+'</span> '
        +'<button class="cp-btn ghost danger" style="padding:4px 8px;margin-top:4px" onclick="revokeRequest(\''+r.id+'\')">revoke</button>';
   }
   return '<tr><td>'+who+'</td>'
     +'<td><select class="cp-select" id="rq-plan-'+r.id+'" style="width:104px;padding:4px 6px;font-size:12px"'+lock+'>'+planOpts+'</select>'
     +'<div style="margin-top:4px"><select class="cp-select" id="rq-period-'+r.id+'" style="width:150px;padding:4px 6px;font-size:12px"'+lock+'>'+perOpts+'</div>'
     +(r.admin_note?'<div style="font-size:10px;color:var(--text-muted);margin-top:4px">note: '+esc(r.admin_note)+'</div>':'')+'</td>'
     +'<td>'+amtCell+'</td>'
     +'<td>'+esc(r.method||'—')+'</td>'
     +'<td style="font-size:11px">'+esc(r.sender_number||'—')+'</td>'
     +'<td>'+proof+'</td>'
     +'<td style="font-size:11px">'+esc((r.created_at||'').slice(0,16).replace('T',' '))+'</td>'
     +'<td>'+esc(r.status||'')+'</td>'
     +'<td style="white-space:nowrap">'+acts+'</td></tr>';
 }).join('')||'<tr><td colspan=9 style="text-align:center;color:var(--text-muted)">empty</td></tr>';
}
function viewProof(id){
 let r=reqCache.find(x=>String(x.id)===String(id)); if(!r||!r.screenshot_url) return toast('no proof');
 let img=document.getElementById('mp-img'), ttl=document.getElementById('mp-title'), sub=document.getElementById('mp-sub'), op=document.getElementById('mp-open');
 let u=r._user||{};
 if(img) img.src=r.screenshot_url;
 if(op){ op.href=r.screenshot_url; }
 if(ttl) ttl.textContent=(u.username||u.email||'Payment proof')+' — '+fmtRs(r.amount)+' '+String(r.method||'').toUpperCase();
 if(sub) sub.textContent='sent '+(r.created_at||'').slice(0,16).replace('T',' ')+(r.sender_number?' from '+r.sender_number:'');
 openM('m-proof');
}
function editRequestNote(id){
 let r=reqCache.find(x=>String(x.id)===String(id)); if(!r) return toast('not found');
 let note=prompt('Admin note for this request (shown to you only):', r.admin_note||'');
 if(note===null) return;
 saveRequestNote(id,note);
}
async function saveRequestNote(id,note){
 if(!isAuth()) return toast('not authorized');
 if(!db) return toast('no database');
 let res=await db.from('payment_requests').update({admin_note:note||null}).eq('id',id);
 if(res.error) return toast(res.error.message);
 let r=reqCache.find(x=>String(x.id)===String(id)); if(r) r.admin_note=note||null;
 renderRequests(); toast('note saved');
}
async function approveRequest(id){
 if(!isAuth()) return toast('not authorized');
 let r=reqCache.find(x=>String(x.id)===String(id)); if(!r) return toast('not found');
 if(!db) return toast('no database');
 if(!r.screenshot_url && !confirm('This request has NO screenshot attached. Approve anyway?')) return;
 let plan=((document.getElementById('rq-plan-'+id)||{}).value)||r.plan||'exam';
 let period=((document.getElementById('rq-period-'+id)||{}).value)||r.exam_period||'';
 let who=(r._user&&(r._user.username||r._user.email))||r.user_id;
 let exp=expectedAmount(plan,period), amt=Number(r.amount)||0;
 let msg='Apply "'+plan+'"'+(plan==='exam'&&period?' ('+((EXAM_PERIODS.find(p=>p.id===period)||{}).label||period)+')':'')+' to '+who+'?';
 if(exp&&amt&&amt!==exp) msg+='\n\nWARNING: they paid '+fmtRs(amt)+' but this plan is '+fmtRs(exp)+'.';
 if(plan==='free') msg+='\n\nThis will REMOVE their premium.';
 if(!confirm(msg)) return;

 // Claim the request FIRST. If the profile write then fails we put the request
 // back to pending, so a retry can never double-grant.
 let claim=await db.from('payment_requests').update({status:'approved',decided_at:new Date().toISOString()}).eq('id',id).eq('status','pending');
 if(claim.error) return toast(claim.error.message);
 let upd={ plan_type:plan, subscription_status:(plan==='free'?'inactive':'active'), exam_period:null, exam_ends_at:null };
 if(plan==='exam'){
   let per=EXAM_PERIODS.find(p=>p.id===period);
   if(per){ upd.exam_period=per.id; upd.exam_ends_at=per.endsAt; }
 }
 let u1=await db.from('profiles').update(upd).eq('id',r.user_id);
 if(u1.error){
   await db.from('payment_requests').update({status:'pending',decided_at:null}).eq('id',id);
   return toast('profile update failed: '+u1.error.message+' (request reopened)');
 }
 toast('premium applied: '+plan+' → '+who);
 loadRequests(); loadUsers(); loadDash();
}
async function rejectRequest(id){
 if(!isAuth()) return toast('not authorized');
 if(!db) return toast('no database');
 let r=reqCache.find(x=>String(x.id)===String(id));
 let who=r?((r._user&&(r._user.username||r._user.email))||r.user_id):id;
 if(!confirm('Reject the payment request from '+who+'? They will not get premium.')) return;
 let res=await db.from('payment_requests').update({status:'rejected',decided_at:new Date().toISOString()}).eq('id',id);
 if(res.error) return toast(res.error.message);
 toast('rejected');
 loadRequests();
}
async function revokeRequest(id){
 if(!isAuth()) return toast('not authorized');
 if(!db) return toast('no database');
 let r=reqCache.find(x=>String(x.id)===String(id)); if(!r) return toast('not found');
 let who=(r._user&&(r._user.username||r._user.email))||r.user_id;
 if(!confirm('Revoke premium from '+who+'?\n\nTheir account goes back to the free trial / locked state.')) return;
 let u1=await db.from('profiles').update({plan_type:'free',subscription_status:'inactive',exam_period:null,exam_ends_at:null}).eq('id',r.user_id);
 if(u1.error) return toast(u1.error.message);
 let u2=await db.from('payment_requests').update({status:'rejected',admin_note:'revoked by admin'}).eq('id',id);
 if(u2.error) return toast(u2.error.message);
 toast('premium revoked: '+who);
 loadRequests(); loadUsers(); loadDash();
}
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
function isBookRlsError(error){
 if(!error) return false;
 if(error.code==='42501') return true;
 return /row-level security/i.test(String(error.message||''));
}
async function saveBookViaEdge(rawId,payload){
 throw new Error('Book write blocked by RLS (anon key). Open panel on localhost for service-key access, or grant books write policy.');
}
  let fEbook=document.getElementById('f-ebook'); if(fEbook) fEbook.addEventListener('submit',async e=>{
   e.preventDefault();
   await loadTaxonomyOptions();
   let rawId=(document.getElementById('me-id').value||'').trim();
   let subjectLabel=(document.getElementById('me-subject').value||'').trim();
   let classLabel=(document.getElementById('me-class').value||'').trim();
   let boardRegion=(document.getElementById('me-board').value||'').trim();
   let fileEl=document.getElementById('me-pdf');
   let file=fileEl&&fileEl.files&&fileEl.files[0];
   let edition=(document.getElementById('me-edition').value||'').trim();
   let statusSel=(document.getElementById('me-status').value||'draft').trim();
   let totalPages=parseInt(document.getElementById('me-pages').value,10);
   let existingRecord=rawId?ebooksCache.find(x=>String(x.id)===String(rawId)):null;
   if(!EBOOK_SUBJECTS.includes(subjectLabel)) return toast('pick a subject');
   if(!EBOOK_CLASSES.includes(classLabel)) return toast('pick a class (11th or 12th)');
   if(!boardRegion) return toast('pick a board');
   if(!file&&!(existingRecord&&existingRecord.source_url)) return toast('upload a PDF file');
   if(file&&file.type!=='application/pdf'&&!/\.pdf$/i.test(file.name)) return toast('only PDF files are allowed');
   if(file&&file.size>50*1024*1024) return toast('PDF must be under 50MB');
   if(!edition) return toast('edition is required');
   if(!Number.isFinite(totalPages)||totalPages<=0) return toast('number of pages must be a positive number');
   if(!db) return toast('database connection is required for eBooks');
   let groupId=null;
   if(rawId){
    if(existingRecord&&existingRecord.group_id!=null&&existingRecord.group_id!=='') groupId=parseInt(existingRecord.group_id,10);
   }
   let subjectInfo, classId, boardId;
   try{
    subjectInfo=await resolveEbookSubject(subjectLabel);
    classId=await resolveEbookClass(classLabel,subjectInfo.education_system_id);
    boardId=await resolveEbookBoard(boardRegion);
   }catch(err){ return toast(err.message||'eBook save failed'); }
   let sourceUrl=existingRecord&&existingRecord.source_url||'';
   if(file){
    setEbookIngestStatus('Uploading PDF…');
    try{
     let uploaded=await uploadEbookPdf(file,subjectLabel,classLabel,boardRegion);
     if(sourceUrl&&sourceUrl!==uploaded){
      try{
       let oldPath=sourceUrl.split('/'+EBOOK_PDF_BUCKET+'/')[1];
       if(oldPath) await db.storage.from(EBOOK_PDF_BUCKET).remove([oldPath]);
      }catch(_){}
     }
     sourceUrl=uploaded;
    }catch(err){
     setEbookIngestStatus('');
     return toast(err.message||'PDF upload failed');
    }
    setEbookIngestStatus('');
    fileEl.value='';
   }
   let educationId=Number(subjectInfo.education_system_id);
   if(!Number.isFinite(educationId)) educationId=null;
   let title=subjectLabel+' Class '+(classLabel==='12th'?12:11);
   let isPublished=statusSel==='published';
   let payload={subject_id:subjectInfo.id,education_system_id:educationId,board_id:boardId,class_level_id:classId,group_id:Number.isFinite(groupId)?groupId:null,title,edition,total_pages:totalPages,source_url:sourceUrl,is_verified:isPublished,is_active:true};
   let res;
   try{
    if(rawId){
     res=await db.from('books').update(payload).eq('id',rawId).select('id').single();
     if(res.error){
      if(!isBookRlsError(res.error)) throw new Error(res.error.message);
      document.getElementById('me-id').value=await saveBookViaEdge(rawId,payload);
     } else {
      document.getElementById('me-id').value=res.data.id;
     }
    } else {
     let dup=await db.from('books').select('id,group_id').eq('subject_id',subjectInfo.id).eq('board_id',boardId).eq('class_level_id',classId);
     if(dup.error){
      if(!isBookRlsError(dup.error)) throw new Error(dup.error.message);
      document.getElementById('me-id').value=await saveBookViaEdge(null,payload);
     } else {
      let existing=(dup.data||[]).find(x=>String(x.group_id==null?'':x.group_id)===String(payload.group_id==null?'':payload.group_id));
      let targetId=existing?existing.id:null;
      if(targetId){
       res=await db.from('books').update(payload).eq('id',targetId).select('id').single();
      } else {
       res=await db.from('books').insert(payload).select('id').single();
      }
      if(res.error){
       if(!isBookRlsError(res.error)) throw new Error(res.error.message);
       document.getElementById('me-id').value=await saveBookViaEdge(targetId,payload);
      } else {
       document.getElementById('me-id').value=res.data.id;
      }
     }
    }
   }catch(err){
    return toast(err.message||'eBook save failed');
   }
   await loadEbooks();
   updateEbookIngestButton();
   toast('saved — Ingest PDF is now available');
  });
  let fPaper=document.getElementById('f-paper'); if(fPaper) fPaper.addEventListener('submit',async e=>{
  e.preventDefault();
  let id=document.getElementById('mp-id').value.trim();
  let fileEl=document.getElementById('mp-file');
  let file=fileEl&&fileEl.files&&fileEl.files[0];
  let existing=id?papersCache.find(x=>String(x.id)===String(id)):null;
  let existingPath=existing&&(existing.file_path||existing.file_url||existing.source_url)||'';
  let payload={
   title:document.getElementById('mp-title').value.trim()||'Untitled Paper',
   board_id:parseInt(document.getElementById('mp-board').value)||null,
   subject_id:parseInt(document.getElementById('mp-subject').value)||null,
   class_level_id:parseInt(document.getElementById('mp-class').value)||null,
   year:parseInt(document.getElementById('mp-year').value)||null,
   paper_type:document.getElementById('mp-type').value||'annual',
   file_path:existingPath,
   status:document.getElementById('mp-status').value||'published'
  };
  if(!payload.year) return toast('year required');
  if(!file&&!existingPath) return toast('upload a PDF file');
  if(file&&file.type!=='application/pdf'&&!/\.pdf$/i.test(file.name)) return toast('only PDF files are allowed');
  if(file&&file.size>50*1024*1024) return toast('PDF must be under 50MB');
  if(!db){
   let local={id:uid(),...payload,board:boardName(payload.board_id),subject:subjectName(payload.subject_id),type:payload.paper_type,file_url:payload.file_path,created_at:new Date().toISOString()};
   upLocal('pastpapers',local); closeM('m-paper'); loadPapers(); return toast('saved (local)');
  }
  if(file){
   toast('uploading PDF…');
   try{
    let uploaded=await uploadPaperPdf(file,payload.title);
    if(existingPath&&existingPath!==uploaded){
     try{
      let oldPath=existingPath.split('/'+PAPER_PDF_BUCKET+'/')[1];
      if(oldPath) await db.storage.from(PAPER_PDF_BUCKET).remove([oldPath]);
     }catch(_){}
    }
    payload.file_path=uploaded;
   }catch(err){ return toast(err.message||'PDF upload failed'); }
   fileEl.value='';
  }
  let res;
  if(!id){ res=await db.from('past_papers').insert(payload).select().single(); }
  else { res=await db.from('past_papers').update(payload).eq('id',id).select().single(); }
  if(res.error){ toast(res.error.message); return; }
  closeM('m-paper'); await loadPapers(); toast('saved');
 });
 let fNote=document.getElementById('f-note'); if(fNote) fNote.addEventListener('submit',async e=>{e.preventDefault();let p={id:document.getElementById('mn-id').value,title:document.getElementById('mn-title').value,subject:document.getElementById('mn-subject').value,chapter:document.getElementById('mn-chapter').value,content:document.getElementById('mn-content').value,status:document.getElementById('mn-status').value}; if(!db){ upLocal('notes',p); closeM('m-note'); loadNotes(); return toast('saved (local)'); } let res=await db.from('board_notes').upsert(p,{onConflict:'id'}); if(res.error){ upLocal('notes',p); toast(res.error.message+' — saved locally'); } closeM('m-note'); loadNotes(); toast('saved');});
  let fFc=document.getElementById('f-fc'); if(fFc) fFc.addEventListener('submit',async e=>{
   e.preventDefault();
   let id=document.getElementById('mf-id').value.trim();
   let p={front:document.getElementById('mf-front').value.trim(),back:document.getElementById('mf-back').value.trim(),subject:document.getElementById('ai-subject').value||'Physics', class_level:document.getElementById('ai-class').value||'11th', chapter:document.getElementById('ai-chapter').value.trim()||'', topic_no:parseFloat(document.getElementById('ai-topicno').value)||1, topic:document.getElementById('ai-topic').value.trim()||''};
   console.log('[FC SAVE] id=',id,'db=',!!db,'payload=',p);
   if(!p.front) return toast('front required');
   if(!db){ console.warn('[FC SAVE] db is null — saving locally only'); let local={id:id||uid(),...p}; upLocal('official_flashcards',local); closeM('m-fc'); loadFc(); return toast('saved (local)'); }
   let res; if(!id) res=await db.from('official_flashcards').insert(p).select().single(); else res=await db.from('official_flashcards').update(p).eq('id',id).select().single();
   console.log('[FC SAVE] res=',res);
   if(res.error){ console.error('[FC SAVE] ERROR:',res.error); upLocal('official_flashcards',{id:id||uid(),...p}); closeM('m-fc'); loadFc(); return toast(res.error.message+' — saved locally'); }
   closeM('m-fc'); loadFc(); toast('saved');
  });
 let fDef=document.getElementById('f-def'); if(fDef) fDef.addEventListener('submit',async e=>{e.preventDefault();let p={id:document.getElementById('md-id').value,term:document.getElementById('md-term').value,definition:document.getElementById('md-def').value,subject:document.getElementById('md-subject').value}; if(!db){ upLocal('definitions',p); closeM('m-def'); loadDefs(); return toast('saved (local)'); } let res=await db.from('definitions').upsert(p,{onConflict:'id'}); if(res.error){ upLocal('definitions',p); toast(res.error.message+' — saved locally'); } closeM('m-def'); loadDefs(); toast('saved');});
 let fTest=document.getElementById('f-test'); if(fTest) fTest.addEventListener('submit',async e=>{e.preventDefault();let p={id:document.getElementById('mt-id').value,title:document.getElementById('mt-title').value,subject:document.getElementById('mt-subject').value,questions:parseInt(document.getElementById('mt-qs').value)||20,difficulty:document.getElementById('mt-diff').value}; if(!db){ upLocal('testbuilder',p); closeM('m-test'); loadTests(); return toast('saved (local)'); } let res=await db.from('test_templates').upsert(p,{onConflict:'id'}); if(res.error){ upLocal('testbuilder',p); toast(res.error.message+' — saved locally'); } closeM('m-test'); loadTests(); toast('saved');});
 let fModel=document.getElementById('f-model'); if(fModel) fModel.addEventListener('submit',async e=>{e.preventDefault();let p={id:document.getElementById('mm-id').value,name:document.getElementById('mm-name').value,role:document.getElementById('mm-role').value,provider_index:parseInt(document.getElementById('mm-prov').value)||0,system_prompt:document.getElementById('mm-prompt').value}; if(!db){ upLocal('models',p); closeM('m-model'); loadAI(); return toast('saved (local)'); } let res=await db.from('ai_models').upsert(p,{onConflict:'id'}); if(res.error){ upLocal('models',p); toast(res.error.message+' — saved locally'); } closeM('m-model'); loadAI(); toast('saved');});
 let fKey=document.getElementById('f-key'); if(fKey) fKey.addEventListener('submit',async e=>{e.preventDefault();let p={id:document.getElementById('mk-id').value,provider:document.getElementById('mk-prov').value,key_masked:document.getElementById('mk-key').value,model:document.getElementById('mk-model').value,active:document.getElementById('mk-on').checked}; if(!db){ upLocal('apikeys',p); closeM('m-key'); loadKeys(); return toast('saved (local)'); } let res=await db.from('api_keys').upsert(p,{onConflict:'id'}); if(res.error){ upLocal('apikeys',p); toast(res.error.message+' — saved locally'); } closeM('m-key'); loadKeys(); toast('saved');});
 let fCoupon=document.getElementById('f-coupon'); if(fCoupon) fCoupon.addEventListener('submit',async e=>{e.preventDefault();let p={id:document.getElementById('mc-id').value,code:document.getElementById('mc-code').value.toUpperCase(),discount:parseInt(document.getElementById('mc-disc').value)||0,expires_at:document.getElementById('mc-exp').value||null,active:document.getElementById('mc-on').checked}; if(!db){ upLocal('coupons',p); closeM('m-coupon'); loadCoupons(); return toast('saved (local)'); } let res=await db.from('coupons').upsert(p,{onConflict:'id'}); if(res.error){ upLocal('coupons',p); toast(res.error.message+' — saved locally'); } closeM('m-coupon'); loadCoupons(); toast('saved');});
 let fTax=document.getElementById('f-tax'); if(fTax) fTax.addEventListener('submit',async e=>{e.preventDefault();let t=document.getElementById('mx-type').value,table={board:'boards',class_level:'class_levels',subject:'subjects'}[t]||'boards';let p={id:document.getElementById('mx-id').value,name:document.getElementById('mx-name').value,code:document.getElementById('mx-code').value}; if(!db){ upLocal('taxonomy',p); closeM('m-tax'); loadTax(); return toast('saved (local)'); } let res=await db.from(table).upsert(p,{onConflict:'id'}); if(res.error){ upLocal('taxonomy',p); toast(res.error.message+' — saved locally'); } closeM('m-tax'); loadTax(); toast('saved');});
 let fBoard=document.getElementById('f-board'); if(fBoard) fBoard.addEventListener('submit',async e=>{e.preventDefault();let id=document.getElementById('mb-id').value.trim();let payload={name:document.getElementById('mb-name').value.trim(),region:document.getElementById('mb-region').value.trim()||'Punjab'}; if(!payload.name) return toast('name required'); if(!id){ let res=await db.from('boards').insert(payload).select().single(); if(res.error) return toast(res.error.message); } else { let res=await db.from('boards').update(payload).eq('id',id); if(res.error) return toast(res.error.message); } closeM('m-board'); await loadBoards(); await loadTaxonomyOptions(); toast('saved'); });
 let qBoards=document.getElementById('q-boards'); if(qBoards) qBoards.addEventListener('input',()=>{ let tb=document.getElementById('tb-boards'); if(!tb) return; let q=qBoards.value.toLowerCase(); let d=boardsCache.filter(x=>!q||x.name.toLowerCase().includes(q)); tb.innerHTML=d.map(x=>'<tr><td>'+x.id+'</td><td><b>'+esc(x.name)+'</b></td><td>'+esc(x.region||'')+'</td><td><button class="cp-btn ghost" style="padding:4px 8px" onclick="editBoard(\''+x.id+'\')">edit</button> <button class="cp-btn ghost danger" style="padding:4px 8px" onclick="delBoard(\''+x.id+'\')">del</button></td></tr>').join('')||'<tr><td colspan=4 style="text-align:center;color:var(--text-muted)">no boards</td></tr>'; });
 let qs=['q-users','q-ebooks','q-papers','q-notes','q-fc','q-defs','q-tax']; qs.forEach(id=>{ let el=document.getElementById(id); if(el) el.addEventListener('input',()=>{ if(id==='q-users')renderUsers(); if(id==='q-ebooks')renderEbooks(); if(id==='q-papers')renderPapers(); if(id==='q-notes')renderNotes(); if(id==='q-fc')renderFc(); if(id==='q-defs')renderDefs(); if(id==='q-tax')renderTaxFromCache(); }); });
 let fu=document.getElementById('f-users'); if(fu) fu.addEventListener('change',renderUsers); let fr=document.getElementById('f-requests'); if(fr) fr.addEventListener('change',loadRequests); let qr=document.getElementById('q-requests'); if(qr){ let qt=null; qr.addEventListener('input',function(){ clearTimeout(qt); qt=setTimeout(renderRequests,150); }); } let fp=document.getElementById('f-papers'); if(fp) fp.addEventListener('change',renderPapers); let ft=document.getElementById('f-tax'); if(ft) ft.addEventListener('change',loadTax);
 // bulk select-all for flashcards
 let selAll=document.getElementById('fc-select-all');
 if(selAll && !selAll.dataset.bound){
   selAll.dataset.bound='1';
   selAll.addEventListener('change',()=>{
     let checked=selAll.checked;
     document.querySelectorAll('#tb-fc .fc-chk').forEach(ch=>{
       ch.checked=checked;
       let id=ch.dataset.id;
       if(checked) fcSelected.add(String(id)); else fcSelected.delete(String(id));
     });
     updateFcBulkUI();
   });
 }
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',initMain); else initMain();
window.nav=nav;window.viewProof=viewProof;window.approveRequest=approveRequest;window.rejectRequest=rejectRequest;window.revokeRequest=revokeRequest;window.editRequestNote=editRequestNote; window.logout=logout; window.loadBoards=loadBoards; window.generateFlashcardsAI=generateFlashcardsAI; window.clearAI=clearAI; window.confirmAI=confirmAI; window.ingestEbook=ingestEbook; window.scanFolder=scanFolder; window.bulkAdd=bulkAdd; window.editBoard=editBoard; window.delBoard=delBoard; window.openM=openM; window.closeM=closeM; window.bulkDelFc=bulkDelFc; window.delFc=delFc; window.editFc=editFc;
try{ let m=document.getElementById('db-mode'); if(m) m.textContent='mode: '+(location.hostname==='127.0.0.1'||location.hostname==='localhost'?'service_role (localhost)':'anon')+' @ '+SUPABASE_URL; }catch(e){}
setTimeout(()=>{ try{ensureDb(); if(document.getElementById('app') && document.getElementById('app').style.display!=='none') loadDash(); }catch(e){} },800);
