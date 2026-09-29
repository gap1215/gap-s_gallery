const $=s=>document.querySelector(s), $$=s=>document.querySelectorAll(s);
const cfg=window.PHOTO_ARCHIVE_CONFIG||{};
const dbMode=!!(cfg.supabaseUrl&&cfg.supabasePublishableKey&&window.supabase);
const sb=dbMode?window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey):null;

const state={loggedIn:false,role:null,editingId:null,categories:[],albums:[],admins:[]};
const demo={
 categories:[{id:"c1",name:"Goodzone"},{id:"c2",name:"Личное"}],
 albums:[
 {id:"a1",name:"Berlin",categoryId:"c1",access:"public",cover:"https://picsum.photos/seed/berlin/900/700",photos:["https://picsum.photos/seed/b1/1200/900","https://picsum.photos/seed/b2/900/1200","https://picsum.photos/seed/b3/1200/800"]},
 {id:"a2",name:"Architecture",categoryId:"c1",access:"public",cover:"https://picsum.photos/seed/arch/900/700",photos:["https://picsum.photos/seed/a1/1200/900","https://picsum.photos/seed/a2/900/1200"]},
 {id:"a3",name:"Night Walk",categoryId:"c1",access:"password",cover:"https://picsum.photos/seed/night/900/700",photos:["https://picsum.photos/seed/n1/1200/900","https://picsum.photos/seed/n2/900/1200"]},
 {id:"a4",name:"Summer",categoryId:"c2",access:"public",cover:"https://picsum.photos/seed/summer/900/700",photos:["https://picsum.photos/seed/s1/1200/900","https://picsum.photos/seed/s2/900/1200","https://picsum.photos/seed/s3/1200/900"]}
 ]
};
function esc(t){const d=document.createElement("div");d.textContent=t??"";return d.innerHTML}
function placeholder(id){return `https://picsum.photos/seed/${encodeURIComponent(id)}/900/700`}
function modal(id,on=true){$("#"+id).classList.toggle("show",on)}
let toastTimer=null;
function notify(msg,type="info"){const t=$("#appToast");if(!t)return;t.textContent=msg;t.className="app-toast show"+(type==="error"?" error":"");clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.className="app-toast",3200)}
function showLoginError(msg){let e=$("#loginError");if(!e){e=document.createElement("div");e.id="loginError";e.className="login-error";$("#loginForm").appendChild(e)}e.textContent=msg||""}

async function loadData(){
 if(!dbMode){state.categories=structuredClone(demo.categories);state.albums=structuredClone(demo.albums);return}
 const [{data:cats,error:ce},{data:albums,error:ae}]=await Promise.all([
   sb.from("categories").select("id,name,sort_order").order("sort_order").order("created_at"),
   sb.from("albums").select("id,category_id,name,access_type,cover_url,cover_preview_url,sort_order").order("sort_order").order("created_at")
 ]);
 if(ce||ae){console.error(ce||ae);return}
 state.categories=(cats||[]).map(c=>({id:c.id,name:c.name}));
 state.albums=(albums||[]).map(a=>({id:a.id,name:a.name,categoryId:a.category_id,access:a.access_type,coverPath:a.cover_url||null,coverPreviewPath:a.cover_preview_url||null,cover:(a.cover_preview_url||a.cover_url)||placeholder(a.id),sortOrder:a.sort_order??0,photos:[]}));
}
async function loadSession(){
 if(!dbMode)return;
 let {data:{session}}=await sb.auth.getSession();
 // Если пользователь снял «Оставаться в системе», сохраняем вход только
 // на время текущего сеанса браузера. Перезагрузка страницы вход не сбрасывает.
 if(session && localStorage.getItem("galleryRememberMe")==="0" && sessionStorage.getItem("gallerySessionActive")!=="1"){
   await sb.auth.signOut();
   session=null;
 }
 state.loggedIn=!!session;
 state.role=null;
 if(session){const {data}=await sb.from("profiles").select("role").eq("id",session.user.id).maybeSingle();state.role=data?.role||null;state.loggedIn=!!state.role}
}
function syncAdmin(){
 $$(".admin-only").forEach(x=>x.classList.toggle("hidden",!state.loggedIn));
 $("#loginBtn").classList.toggle("hidden",state.loggedIn);
 $("#ownerUsersBtn").classList.toggle("hidden",!(state.loggedIn&&state.role==="owner"&&!dbMode));
 render();
}
function render(){
 const g=$("#gallery");g.innerHTML="";
 state.categories.forEach((c,i)=>{
   const albums=state.albums.filter(a=>a.categoryId===c.id);
   if(!albums.length&&!state.loggedIn)return;
   const s=document.createElement("section");s.className="category-section";
   s.innerHTML=`<div class="category-header"><span class="category-number">${String(i+1).padStart(2,"0")}</span><h2>${esc(c.name)}</h2><div class="category-line"></div>${state.loggedIn?`<button class="category-edit" data-cat="${c.id}">Изменить</button>`:""}</div><div class="album-scroll"><div class="album-row"></div></div>`;
   const row=s.querySelector(".album-row");
   albums.forEach((a,j)=>{
     const card=document.createElement("article");
     card.className=`album-card ${j%2?"album-down":"album-up"}`;
     card.dataset.albumId=a.id;
     card.dataset.albumIndex=String(j);
     card.innerHTML=`<div class="album-image"><img src="${a.cover||placeholder(a.id)}" alt="" loading="lazy"><div class="album-shade"></div></div><div class="album-title"><strong>${esc(a.name)}</strong><small>${a.photos.length?`${a.photos.length} фото`:dbMode?"альбом":"0 фото"}</small></div>`;
     card.onclick=()=>{if(card.dataset.justDragged==="1"){card.dataset.justDragged="0";return}openAlbum(a)};
     if(state.loggedIn) setupAlbumReorder(card,c.id,j,row);
     row.appendChild(card);
   });
   if(state.loggedIn){const add=document.createElement("button");add.className="add-album";add.textContent="+ Добавить альбом";add.onclick=()=>newAlbum(c.id);row.appendChild(add)}
   g.appendChild(s)
 });
 $$("[data-cat]").forEach(b=>b.onclick=()=>editCategory(b.dataset.cat));
}

let draggedAlbum=null;
let albumPointerDrag=null;

async function persistAlbumOrder(categoryId){
  const albums=state.albums.filter(a=>a.categoryId===categoryId);
  albums.forEach((a,i)=>a.sortOrder=i);
  if(!dbMode)return;
  const results=await Promise.all(albums.map((a,i)=>sb.from("albums").update({sort_order:i}).eq("id",a.id)));
  const failed=results.find(r=>r.error);
  if(failed){
    console.error(failed.error);
    notify("Порядок альбомов изменён на экране, но не удалось сохранить его.","error");
  }
}

function moveAlbumInCategory(categoryId,from,to){
  if(from===to||from<0||to<0)return false;
  const categoryAlbums=state.albums.filter(a=>a.categoryId===categoryId);
  if(from>=categoryAlbums.length||to>=categoryAlbums.length)return false;
  const [moved]=categoryAlbums.splice(from,1);
  categoryAlbums.splice(to,0,moved);
  let n=0;
  state.albums=state.albums.map(a=>a.categoryId===categoryId?categoryAlbums[n++]:a);
  return true;
}

function setupAlbumReorder(card,categoryId,index,row){
  // V38: use Pointer Events for every device instead of native HTML5 drag-and-drop.
  // Native drag creates a rectangular browser "ghost" around clipped triangles.
  card.draggable=false;

  card.addEventListener("pointerdown",e=>{
    if(e.button!==undefined&&e.button!==0)return;
    albumPointerDrag={
      pointerId:e.pointerId,
      categoryId,
      from:index,
      to:index,
      startX:e.clientX,
      startY:e.clientY,
      active:false,
      card
    };
  });

  card.addEventListener("pointermove",e=>{
    const d=albumPointerDrag;
    if(!d||d.pointerId!==e.pointerId)return;

    const dx=e.clientX-d.startX;
    const dy=e.clientY-d.startY;

    if(!d.active){
      if(Math.abs(dx)<10&&Math.abs(dy)<10)return;

      // On touch, vertical movement remains normal page scrolling.
      if(e.pointerType!=="mouse"&&Math.abs(dy)>Math.abs(dx)){
        albumPointerDrag=null;
        return;
      }

      d.active=true;
      d.card.classList.add("album-dragging");
      try{d.card.setPointerCapture(e.pointerId)}catch{}
    }

    e.preventDefault();

    // Temporarily ignore the dragged card so elementFromPoint can see
    // the album underneath the pointer.
    d.card.classList.add("album-pointer-hit-test-off");
    const hit=document.elementFromPoint(e.clientX,e.clientY)?.closest(".album-card");
    d.card.classList.remove("album-pointer-hit-test-off");

    $$(".album-card").forEach(x=>x.classList.remove("album-drag-over"));
    if(hit&&hit.closest(".album-row")===row){
      const to=Number(hit.dataset.albumIndex);
      if(Number.isInteger(to)){
        d.to=to;
        if(hit!==d.card)hit.classList.add("album-drag-over");
      }
    }
  });

  const finishPointer=async e=>{
    const d=albumPointerDrag;
    if(!d||d.pointerId!==e.pointerId)return;

    albumPointerDrag=null;
    $$(".album-card").forEach(x=>x.classList.remove("album-dragging","album-drag-over","album-pointer-hit-test-off"));

    if(!d.active)return;

    d.card.dataset.justDragged="1";
    if(!moveAlbumInCategory(categoryId,d.from,d.to))return;
    render();
    await persistAlbumOrder(categoryId);
  };

  card.addEventListener("pointerup",finishPointer);
  card.addEventListener("pointercancel",e=>{
    const d=albumPointerDrag;
    if(!d||d.pointerId!==e.pointerId)return;
    albumPointerDrag=null;
    $$(".album-card").forEach(x=>x.classList.remove("album-dragging","album-drag-over","album-pointer-hit-test-off"));
  });
}

let lightboxUrls=[],lightboxIndex=0;
let viewerPhotoUrls=[];
let viewerAlbumName="album";
let currentViewerAlbumId=null;
const albumDownloadPasswords=new Map();
function openPhotoLightbox(urls,index){
 lightboxUrls=urls.slice();lightboxIndex=index;updatePhotoLightbox();$("#photoLightbox").classList.add("show");$("#photoLightbox").setAttribute("aria-hidden","false");
}
function updatePhotoLightbox(){
 const src=lightboxUrls[lightboxIndex];if(!src)return;$("#lightboxImage").src=src;$("#photoCounter").textContent=`${lightboxIndex+1} / ${lightboxUrls.length}`;
 $("#prevPhotoBtn").classList.toggle("hidden",lightboxUrls.length<2);$("#nextPhotoBtn").classList.toggle("hidden",lightboxUrls.length<2);
}
function closePhotoLightbox(){$("#photoLightbox").classList.remove("show");$("#photoLightbox").setAttribute("aria-hidden","true");$("#lightboxImage").src=""}
function stepPhoto(delta){if(!lightboxUrls.length)return;lightboxIndex=(lightboxIndex+delta+lightboxUrls.length)%lightboxUrls.length;updatePhotoLightbox()}
async function downloadCurrentPhoto(){
 const displaySrc=lightboxUrls[lightboxIndex];if(!displaySrc)return;const src=originalUrlByDisplayUrl.get(displaySrc)||displaySrc;const btn=$("#downloadPhotoBtn");btn.disabled=true;
 try{const r=await fetch(src);if(!r.ok)throw new Error("download");const blob=await r.blob();const u=URL.createObjectURL(blob);const a=document.createElement("a");a.href=u;a.download=`photo-${String(lightboxIndex+1).padStart(2,"0")}.${blob.type.includes("png")?"png":blob.type.includes("webp")?"webp":"jpg"}`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000)}catch(e){window.open(src,"_blank")}finally{btn.disabled=false}
}
function safeDownloadName(name){
 return String(name||"album").trim().replace(/[\\/:*?"<>|]+/g,"-").replace(/\s+/g," ")||"album";
}
function extensionFromBlob(blob){
 const type=(blob.type||"").toLowerCase();
 if(type.includes("png"))return "png";
 if(type.includes("webp"))return "webp";
 if(type.includes("gif"))return "gif";
 if(type.includes("avif"))return "avif";
 if(type.includes("heic")||type.includes("heif"))return "heic";
 return "jpg";
}
async function downloadWholeAlbum(){
 const btn=$("#downloadAlbumBtn");
 const albumId=currentViewerAlbumId;
 if(!albumId){notify("Альбом не выбран.","error");return}
 if(!window.JSZip){notify("Модуль ZIP не загрузился. Обновите страницу и попробуйте ещё раз.","error");return}
 const album=state.albums.find(a=>a.id===albumId);
 if(!album){notify("Не удалось найти открытый альбом.","error");return}
 const originalText=btn.textContent;
 btn.disabled=true;
 try{
  btn.textContent="Проверяем доступ…";
  const headers={"Content-Type":"application/json","apikey":cfg.supabasePublishableKey};
  // Always ask Supabase for the current session here.
  // Do not rely on the UI state flag: the download function needs the real JWT.
  const {data:{session},error:sessionError}=await sb.auth.getSession();
  if(sessionError)console.warn("Could not read admin session for album download:",sessionError);
  if(session?.access_token)headers.Authorization=`Bearer ${session.access_token}`;
  const params=new URLSearchParams(location.search);
  const token=(params.get("album")===albumId?params.get("token"):null);
  const password=albumDownloadPasswords.get(albumId)||null;
  const response=await fetch(`${cfg.supabaseUrl}/functions/v1/album-download`,{
   method:"POST",headers,body:JSON.stringify({albumId,password,token})
  });
  let payload={};try{payload=await response.json()}catch{}
  if(!response.ok)throw new Error(payload.error||"Не удалось получить доступ к альбому");
  const files=payload.files||[];
  if(!files.length){notify("В альбоме пока нет фотографий.");return}
  const zip=new JSZip();
  // Download a few ORIGINAL files in parallel. This changes only transfer speed:
  // blobs are stored in the ZIP byte-for-byte with STORE (no recompression).
  const concurrency=Math.min(3,files.length);
  let nextIndex=0;
  let completed=0;
  btn.textContent=`Скачиваем 0 / ${files.length}`;
  async function downloadWorker(){
   while(true){
    const i=nextIndex++;
    if(i>=files.length)return;
    const fileResponse=await fetch(files[i].url);
    if(!fileResponse.ok)throw new Error(`Не удалось скачать фото ${i+1}`);
    const blob=await fileResponse.blob();
    zip.file(files[i].filename,blob,{compression:"STORE"});
    completed++;
    btn.textContent=`Скачиваем ${completed} / ${files.length}`;
   }
  }
  await Promise.all(Array.from({length:concurrency},()=>downloadWorker()));
  btn.textContent="Создаём ZIP…";
  const archive=await zip.generateAsync({type:"blob",compression:"STORE"});
  const url=URL.createObjectURL(archive);
  const link=document.createElement("a");
  link.href=url;link.download=`${safeDownloadName(payload.albumName||album.name||viewerAlbumName)}.zip`;
  document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  notify("Альбом подготовлен к скачиванию.");
 }catch(error){
  console.error("album download failed",error);
  notify(error?.message||"Не удалось скачать весь альбом. Попробуйте ещё раз.","error");
 }finally{btn.disabled=false;btn.textContent=originalText}
}

function renderViewerPhotos(a,urls){
 viewerPhotoUrls=urls.slice();
 viewerAlbumName=a.name||"album";
 currentViewerAlbumId=a.id;
 $("#viewerTitle").textContent=a.name;$("#viewer").dataset.albumId=a.id;const grid=$("#viewerGrid");grid.innerHTML="";
 urls.forEach((src,index)=>{const im=document.createElement("img");im.src=src;im.loading="lazy";im.alt=`${a.name} — фото ${index+1}`;im.onclick=()=>openPhotoLightbox(urls,index);grid.appendChild(im)});
 if(!urls.length)grid.innerHTML='<div class="viewer-error">В этом альбоме пока нет фотографий.</div>';
 $("#viewerEditBtn").classList.toggle("hidden",!state.loggedIn);$("#viewer").classList.add("show");document.body.style.overflow="hidden";
}
async function requestAlbumAccess(a,password=null,token=null){
 const res=await fetch(`${cfg.supabaseUrl}/functions/v1/album-access`,{method:"POST",headers:{"Content-Type":"application/json","apikey":cfg.supabasePublishableKey},body:JSON.stringify({albumId:a.id,password,token})});
 let data={};try{data=await res.json()}catch{}
 return {ok:res.ok,status:res.status,data};
}
let pendingPasswordAlbum=null;
async function openAlbum(a){
 currentViewerAlbumId=a.id;
 if(!dbMode){renderViewerPhotos(a,a.photos);return}
 if(state.loggedIn){
  $("#viewerTitle").textContent=a.name;$("#viewerGrid").innerHTML='<div class="viewer-loading">Загружаем фотографии…</div>';$("#viewerEditBtn").classList.remove("hidden");$("#viewer").classList.add("show");document.body.style.overflow="hidden";
  if(!a.photosLoaded)await loadAlbumPhotos(a);
  renderViewerPhotos(a,a.photos);return
 }
 $("#viewerTitle").textContent=a.name;$("#viewerGrid").innerHTML='<div class="viewer-loading">Загружаем фотографии…</div>';$("#viewerEditBtn").classList.add("hidden");$("#viewer").classList.add("show");document.body.style.overflow="hidden";
 const params=new URLSearchParams(location.search), token=(params.get("album")===a.id?params.get("token"):null);
 try{
  const r=await requestAlbumAccess(a,null,token);
  if(r.ok){const urls=(r.data.photos||[]).map(p=>{const display=p.previewUrl||p.url;if(display&&p.url)originalUrlByDisplayUrl.set(display,p.url);return display}).filter(Boolean);renderViewerPhotos(a,urls);return}
  if(r.data?.requiresPassword||a.access==="password"){closeViewer();pendingPasswordAlbum=a;$("#passwordAlbumTitle").textContent=a.name;$("#visitorAlbumPassword").value="";$("#albumPasswordError").textContent="";modal("albumPasswordModal");setTimeout(()=>$("#visitorAlbumPassword").focus(),50);return}
  $("#viewerGrid").innerHTML='<div class="viewer-error">Эта приватная ссылка недействительна или устарела.</div>';
 }catch(e){console.error(e);$("#viewerGrid").innerHTML='<div class="viewer-error">Не удалось открыть альбом. Попробуйте ещё раз.</div>'}
}
function closeViewer(){$("#viewer").classList.remove("show");document.body.style.overflow="";currentViewerAlbumId=null}
$("#closePhotoLightbox").onclick=closePhotoLightbox;
$("#prevPhotoBtn").onclick=()=>stepPhoto(-1);
$("#nextPhotoBtn").onclick=()=>stepPhoto(1);
$("#downloadPhotoBtn").onclick=downloadCurrentPhoto;
$("#downloadAlbumBtn").onclick=downloadWholeAlbum;
$("#photoLightbox").onclick=e=>{if(e.target===$("#photoLightbox")||e.target.classList.contains("photo-lightbox-stage"))closePhotoLightbox()};
document.addEventListener("keydown",e=>{if(!$("#photoLightbox").classList.contains("show"))return;if(e.key==="Escape")closePhotoLightbox();if(e.key==="ArrowLeft")stepPhoto(-1);if(e.key==="ArrowRight")stepPhoto(1)});

// Mobile swipe navigation in the full-screen photo viewer.
let lightboxTouchStartX=0,lightboxTouchStartY=0,lightboxTouchActive=false;
const lightboxStage=$(".photo-lightbox-stage");
lightboxStage.addEventListener("touchstart",e=>{
 if(e.touches.length!==1)return;
 lightboxTouchStartX=e.touches[0].clientX;lightboxTouchStartY=e.touches[0].clientY;lightboxTouchActive=true;
},{passive:true});
lightboxStage.addEventListener("touchend",e=>{
 if(!lightboxTouchActive||!e.changedTouches.length)return;
 lightboxTouchActive=false;
 const dx=e.changedTouches[0].clientX-lightboxTouchStartX,dy=e.changedTouches[0].clientY-lightboxTouchStartY;
 if(Math.abs(dx)<48||Math.abs(dx)<=Math.abs(dy)*1.15)return;
 stepPhoto(dx<0?1:-1);
},{passive:true});
lightboxStage.addEventListener("touchcancel",()=>{lightboxTouchActive=false},{passive:true});

$("#loginBtn").onclick=()=>{showLoginError("");modal("loginModal")};
$("#loginForm").onsubmit=async e=>{
 e.preventDefault();showLoginError("");
 if(!dbMode){state.loggedIn=true;state.role="owner";modal("loginModal",false);syncAdmin();return}
 const email=$("#email").value.trim(),password=$("#password").value;
 const remember=$("#rememberMe")?.checked!==false;
 const {data,error}=await sb.auth.signInWithPassword({email,password});
 if(error){showLoginError("Не удалось войти. Проверьте email и пароль.");return}
 const {data:profile}=await sb.from("profiles").select("role").eq("id",data.user.id).maybeSingle();
 if(!profile?.role){await sb.auth.signOut();showLoginError("У этого аккаунта нет прав администратора.");return}
 localStorage.setItem("galleryRememberMe",remember?"1":"0");
 if(remember) sessionStorage.removeItem("gallerySessionActive");
 else sessionStorage.setItem("gallerySessionActive","1");
 state.loggedIn=true;state.role=profile.role;modal("loginModal",false);await loadData();await loadAlbumCovers();syncAdmin();
};
$("#logoutBtn").onclick=async()=>{if(dbMode)await sb.auth.signOut();sessionStorage.removeItem("gallerySessionActive");state.loggedIn=false;state.role=null;await loadData();syncAdmin()};
$("#closeViewer").onclick=closeViewer;
$("#viewerEditBtn").onclick=()=>{const id=$("#viewer").dataset.albumId;if(!id)return;closeViewer();openEdit(id)};
$$("[data-close]").forEach(b=>b.onclick=()=>modal(b.dataset.close,false));
$$(".modal").forEach(m=>m.addEventListener("click",e=>{if(e.target===m)m.classList.remove("show")}));

function fillCats(selected){$("#editCategory").innerHTML=state.categories.map(c=>`<option value="${c.id}" ${c.id===selected?"selected":""}>${esc(c.name)}</option>`).join("")}
function updateAccessSettings(){const v=$("#editAccess").value;$("#passwordSettings").classList.toggle("hidden",v!=="password");$("#linkSettings").classList.toggle("hidden",v!=="link")}
function formatLinkExpiry(value){if(!value)return "Без срока действия";const d=new Date(value);return Number.isNaN(d.getTime())?"":"Действует до "+d.toLocaleString("ru-RU",{dateStyle:"medium",timeStyle:"short"})}
async function refreshShareLink(a){$("#albumShareLink").value="";$("#albumLinkExpiryStatus").textContent="";if(!dbMode||!state.loggedIn||a.access!=="link")return;const {data,error}=await sb.rpc("get_album_share_info",{target_album_id:a.id});if(error||!data){console.error(error);return}const info=typeof data==="string"?JSON.parse(data):data;const u=new URL(location.href);u.search="";u.hash="";u.searchParams.set("album",a.id);u.searchParams.set("token",info.token);$("#albumShareLink").value=u.toString();$("#albumLinkExpiryStatus").textContent=formatLinkExpiry(info.expires_at)}
async function openEdit(id){
 const a=state.albums.find(x=>x.id===id);if(!a)return;
 state.editingId=id;
 $("#editHeading").textContent=a.name;$("#editName").value=a.name;$("#editAccess").value=a.access;$("#albumPassword").value="";
 fillCats(a.categoryId);updateAccessSettings();refreshShareLink(a);modal("editModal");
 if(dbMode&&state.loggedIn&&!a.photosLoaded){
  $("#photoEditor").innerHTML='<div class="muted">Загружаем фотографии…</div>';
  await loadAlbumPhotos(a);
 }
 renderPhotoEditor();
}
$("#editAccess").onchange=updateAccessSettings;
$("#regenerateShareLinkBtn").onclick=async()=>{const a=state.albums.find(x=>x.id===state.editingId);if(!a||!dbMode)return;const duration=$("#albumLinkExpiry").value;const {error}=await sb.rpc("regenerate_album_share_link",{target_album_id:a.id,duration_code:duration});if(error){notify("Не удалось создать новую ссылку: "+error.message,"error");return}a.access="link";await refreshShareLink(a);notify("Новая приватная ссылка создана. Старая больше не работает.")};
async function newAlbum(cat){
 if(dbMode){
  const nextOrder=state.albums.filter(a=>a.categoryId===cat).reduce((m,a)=>Math.max(m,a.sortOrder??-1),-1)+1;
  const {data,error}=await sb.from("albums").insert({name:"Новый альбом",category_id:cat,access_type:"public",sort_order:nextOrder}).select("id,category_id,name,access_type,cover_url,cover_preview_url,sort_order").single();
  if(error){notify("Не удалось создать альбом");return}
  state.albums.push({id:data.id,name:data.name,categoryId:data.category_id,access:data.access_type,coverPath:data.cover_url||null,coverPreviewPath:data.cover_preview_url||null,cover:(data.cover_preview_url||data.cover_url)||placeholder(data.id),sortOrder:data.sort_order??nextOrder,photos:[]});render();openEdit(data.id);return
 }
 const id="a"+Date.now();state.albums.push({id,name:"Новый альбом",categoryId:cat,access:"public",cover:placeholder(id),photos:[]});render();openEdit(id)
}
$("#saveAlbumBtn").onclick=async()=>{
 const a=state.albums.find(x=>x.id===state.editingId);if(!a)return;
 const patch={name:$("#editName").value.trim()||"Без названия",categoryId:$("#editCategory").value,access:$("#editAccess").value};
 const pw=$("#albumPassword").value;
 if(dbMode&&patch.access==="password"&&!pw&&a.access!=="password"){notify("Введите пароль для этого альбома.","error");$("#albumPassword").focus();return}
 if(dbMode){
  const {error}=await sb.from("albums").update({name:patch.name,category_id:patch.categoryId,access_type:patch.access}).eq("id",a.id);
  if(error){notify("Не удалось сохранить альбом.","error");return}
  if(patch.access==="link"){
   const {error:le}=await sb.rpc("set_album_link_expiry",{target_album_id:a.id,duration_code:$("#albumLinkExpiry").value});
   if(le){notify("Не удалось сохранить срок ссылки: "+le.message,"error");return}
  }
  if(patch.access==="password"&&pw){
   const {error:pe}=await sb.rpc("set_album_password",{target_album_id:a.id,new_password:pw});
   if(pe){notify("Не удалось сохранить пароль: "+pe.message,"error");return}
   const {data:verified,error:ve}=await sb.rpc("check_album_password",{target_album_id:a.id,supplied_password:pw});
   if(ve||verified!==true){notify("Пароль сохранился некорректно. Попробуйте ещё раз.","error");return}
  }
 }
 // Apply the new access type before generating a private link.
 // Previously refreshShareLink() still saw the old access value on the first switch to “link”,
 // so the generated URL could miss the album/token parameters.
 Object.assign(a,patch);
 if(patch.access==="link"){
   await refreshShareLink(a);
   const link=$("#albumShareLink").value;
   if(link){try{await navigator.clipboard.writeText(link);notify("Приватная ссылка на этот альбом скопирована.")}catch{notify("Альбом сохранён. Ссылку можно скопировать из поля.")}}
   else notify("Альбом сохранён, но ссылку не удалось получить.","error");
 } else notify("Альбом сохранён.");
 modal("editModal",false);render()
};
$("#deleteAlbumBtn").onclick=async()=>{const id=state.editingId;if(dbMode){const {error}=await sb.from("albums").delete().eq("id",id);if(error){notify("Не удалось удалить альбом");return}}state.albums=state.albums.filter(x=>x.id!==id);modal("editModal",false);render()};

$("#newCategoryBtn").onclick=()=>{$("#newCategoryName").value="";modal("categoryModal");setTimeout(()=>$("#newCategoryName").focus(),50)};
$("#createCategoryBtn").onclick=async()=>{const name=$("#newCategoryName").value.trim();if(!name){$("#newCategoryName").focus();return}if(dbMode){const {data,error}=await sb.from("categories").insert({name}).select("id,name").single();if(error){notify("Не удалось создать категорию");return}state.categories.push(data)}else state.categories.push({id:"c"+Date.now(),name});modal("categoryModal",false);render()};
$("#newCategoryName").addEventListener("keydown",e=>{if(e.key==="Enter")$("#createCategoryBtn").click()});
let editingCategoryId=null;
function editCategory(id){const c=state.categories.find(x=>x.id===id);if(!c)return;editingCategoryId=id;$("#editCategoryName").value=c.name;modal("editCategoryModal");setTimeout(()=>$("#editCategoryName").focus(),50)}
$("#saveCategoryBtn").onclick=async()=>{const c=state.categories.find(x=>x.id===editingCategoryId),name=$("#editCategoryName").value.trim();if(!c||!name){$("#editCategoryName").focus();return}if(dbMode){const {error}=await sb.from("categories").update({name}).eq("id",c.id);if(error){notify("Не удалось сохранить категорию");return}}c.name=name;modal("editCategoryModal",false);render()};
$("#editCategoryName").addEventListener("keydown",e=>{if(e.key==="Enter")$("#saveCategoryBtn").click()});
$("#deleteCategoryBtn").onclick=()=>{const c=state.categories.find(x=>x.id===editingCategoryId);if(!c)return;const count=state.albums.filter(a=>a.categoryId===c.id).length;$("#deleteCategoryText").textContent=count?`В категории «${c.name}» находится ${count} альбом(а). При удалении категории эти альбомы тоже будут удалены.`:`Категория «${c.name}» будет удалена.`;modal("editCategoryModal",false);modal("deleteCategoryModal")};
$("#confirmDeleteCategoryBtn").onclick=async()=>{
 if(!editingCategoryId)return;
 const categoryId=editingCategoryId;
 if(dbMode){
  // Storage files are not removed by PostgreSQL ON DELETE CASCADE, so clean them first.
  const albumIds=state.albums.filter(a=>a.categoryId===categoryId).map(a=>a.id);
  if(albumIds.length){
   const {data:rows,error:photoError}=await sb.from("photos").select("storage_path").in("album_id",albumIds);
   if(photoError){console.error("category photo lookup failed",photoError);notify(`Не удалось удалить категорию: ${photoError.message||"ошибка загрузки списка фотографий"}`,"error");return}
   const paths=(rows||[]).map(r=>r.storage_path).filter(Boolean);
   if(paths.length){
    const {error:storageError}=await sb.storage.from("photos").remove(paths);
    if(storageError){console.error("category storage cleanup failed",storageError);notify(`Не удалось удалить фотографии категории: ${storageError.message||"ошибка Storage"}`,"error");return}
   }
  }
  const {error}=await sb.from("categories").delete().eq("id",categoryId);
  if(error){console.error("category delete failed",error);notify(`Не удалось удалить категорию: ${error.message||"ошибка базы данных"}`,"error");return}
 }
 state.albums=state.albums.filter(a=>a.categoryId!==categoryId);
 state.categories=state.categories.filter(c=>c.id!==categoryId);
 editingCategoryId=null;modal("deleteCategoryModal",false);render();notify("Категория удалена.");
};

// Старый демонстрационный экран администраторов оставлен только в offline/demo режиме.
$("#ownerUsersBtn").onclick=()=>modal("usersModal");
$("#addAdminBtn").onclick=()=>{const email=$("#adminEmail").value.trim();if(!email)return;state.admins.push(email);$("#adminEmail").value="";renderAdmins()};
function renderAdmins(){$("#adminsList").innerHTML=state.admins.map((e,i)=>`<div class="user-row"><div class="avatar">A</div><div><strong>Администратор</strong><span>${esc(e)}</span></div><button class="category-edit" onclick="removeAdmin(${i})">Удалить</button></div>`).join("")}
window.removeAdmin=i=>{state.admins.splice(i,1);renderAdmins()};

// V14: фотографии, обложка, удаление и порядок сохраняются в Supabase Storage + public.photos.
const PHOTO_BUCKET="photos";
const photoPathByUrl=new Map();
const previewPathByStoragePath=new Map();
const originalUrlByDisplayUrl=new Map();
async function signedPhotoUrl(path){
 const {data,error}=await sb.storage.from(PHOTO_BUCKET).createSignedUrl(path,86400);
 if(error){console.error(error);return null} const url=data.signedUrl; photoPathByUrl.set(url,path); return url
}
async function loadAlbumCovers(){
 if(!dbMode)return;
 await Promise.all(state.albums.map(async a=>{
  const displayPath=a.coverPreviewPath||a.coverPath;
  if(!displayPath)return;
  const u=await signedPhotoUrl(displayPath);
  if(u)a.cover=u;
 }));
 render();
}
async function loadVisitorCovers(){
 if(!dbMode||state.loggedIn)return;
 await loadAlbumCovers();
}
async function loadAlbumPhotos(a){
 if(!dbMode||!state.loggedIn||!a)return;
 const {data,error}=await sb.from("photos")
  .select("id,album_id,storage_path,preview_path,sort_order")
  .eq("album_id",a.id)
  .order("sort_order");
 if(error){console.error(error);notify("Не удалось загрузить фотографии альбома.","error");return}
 const rows=data||[];
 const items=await Promise.all(rows.map(async p=>{
  const originalUrl=await signedPhotoUrl(p.storage_path);
  // If a preview path is recorded but the preview object/link is unavailable,
  // always fall back to the original instead of hiding the photo.
  let displayUrl=originalUrl;
  if(p.preview_path){
   previewPathByStoragePath.set(p.storage_path,p.preview_path);
   const previewUrl=await signedPhotoUrl(p.preview_path);
   if(previewUrl)displayUrl=previewUrl;
  }
  if(displayUrl&&originalUrl){
   originalUrlByDisplayUrl.set(displayUrl,originalUrl);
   photoPathByUrl.set(displayUrl,p.storage_path);
  }
  return {row:p,originalUrl,displayUrl};
 }));
 a.photos=items.filter(x=>x.displayUrl).map(x=>x.displayUrl);
 a.photosLoaded=true;
 // V43: открытие альбома ничего не генерирует — только показывает уже готовые preview.
 if(a.photos.length&&(!a.coverPath||!a.cover||a.cover.includes("picsum.photos")))a.cover=a.photos[0];
}
async function loadPhotos(){
 // Оставлено для совместимости: фотографии больше не загружаются для всех альбомов при старте.
 if(!dbMode||!state.loggedIn)return;
 await Promise.all(state.albums.map(a=>loadAlbumPhotos(a)));
 render();
}
async function makePreviewBlob(source,maxSide=1600,quality=0.82){
 let bitmap=null;
 try{
  let blob;
  if(source instanceof Blob) blob=source;
  else{
   const response=await fetch(source);
   if(!response.ok)throw new Error("Не удалось прочитать изображение");
   blob=await response.blob();
  }
  bitmap=await createImageBitmap(blob,{imageOrientation:"from-image"});
  const scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height));
  const width=Math.max(1,Math.round(bitmap.width*scale));
  const height=Math.max(1,Math.round(bitmap.height*scale));
  const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext("2d",{alpha:false});ctx.drawImage(bitmap,0,0,width,height);
  return await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("Не удалось создать preview")),"image/webp",quality));
 }finally{if(bitmap?.close)bitmap.close()}
}
async function saveCoverPreview(a,source){
 if(!dbMode||!state.loggedIn)return null;
 try{
  const blob=await makePreviewBlob(source,1200,0.82);
  const previewPath=`${a.id}/preview/cover.webp`;
  const {error:uploadError}=await sb.storage.from(PHOTO_BUCKET).upload(previewPath,blob,{contentType:"image/webp",upsert:true,cacheControl:"31536000"});
  if(uploadError)throw uploadError;
  const {error:updateError}=await sb.from("albums").update({cover_preview_url:previewPath}).eq("id",a.id);
  if(updateError)throw updateError;
  a.coverPreviewPath=previewPath;
  return await signedPhotoUrl(previewPath);
 }catch(error){console.error("Cover preview:",error);notify("Обложка сохранена, но лёгкое preview создать не удалось.","error");return null}
}
async function buildMissingCoverPreviews(){
 if(!dbMode||!state.loggedIn)return;
 const missing=state.albums.filter(a=>a.coverPath&&!a.coverPreviewPath);
 if(!missing.length)return;
 for(const a of missing){
  let originalUrl=null;
  // Если на экране уже оригинальная обложка, используем её; иначе получаем временную ссылку.
  if(a.cover && !a.cover.includes("picsum.photos")) originalUrl=a.cover;
  else originalUrl=await signedPhotoUrl(a.coverPath);
  if(!originalUrl)continue;
  const previewUrl=await saveCoverPreview(a,originalUrl);
  if(previewUrl){a.cover=previewUrl;render()}
 }
}

async function savePhotoPreview(a,photoId,source){
 if(!dbMode||!state.loggedIn)return null;
 try{
  const blob=await makePreviewBlob(source,1600,0.82);
  const previewPath=`${a.id}/preview/${photoId}.webp`;
  const {error:uploadError}=await sb.storage.from(PHOTO_BUCKET).upload(previewPath,blob,{contentType:"image/webp",upsert:true,cacheControl:"31536000"});
  if(uploadError)throw uploadError;
  const {error:updateError}=await sb.from("photos").update({preview_path:previewPath}).eq("id",photoId);
  if(updateError)throw updateError;
  return {previewPath,url:await signedPhotoUrl(previewPath)};
 }catch(error){console.error("Photo preview:",error);return null}
}
async function buildMissingPhotoPreviews(a,items){
 const missing=items.filter(x=>!x.row.preview_path&&x.originalUrl);
 for(const item of missing){
  const made=await savePhotoPreview(a,item.row.id,item.originalUrl);
  if(!made?.url)continue;
  const oldUrl=item.displayUrl;
  const index=a.photos.indexOf(oldUrl);
  if(index>=0){
   a.photos[index]=made.url;
   originalUrlByDisplayUrl.set(made.url,item.originalUrl);
   photoPathByUrl.set(made.url,item.row.storage_path);
  }
  // Не перерисовываем весь альбом на каждом фото: preview пригодится при следующем открытии.
 }
}

async function uploadPhotos(files){
 const a=state.albums.find(x=>x.id===state.editingId);if(!a||!dbMode||!state.loggedIn||!files.length)return;
 const dropzone=$("#photoDropzone");
 const title=dropzone?.querySelector(".upload-title");
 const oldTitle=title?.textContent||"Добавить фотографии";
 const {data:last}=await sb.from("photos").select("sort_order").eq("album_id",a.id).order("sort_order",{ascending:false}).limit(1);
 let order=last?.[0]?.sort_order??-1,done=0;
 const previewJobs=[];
 try{
  for(const f of files){
   if(title)title.textContent=`Загрузка ${done+1} из ${files.length}…`;
   const ext=(f.name.split(".").pop()||"jpg").replace(/[^a-z0-9]/gi,"").toLowerCase();
   const path=`${a.id}/${crypto.randomUUID()}.${ext}`;
   const {error:ue}=await sb.storage.from(PHOTO_BUCKET).upload(path,f,{contentType:f.type||"image/jpeg",upsert:false});
   if(ue){notify("Не удалось загрузить фото: "+ue.message);continue}
   const {data:photoRow,error:de}=await sb.from("photos").insert({album_id:a.id,storage_path:path,sort_order:++order}).select("id").single();
   if(de){await sb.storage.from(PHOTO_BUCKET).remove([path]);notify("Не удалось сохранить фото: "+de.message);continue}

   // Сразу показываем локальный файл. Preview создаётся позже и не блокирует интерфейс.
   const localUrl=URL.createObjectURL(f);
   a.photos.push(localUrl);
   photoPathByUrl.set(localUrl,path);
   const originalPromise=signedPhotoUrl(path).then(url=>{if(url)originalUrlByDisplayUrl.set(localUrl,url);return url});

   if(a.photos.length===1 && !a.coverPath){
    a.coverPath=path;a.cover=localUrl;
    await sb.from("albums").update({cover_url:path}).eq("id",a.id);
    // Обложка визуально выбрана сразу; её лёгкая копия делается в фоне.
    previewJobs.push(saveCoverPreview(a,f).then(url=>{if(url){a.cover=url;render()}}));
   }

   previewJobs.push(Promise.all([originalPromise,savePhotoPreview(a,photoRow.id,f)]).then(([originalUrl,made])=>{
    if(!made?.url)return;
    previewPathByStoragePath.set(path,made.previewPath);
    const idx=a.photos.indexOf(localUrl);
    if(idx>=0)a.photos[idx]=made.url;
    photoPathByUrl.set(made.url,path);
    if(originalUrl)originalUrlByDisplayUrl.set(made.url,originalUrl);
    URL.revokeObjectURL(localUrl);
   }));
   done++;
   if(title)title.textContent=`Загружено ${done} из ${files.length}`;
   renderPhotoEditor();render();
  }
 }finally{
  if(title){title.textContent=done?`Загружено ${done} из ${files.length}`:oldTitle;setTimeout(()=>{if(title)title.textContent=oldTitle},1600)}
 }
 // Не ждём конвертацию preview: пользователь может сразу продолжать работу.
 Promise.allSettled(previewJobs).then(()=>{if(state.editingId===a.id)renderPhotoEditor();render()});
}
$("#photoInput").onchange=async e=>{const files=[...e.target.files].filter(f=>f.type.startsWith("image/"));e.target.value="";if(dbMode){await uploadPhotos(files);return}const a=state.albums.find(x=>x.id===state.editingId);files.forEach(f=>{const r=new FileReader();r.onload=()=>{a.photos.push(r.result);if(!a.cover||a.cover.includes("picsum.photos"))a.cover=r.result;renderPhotoEditor();render()};r.readAsDataURL(f)})};
let draggedPhotoIndex=null;

async function persistPhotoOrder(a){
 if(!dbMode||!state.loggedIn)return;
 const updates=a.photos.map((url,i)=>{
   const path=photoPathByUrl.get(url);
   return path ? sb.from("photos").update({sort_order:i}).eq("album_id",a.id).eq("storage_path",path) : Promise.resolve();
 });
 await Promise.all(updates);
}

async function persistCover(a,src){
 if(!dbMode||!state.loggedIn){a.cover=src;return}
 const path=photoPathByUrl.get(src);
 if(!path){notify("Не удалось определить файл обложки.");return}
 const {error}=await sb.from("albums").update({cover_url:path}).eq("id",a.id);
 if(error){notify("Не удалось сохранить обложку: "+error.message);return}
 a.coverPath=path;
 const previewUrl=await saveCoverPreview(a,src);
 a.cover=previewUrl||src;
}

async function persistDeletePhoto(a,src){
 if(!dbMode||!state.loggedIn)return true;
 const path=photoPathByUrl.get(src);
 if(!path)return false;
 const previewPath=previewPathByStoragePath.get(path);
 const {error:dbError}=await sb.from("photos").delete().eq("album_id",a.id).eq("storage_path",path);
 if(dbError){notify("Не удалось удалить фотографию: "+dbError.message,"error");return false}
 const paths=[path];
 if(previewPath)paths.push(previewPath);
 const {error:storageError}=await sb.storage.from(PHOTO_BUCKET).remove(paths);
 if(storageError)console.error("Storage delete:",storageError);
 photoPathByUrl.delete(src);
 previewPathByStoragePath.delete(path);
 return true;
}

function isCoverPhoto(a,src){
 const path=photoPathByUrl.get(src);
 return !!(path&&a.coverPath&&path===a.coverPath);
}

function renderPhotoEditor(){
 const a=state.albums.find(x=>x.id===state.editingId),box=$("#photoEditor");
 if(!a||!box)return;
 box.innerHTML="";
 if(!a.photos.length){box.innerHTML='<div class="muted">В альбоме пока нет фотографий.</div>';return}
 a.photos.forEach((src,i)=>{
  const item=document.createElement("div");
  const isCover=isCoverPhoto(a,src);
  item.className="photo-item"+(isCover?" cover-photo":"");
  item.draggable=true; item.dataset.index=i;
  item.innerHTML=`<img src="${src}" alt=""><div class="photo-item-actions"><button class="set-cover${isCover?" active":""}">${isCover?"✓ Обложка":"Обложка"}</button><button class="remove-photo">×</button></div>`;
  item.addEventListener("dragstart",()=>{draggedPhotoIndex=i;item.classList.add("dragging")});
  item.addEventListener("dragend",()=>{draggedPhotoIndex=null;item.classList.remove("dragging");$$(".photo-item").forEach(x=>x.classList.remove("drag-over"))});
  item.addEventListener("dragover",e=>{e.preventDefault();item.classList.add("drag-over")});
  item.addEventListener("dragleave",()=>item.classList.remove("drag-over"));
  item.addEventListener("drop",async e=>{
    e.preventDefault();item.classList.remove("drag-over");
    const to=i;
    if(draggedPhotoIndex===null||draggedPhotoIndex===to)return;
    const [moved]=a.photos.splice(draggedPhotoIndex,1);
    a.photos.splice(to,0,moved);
    draggedPhotoIndex=null;
    renderPhotoEditor();render();
    await persistPhotoOrder(a);
  });
  // V31: touch/pen reordering for phones and tablets.
  let touchFrom=null, touchTo=null;
  item.addEventListener("pointerdown",e=>{
    if(e.pointerType==="mouse" || e.target.closest("button")) return;
    touchFrom=i; touchTo=i;
    item.classList.add("touch-dragging");
    try{item.setPointerCapture(e.pointerId)}catch(_){}
  });
  item.addEventListener("pointermove",e=>{
    if(touchFrom===null || e.pointerType==="mouse") return;
    const hit=document.elementFromPoint(e.clientX,e.clientY)?.closest(".photo-item");
    $$(".photo-item").forEach(x=>x.classList.remove("touch-over"));
    if(hit && hit.parentElement===box){
      const n=Number(hit.dataset.index);
      if(Number.isInteger(n)){touchTo=n; if(hit!==item) hit.classList.add("touch-over")}
    }
  });
  item.addEventListener("pointerup",async e=>{
    if(touchFrom===null || e.pointerType==="mouse") return;
    const from=touchFrom,to=touchTo; touchFrom=touchTo=null;
    item.classList.remove("touch-dragging");
    $$(".photo-item").forEach(x=>x.classList.remove("touch-over"));
    if(from===to || to===null) return;
    const [moved]=a.photos.splice(from,1);
    a.photos.splice(to,0,moved);
    renderPhotoEditor(); render();
    await persistPhotoOrder(a);
  });
  item.addEventListener("pointercancel",()=>{touchFrom=touchTo=null;item.classList.remove("touch-dragging");$$(".photo-item").forEach(x=>x.classList.remove("touch-over"))});
  item.querySelector(".set-cover").onclick=async e=>{
    e.stopPropagation();
    if(isCover)return;
    const path=photoPathByUrl.get(src);
    if(path){a.coverPath=path;a.cover=src;renderPhotoEditor();render()}
    await persistCover(a,src);
    renderPhotoEditor();render();
  };
  item.querySelector(".remove-photo").onclick=async e=>{
    e.stopPropagation();
    const wasCover=isCoverPhoto(a,src);
    const removedIndex=a.photos.indexOf(src);
    if(removedIndex<0)return;

    // Optimistic UI: photo disappears immediately while Supabase deletion runs.
    a.photos.splice(removedIndex,1);
    renderPhotoEditor();render();

    const deleted=await persistDeletePhoto(a,src);
    if(!deleted){
      a.photos.splice(Math.min(removedIndex,a.photos.length),0,src);
      renderPhotoEditor();render();
      return;
    }

    if(wasCover){
      if(a.photos.length) await persistCover(a,a.photos[0]);
      else {
        if(dbMode) await sb.from("albums").update({cover_url:null,cover_preview_url:null}).eq("id",a.id);
        if(a.coverPreviewPath)await sb.storage.from(PHOTO_BUCKET).remove([a.coverPreviewPath]);
        a.coverPath=null;a.coverPreviewPath=null;
        a.cover=placeholder(a.id);
      }
    }
    await persistPhotoOrder(a);
    renderPhotoEditor();render();
  };
  box.appendChild(item);
 })
}
const photoDropzone=$("#photoDropzone");if(photoDropzone){["dragenter","dragover"].forEach(t=>photoDropzone.addEventListener(t,e=>{e.preventDefault();e.stopPropagation();photoDropzone.classList.add("dragover")}));["dragleave","drop"].forEach(t=>photoDropzone.addEventListener(t,e=>{e.preventDefault();e.stopPropagation();photoDropzone.classList.remove("dragover")}));photoDropzone.addEventListener("drop",e=>{const files=[...e.dataTransfer.files].filter(f=>f.type.startsWith("image/"));if(!files.length)return;const input=$("#photoInput"),dt=new DataTransfer();files.forEach(f=>dt.items.add(f));input.files=dt.files;input.dispatchEvent(new Event("change",{bubbles:true}))})}

$("#albumPasswordForm").onsubmit=async e=>{e.preventDefault();const a=pendingPasswordAlbum;if(!a)return;const pw=$("#visitorAlbumPassword").value;$("#albumPasswordError").textContent="";try{const r=await requestAlbumAccess(a,pw,null);if(!r.ok){const serverMessage=r.data?.error||r.data?.message||""; $("#albumPasswordError").textContent=r.status===403?"Неверный пароль.":(`Не удалось проверить пароль${serverMessage?`: ${serverMessage}`:". Попробуйте ещё раз."}`); console.error("album-access",r.status,r.data); return}albumDownloadPasswords.set(a.id,pw);pendingPasswordAlbum=null;modal("albumPasswordModal",false);{const urls=(r.data.photos||[]).map(p=>{const display=p.previewUrl||p.url;if(display&&p.url)originalUrlByDisplayUrl.set(display,p.url);return display}).filter(Boolean);renderViewerPhotos(a,urls)}}catch{$("#albumPasswordError").textContent="Не удалось проверить пароль."}};
$("#copyShareLinkBtn").onclick=async()=>{const v=$("#albumShareLink").value;if(!v)return;try{await navigator.clipboard.writeText(v);$("#copyShareLinkBtn").textContent="Скопировано";setTimeout(()=>$("#copyShareLinkBtn").textContent="Копировать",1200)}catch{}};

document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeViewer();$$(".modal").forEach(m=>m.classList.remove("show"))}});
(async function init(){
 if(!dbMode){$("#loginHint").textContent="Supabase ещё не настроен — сейчас работает демонстрационный режим."}
 await loadSession();await loadData();await loadAlbumCovers();syncAdmin();
 // V43: старые preview обложек больше не генерируются автоматически при входе.
 if(dbMode&&!state.loggedIn){const q=new URLSearchParams(location.search),aid=q.get("album");if(aid){const a=state.albums.find(x=>x.id===aid);if(a)setTimeout(()=>openAlbum(a),0)}}
 if(dbMode)sb.auth.onAuthStateChange(async(event)=>{if(event==="SIGNED_OUT"){state.loggedIn=false;state.role=null}});
})();


// V18 — proper eye icons for password visibility
const eyeOpenIcon=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.8"/></svg>`;
const eyeClosedIcon=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 6.2A10.8 10.8 0 0 1 12 6c6 0 9.5 6 9.5 6a16.8 16.8 0 0 1-3 3.6M6.2 6.2C3.8 8 2.5 12 2.5 12s3.5 6 9.5 6a10.6 10.6 0 0 0 4-.8M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>`;
// V17 — show/hide album passwords without changing their value
document.querySelectorAll('[data-toggle-password]').forEach(btn=>{
 btn.innerHTML=eyeOpenIcon;
 btn.addEventListener('click',()=>{
  const input=document.getElementById(btn.dataset.togglePassword);
  if(!input)return;
  const visible=input.type==='text';
  input.type=visible?'password':'text';
  btn.classList.toggle('is-visible',!visible);
  btn.innerHTML=visible?eyeOpenIcon:eyeClosedIcon;
  btn.setAttribute('aria-label',visible?'Показать пароль':'Скрыть пароль');
  btn.title=visible?'Показать пароль':'Скрыть пароль';
 });
});
