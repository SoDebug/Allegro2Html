'use strict';
// v0.8.4: connected-track stroking, explicit graphic visibility and accurate position markers.
const $=id=>document.getElementById(id),canvas=$('canvas'),ctx=canvas.getContext('2d',{alpha:false});
const colors=['#e9a659','#6dc9b3','#86aeff','#c29cf0','#73dca8','#9fafec','#e4c17a','#77c9df','#e69aae','#d4a3df','#c3d994','#9dd2e4','#c2aaee','#e89ab2','#85d3a1','#eac77a','#a6bbe0','#f09f80'];
let db=null,active=new Set(),net=null,theta=0,mirror=false,scale=1,center=[0,0],pan=[0,0],drag=null;
let byLayer=new Map(),zoneCache=new WeakMap(),zoneBoundsCache=new WeakMap(),nets=[],componentMap=new Map(),packageByRef=new Map(),selectedComponent=null,selectedPin=null,validPads=0,invalidPads=0;const EPS=1e-7;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validPad=p=>Array.isArray(p.position)&&Array.isArray(p.size)&&Number(p.size[0])>0&&Number(p.size[1])>0&&p.shape!=='NULL';
function current(){return {x:canvas.width/2+pan[0],y:canvas.height/2+pan[1]}};
function color(layer){const i=db.layers.findIndex(l=>l.allegro_layer===layer);return colors[(i<0?0:i)%colors.length]}
function norm(a){return ((a%(Math.PI*2))+Math.PI*2)%(Math.PI*2)}
function addArc(p,s){const a=s.endpoints?.[0],b=s.endpoints?.[1],c=s.center,r=s.radius;if(!a||!b||!c||!(r>0))return false;
  const aa=Math.atan2(a[1]-c[1],a[0]-c[0]);const bb=Math.atan2(b[1]-c[1],b[0]-c[0]);
  const closed=Math.hypot(a[0]-b[0],a[1]-b[1])<EPS;
  // Canvas paths defined in world coordinates (Y upwards before canvas transform).
  // Allegro clockwise=true means decreasing mathematical angle.
  // Canvas Path2D is constructed in world coordinates BEFORE applying Y flip;
  // anticlockwise=true is required for decreasing angles. Do not invert it.
  if(closed){p.arc(c[0],c[1],r,aa,aa+(s.clockwise?-Math.PI*2:Math.PI*2),Boolean(s.clockwise))}
  else p.arc(c[0],c[1],r,aa,bb,Boolean(s.clockwise));
  return true;
}
function ring(p,segments){if(!segments?.length)return;let started=false;
  for(const s of segments){const e=s.endpoints;if(!e||!e[0]||!e[1])continue;
    if(!started){p.moveTo(e[0][0],e[0][1]);started=true}
    if(s.type==='arc'&&s.center&&s.radius>0){addArc(p,s)}else p.lineTo(e[1][0],e[1][1]);
  }if(started)p.closePath();
}
function zonePath(z){let p=zoneCache.get(z);if(p)return p;p=new Path2D();ring(p,z.rings);for(const v of z.voids||[])ring(p,v);zoneCache.set(z,p);return p}
// Conservative spatial prefilter for hit-testing large poured-copper polygons.
// Arc extents may be overestimated but never clipped by their radius box.
function zoneBounds(z){
  let b=zoneBoundsCache.get(z);if(b)return b;
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const s of z.rings||[]){
    for(const pt of s.endpoints||[]){if(!pt)continue;x0=Math.min(x0,pt[0]);y0=Math.min(y0,pt[1]);x1=Math.max(x1,pt[0]);y1=Math.max(y1,pt[1])}
    if(s.type==='arc'&&s.center&&Number(s.radius)>0){const c=s.center,r=Number(s.radius);x0=Math.min(x0,c[0]-r);y0=Math.min(y0,c[1]-r);x1=Math.max(x1,c[0]+r);y1=Math.max(y1,c[1]+r)}
  }
  b=[x0,y0,x1,y1];zoneBoundsCache.set(z,b);return b;
}
function pickZoneAt(x,y){
  if(!$('zones').checked)return null;
  // Hit test the actual filled path, including circular and polygonal voids.
  // Canvas uses screen-space coordinates for isPointInPath, so apply the same
  // world-to-screen matrix used by paint() before testing.
  const screenX=canvas.width/2+pan[0],screenY=canvas.height/2+pan[1];
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.translate(screenX,screenY);
  ctx.rotate(theta);ctx.scale(scale*(mirror?-1:1),-scale);ctx.translate(-center[0],-center[1]);
  const sx=screenX+Math.cos(theta)*scale*(mirror?-1:1)*(x-center[0])+Math.sin(theta)*scale*(y-center[1]);
  const sy=screenY+Math.sin(theta)*scale*(mirror?-1:1)*(x-center[0])-Math.cos(theta)*scale*(y-center[1]);
  let found=null;
  const visible=db.layers.map(l=>l.allegro_layer).filter(l=>active.has(l));
  outer:for(let li=visible.length-1;li>=0;li--){
    const zs=byLayer.get(visible[li])?.zones||[];
    for(let zi=zs.length-1;zi>=0;zi--){const z=zs[zi];if(!z.net)continue;
      if(net&&$('mode').value==='isolate'&&z.net!==net)continue;
      const b=zoneBounds(z);if(x<b[0]||x>b[2]||y<b[1]||y>b[3])continue;
      if(ctx.isPointInPath(zonePath(z),sx,sy,'evenodd')){found=z;break outer}
    }
  }
  ctx.restore();return found;
}
function appendSegmentToContext(s){
  const e=s.endpoints;if(!e?.[0]||!e?.[1])return;
  if(s.type==='arc'&&s.center&&s.radius>0){
    const a=e[0],b=e[1],c=s.center,r=s.radius;
    const aa=Math.atan2(a[1]-c[1],a[0]-c[0]);
    const bb=Math.atan2(b[1]-c[1],b[0]-c[0]);
    const full=Math.hypot(a[0]-b[0],a[1]-b[1])<EPS;
    ctx.arc(c[0],c[1],r,aa,full?aa+(s.clockwise?-2*Math.PI:2*Math.PI):bb,Boolean(s.clockwise));
  }else ctx.lineTo(...e[1]);
}
function renderTracks(a,layer,useNet,mode){
  // One stroke per connected run, not one per Allegro segment. Preserve actual track widths.
  ctx.lineCap='round';ctx.lineJoin='round';
  let open=false,last=null,style='',prevWidth=0,shown=0;
  const flush=()=>{if(open){ctx.stroke();open=false}};
  for(const t of a){
    if(useNet&&mode==='isolate'&&t.net!==net)continue;
    const e=t.endpoints;if(!e?.[0]||!e?.[1])continue;
    const selected=useNet&&t.net===net;
    const width=Number(t.width)>0?Number(t.width):1;
    const curStyle=(selected?'#ffef81':color(layer))+'|'+(useNet&&!selected?'fade':'solid')+'|'+width+'|'+String(t.net);
    const linked=open&&curStyle===style&&last&&Math.hypot(last[0]-e[0][0],last[1]-e[0][1])<.035;
    if(!linked){flush();ctx.beginPath();ctx.moveTo(...e[0]);ctx.strokeStyle=selected?'#ffef81':color(layer);ctx.globalAlpha=useNet&&!selected?.08:1;ctx.lineWidth=width;style=curStyle;open=true}
    appendSegmentToContext(t);last=e[1];shown++;
  }
  flush();ctx.globalAlpha=1;return shown;
}
function drawSegment(s){let e=s.endpoints;if(!e?.[0]||!e?.[1])return;ctx.beginPath();ctx.moveTo(...e[0]);if(s.type==='arc'&&s.center&&s.radius>0){let p=new Path2D();p.moveTo(...e[0]);addArc(p,s);ctx.stroke(p)}else{ctx.lineTo(...e[1]);ctx.stroke()}}
function renderPads(layer,useNet,mode){
  if(!$('pads').checked)return 0;
  let n=0;
  for(const p of byLayer.get(layer)?.pads||[]){
    if(useNet&&mode==='isolate'&&p.net!==net)continue;
    const size=p.size,pos=p.position;
    if(!Array.isArray(size)||!Array.isArray(pos)||!(size[0]>0&&size[1]>0))continue;
    const highlight=useNet&&p.net===net;
    ctx.save();ctx.translate(pos[0],pos[1]);ctx.rotate((Number(p.rotation)||0)*Math.PI/180);
    ctx.fillStyle=highlight?'#ffef81':color(layer);
    ctx.globalAlpha=useNet&&!highlight?.08:.92;
    const shape=String(p.shape||'').toUpperCase();
    if(shape.includes('CIRCLE')||shape.includes('ROUND')&&!shape.includes('RECT')){
      ctx.beginPath();ctx.ellipse(0,0,size[0]/2,size[1]/2,0,0,2*Math.PI);ctx.fill();
    }else if(shape.startsWith('OBLONG')){
      const w=size[0],h=size[1],r=Math.min(w,h)/2;ctx.beginPath();ctx.roundRect(-w/2,-h/2,w,h,r);ctx.fill();
    }else{
      ctx.fillRect(-size[0]/2,-size[1]/2,size[0],size[1]);
    }
    ctx.restore();n++;
  }
  return n;
}
function paint(){if(!db)return;ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#081217';ctx.fillRect(0,0,canvas.width,canvas.height);
  const origin=current();ctx.translate(origin.x,origin.y);ctx.rotate(theta);ctx.scale(scale*(mirror?-1:1),-scale);ctx.translate(-center[0],-center[1]);
  const mode=$('mode').value,useNet=net!==null&&mode!=='all';let nzone=0,ntrack=0,npad=0;
  const layers=db.layers.map(l=>l.allegro_layer).filter(l=>active.has(l));
  if($('zones').checked){for(const layer of layers){let a=byLayer.get(layer)?.zones||[];
    for(const z of a){if(useNet&&mode==='isolate'&&z.net!==net)continue;
      const chosen=useNet&&z.net===net;
      ctx.fillStyle=chosen?'#ffde62':color(layer);ctx.globalAlpha=useNet&&!chosen?.075:.70;
      // Evenodd is essential: all 94k circular clearances remain empty.
      ctx.fill(zonePath(z),'evenodd');nzone++;
    }
  }}ctx.globalAlpha=1;
  if($('tracks').checked){for(const layer of layers){ntrack+=renderTracks(byLayer.get(layer)?.tracks||[],layer,useNet,mode)}}ctx.globalAlpha=1;
  for(const layer of layers)npad+=renderPads(layer,useNet,mode);ctx.globalAlpha=1;
  ctx.lineCap='round';ctx.lineJoin='round';
  if($('board').checked){ctx.strokeStyle='#f1f5f4';ctx.lineWidth=1.3/scale;for(const seg of db.board?.outline||[])drawSegment(seg)}
  if($('silkTop').checked||$('silkBottom').checked||$('assemblyTop').checked||$('assemblyBottom').checked||$('placeTop').checked||$('placeBottom').checked){ctx.lineWidth=0.9/scale;for(const item of db.package_graphics||[]){const l=item.layer||'';
    const side=l.endsWith('_TOP')?'Top':l.endsWith('_BOTTOM')?'Bottom':null;
    const kind=l.includes('/SILKSCREEN_')?'silk':l.includes('/ASSEMBLY_')?'assembly':l.includes('/PLACE_BOUND_')?'place':null;
    const control=kind&&side?$(kind+side):null;if(!control?.checked)continue;
    ctx.strokeStyle=kind==='silk'?(side==='Top'?'#92e1b2':'#f0ba86'):kind==='assembly'?'#8ba8d9':'#7f8188';
    ctx.lineWidth=Math.max(.9/scale,Number(item.geometry?.width)||0);ctx.setLineDash(kind==='place'?[5/scale,3/scale]:[]);drawSegment(item.geometry)}ctx.setLineDash([])}
  for(const c of db.components||[]){if(!(c.side==='top'&&$('partsTop').checked||c.side==='bottom'&&$('partsBottom').checked))continue;if(!c.position)continue;const [x,y]=c.position;const rr=4/scale;ctx.strokeStyle=c.side==='top'?'#63ffc8':'#ffa568';ctx.lineWidth=1.2/scale;ctx.beginPath();ctx.moveTo(x-rr,y);ctx.lineTo(x+rr,y);ctx.moveTo(x,y-rr);ctx.lineTo(x,y+rr);ctx.stroke();if($('refdes').checked&&scale>0.16){ctx.save();ctx.translate(x,y);ctx.scale(1,-1);ctx.font=`${12/scale}px sans-serif`;ctx.fillStyle=ctx.strokeStyle;ctx.fillText(c.refdes||'',6/scale,0);ctx.restore()}}
  drawSelection();
  ctx.setTransform(1,0,0,1,0,0);$('overlay').textContent=`可见铜层 ${layers.length}/18 · 已绘制铺铜 ${nzone} · 走线 ${ntrack} · 焊盘图形 ${npad} · 网络 ${net||'全部'} · 缩放 ${scale.toFixed(2)} px/mil`;
}

function worldAt(e){const rect=canvas.getBoundingClientRect(),u=e.clientX-rect.left-canvas.width/2-pan[0],v=e.clientY-rect.top-canvas.height/2-pan[1];const cs=Math.cos(theta),sn=Math.sin(theta);const xx=cs*u+sn*v,yy=-sn*u+cs*v;return [center[0]+xx/(scale*(mirror?-1:1)),center[1]-yy/scale]}
function pointSegmentDistance(x,y,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy;if(l<1e-12)return Math.hypot(x-a[0],y-a[1]);const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/l));return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy)}
function pickAt(e){
  const allowComponent=$('pickComponent').checked,allowNet=$('pickNet').checked;
  if(!allowComponent&&!allowNet)return;
  const [x,y]=worldAt(e),tol=Math.max(2,10/scale);let pick=null,best=tol;
  // Pads can represent a component, a network, or both. NULL pads are excluded at data import.
  for(const layer of active){for(const p of byLayer.get(layer)?.pads||[]){
    if(allowNet&&!allowComponent&&!p.net)continue;
    if(allowComponent&&!allowNet&&!p.refdes)continue;
    const dx=x-p.position[0],dy=y-p.position[1],sz=p.size;
    if(Math.abs(dx)>sz[0]/2+tol||Math.abs(dy)>sz[1]/2+tol)continue;
    const distance=Math.max(0,Math.hypot(dx,dy)-Math.max(sz[0],sz[1])/2);
    if(distance<best){best=distance;pick={type:'pad',obj:p}}
  }}
  if(!pick&&allowComponent){for(const c of db.components||[]){if(!c.position)continue;
    const dist=Math.hypot(x-c.position[0],y-c.position[1]);
    if(dist<best){best=dist;pick={type:'component',obj:c}}
  }}
  if(!pick&&allowNet){best=tol;for(const layer of active){for(const t of byLayer.get(layer)?.tracks||[]){
    if(!t.net)continue;
    const a=t.endpoints?.[0],b=t.endpoints?.[1];if(!a||!b)continue;
    const pad=best+(t.width||0)/2;
    if(x<Math.min(a[0],b[0])-pad||x>Math.max(a[0],b[0])+pad||y<Math.min(a[1],b[1])-pad||y>Math.max(a[1],b[1])+pad)continue;
    const dist=pointSegmentDistance(x,y,a,b)-Math.max(0,Number(t.width)||0)/2;
    if(dist<best){best=dist;pick={type:'track',obj:t}}
  }}}
  // Copper fill is rendered beneath tracks and pads. If neither is hit,
  // select the polygon's net; never choose a clearance/void as copper.
  if(!pick&&allowNet){const z=pickZoneAt(x,y);if(z)pick={type:'zone',obj:z}}
  if(!pick)return;
  let changedComponent=false,changedNet=false;
  if(pick.type==='pad'){
    if(allowComponent&&pick.obj.refdes){selectedPin=pick.obj.pin_id;selectedComponent=pick.obj.refdes;changedComponent=true}
    if(allowNet&&pick.obj.net){net=pick.obj.net;changedNet=true}
  }else if(pick.type==='component'){
    if(allowComponent){selectedComponent=pick.obj.refdes;selectedPin=null;changedComponent=true}
  }else if(allowNet&&pick.obj.net){net=pick.obj.net;changedNet=true}
  if(changedComponent){$('componentSearch').value=selectedComponent||'';searchComponents()}
  if(changedNet){$('search').value=net;$('mode').value='highlight';searchNets()}
  if(changedComponent||changedNet)paint();
}
function updatePickHint(){
  const c=$('pickComponent').checked,n=$('pickNet').checked;
  $('pickHint').textContent=c&&n?'两项已开启：点击焊盘可同时选中器件和网络；点击铺铜选中网络。':
    c?'仅选择器件：点击焊盘或器件中心，不更改网络选择。':
    n?'仅选择网络：点击焊盘、走线或铺铜，不更改器件选择。':
    '两项均关闭：点击 PCB 不会更改任何选择。';
}
$('pickComponent').onchange=updatePickHint;
$('pickNet').onchange=updatePickHint;
updatePickHint();
function drawSelection(){if(!selectedComponent)return;const c=componentMap.get(selectedComponent);if(!c?.position)return;const [x,y]=c.position;
  const segs=packageByRef.get(selectedComponent)||[];let loX=Infinity,loY=Infinity,hiX=-Infinity,hiY=-Infinity;
  for(const g of segs){if(!g.layer?.includes('PLACE_BOUND')&&!g.layer?.includes('ASSEMBLY'))continue;for(const p of g.geometry?.endpoints||[]){loX=Math.min(loX,p[0]);loY=Math.min(loY,p[1]);hiX=Math.max(hiX,p[0]);hiY=Math.max(hiY,p[1])}}
  if(!Number.isFinite(loX)){loX=x-40;loY=y-40;hiX=x+40;hiY=y+40}
  const margin=7/scale;ctx.save();ctx.strokeStyle='#ff5d97';ctx.lineWidth=2.5/scale;ctx.setLineDash([7/scale,4/scale]);ctx.strokeRect(loX-margin,loY-margin,hiX-loX+2*margin,hiY-loY+2*margin);ctx.setLineDash([]);
  ctx.beginPath();ctx.arc(x,y,Math.max(10/scale,2),0,Math.PI*2);ctx.stroke();ctx.restore();
}

function bounds(){let xs=[],ys=[];for(const s of db.board?.outline||[]){for(const p of s.endpoints||[]){xs.push(p[0]);ys.push(p[1])}}if(!xs.length){for(const c of db.components||[]){if(c.position){xs.push(c.position[0]);ys.push(c.position[1])}}}return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]}
function fit(){if(!db)return;const [x,y,X,Y]=bounds();center=[(x+X)/2,(y+Y)/2];const w=Math.max(1,X-x),h=Math.max(1,Y-y),a=Math.abs(Math.cos(theta)),b=Math.abs(Math.sin(theta));scale=Math.min((canvas.width-55)/(a*w+b*h),(canvas.height-55)/(b*w+a*h));pan=[0,0];paint()}
function resize(){const r=canvas.getBoundingClientRect();canvas.width=Math.round(r.width);canvas.height=Math.round(r.height);if(db)fit();else{ctx.fillStyle='#081217';ctx.fillRect(0,0,canvas.width,canvas.height)}}
function setup(d){if(!Array.isArray(d.layers)||!Array.isArray(d.zones)||!Array.isArray(d.tracks))throw Error('不支持该 JSON：需要 v0.8 layers/zones/tracks');
  db=d;byLayer=new Map();zoneCache=new WeakMap();zoneBoundsCache=new WeakMap();componentMap=new Map((d.components||[]).map(c=>[c.refdes,c]));packageByRef=new Map();
  for(const g of d.package_graphics||[]){if(g.refdes){if(!packageByRef.has(g.refdes))packageByRef.set(g.refdes,[]);packageByRef.get(g.refdes).push(g)}}
  selectedComponent=null;selectedPin=null;validPads=0;invalidPads=0;
  for(const l of d.layers)byLayer.set(l.allegro_layer,{zones:[],tracks:[],pads:[]});
  for(const z of d.zones)byLayer.get(z.layer)?.zones.push(z);
  for(const t of d.tracks)byLayer.get(t.layer)?.tracks.push(t);
  for(const p of d.pads||[]){if(validPad(p)){byLayer.get(p.layer)?.pads.push(p);validPads++}else invalidPads++} 
  active=new Set([d.layers[0].allegro_layer]);net=null;$('search').value='';$('componentSearch').value='';$('mode').value='all';nets=[...new Set([...d.zones.map(x=>x.net),...d.tracks.map(x=>x.net),...(d.pads||[]).map(x=>x.net)].filter(Boolean))].sort();
  $('layers').innerHTML=d.layers.map((l,i)=>`<label class="layer"><input type="checkbox" data-layer="${l.allegro_layer}" ${active.has(l.allegro_layer)?'checked':''}><span style="color:${colors[i%colors.length]}">${l.allegro_layer.replace('ETCH/','')}</span><small>${(byLayer.get(l.allegro_layer)?.zones.length||0)} 铜皮</small></label>`).join('');
  $('stats').textContent=`铜层: ${d.layers.length}\n器件: ${d.components?.length||0}\n走线段: ${d.tracks.length}\nShape: ${d.zones.length}\n有效焊盘图形: ${validPads}\nNULL/无效占位: ${invalidPads}\n物理 PIN: ${d.pins?.length||0}\nNet 名: ${nets.length}\n来源单位: ${d.source?.units||'未知'}`;
  $('coverage').textContent=`⚠️ ${d.extraction_status?.zones||'未知'}；PIN=${d.extraction_status?.pins||'未知'}；VIA=${d.extraction_status?.vias||'未知'}；独立铜皮=${d.extraction_status?.standalone_copper||'未知'}`;
  searchNets();searchComponents();fit();
}
function searchNets(){if(!db)return;const q=$('search').value.trim().toLowerCase();let list=nets.filter(n=>n.toLowerCase().includes(q)).slice(0,45);if(net&&!list.includes(net))list.unshift(net);$('netlist').innerHTML=list.map(n=>`<button class="netrow ${net===n?'active':''}" data-net="${n.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')}">${n.replaceAll('&','&amp;').replaceAll('<','&lt;')}</button>`).join('');$('netinfo').textContent=net?`当前：${net}；所属 Shape：${db.zones.filter(z=>z.net===net).length}`:'未选择网络'}
$('file').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{$('overlay').textContent=`正在读取 ${f.name}…`;await new Promise(r=>setTimeout(r,25));const d=JSON.parse(await f.text());setup(d)}catch(err){alert(`加载失败: ${err.message}`);$('overlay').textContent=err.message}};
$('layers').onchange=e=>{const l=e.target.dataset.layer;if(!l)return;e.target.checked?active.add(l):active.delete(l);paint()};
function selectedLayers(s){active=new Set(s);$('layers').querySelectorAll('input').forEach(x=>x.checked=active.has(x.dataset.layer));paint()}
const graphicControls=['zones','tracks','pads','board','partsTop','partsBottom','silkTop','silkBottom','assemblyTop','assemblyBottom','placeTop','placeBottom','refdes'];
function applyPreset(which){
  if(!db)return;
  if(which==='none'){
    for(const id of graphicControls)$(id).checked=false;
    selectedLayers([]);return;
  }
  if(which==='all'){selectedLayers(db.layers.map(x=>x.allegro_layer));return}
  const isTop=which==='top';
  for(const id of ['zones','tracks','pads','board'])$(id).checked=true;
  for(const kind of ['parts','silk','assembly']){
    $(kind+'Top').checked=isTop;$(kind+'Bottom').checked=!isTop;
  }
  // Place Bound and auto-labels are separate optional overlays.
  $('placeTop').checked=false;$('placeBottom').checked=false;$('refdes').checked=false;
  selectedLayers([isTop?'ETCH/TOP':'ETCH/BOTTOM']);
}
$('all').onclick=()=>applyPreset('all');$('none').onclick=()=>applyPreset('none');$('top').onclick=()=>applyPreset('top');$('bottom').onclick=()=>applyPreset('bottom');
for(const id of ['zones','tracks','pads','board','partsTop','partsBottom','silkTop','silkBottom','assemblyTop','assemblyBottom','placeTop','placeBottom','refdes','mode'])$(id).onchange=paint;
function rotate(v){theta=v*Math.PI/180;$('angle').value=v;fit()};$('rotL').onclick=()=>rotate((Number($('angle').value)-90+360)%360);$('rotR').onclick=()=>rotate((Number($('angle').value)+90)%360);$('angle').onchange=()=>rotate(Number($('angle').value));$('face').onchange=e=>{mirror=e.target.value==='bottom';paint()};$('fit').onclick=fit;
function selectNet(value){net=value||null;if(net){$('search').value=net;$('mode').value='highlight'}else{$('search').value='';$('mode').value='all'}searchNets();paint()}
function selectComponent(value){selectedComponent=value&&componentMap.has(value)?value:null;$('componentSearch').value=selectedComponent||'';searchComponents();paint()}
function searchComponents(){if(!db)return;const q=$('componentSearch').value.trim().toLowerCase();let list=(db.components||[]).filter(c=>!q||[c.refdes,c.value,c.footprint].some(v=>String(v||'').toLowerCase().includes(q))).slice(0,60);
  if(selectedComponent&&!list.some(c=>c.refdes===selectedComponent)){const c=componentMap.get(selectedComponent);if(c)list.unshift(c)}
  $('componentList').innerHTML=list.map(c=>`<button class="netrow ${selectedComponent===c.refdes?'active':''}" data-refdes="${esc(c.refdes)}">${esc(c.refdes)} · ${esc(c.side)} · ${esc(c.value)}</button>`).join('');
  const c=componentMap.get(selectedComponent);$('componentInfo').textContent=c?`${c.refdes} · ${c.side} · ${c.footprint} · (${c.position?.join(', ')})`:'未选择器件';}
$('search').oninput=()=>{const q=$('search').value.trim();const matches=nets.filter(n=>n.toLowerCase()===q.toLowerCase());if(matches.length===1){net=matches[0];$('mode').value='highlight';paint()}searchNets()};
$('netlist').onclick=e=>{const b=e.target.closest('[data-net]');if(b)selectNet(b.dataset.net)};
$('clear').onclick=()=>selectNet(null);
$('componentSearch').oninput=()=>{const q=$('componentSearch').value.trim();const c=[...componentMap.keys()].find(x=>x.toLowerCase()===q.toLowerCase());if(c){selectedComponent=c;paint()}searchComponents()};
$('componentList').onclick=e=>{const b=e.target.closest('[data-refdes]');if(b)selectComponent(b.dataset.refdes)};
$('clearComponent').onclick=()=>selectComponent(null);

let pointerDown=null;
canvas.onpointerdown=e=>{drag=[e.clientX,e.clientY];pointerDown=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId)};
canvas.onpointermove=e=>{if(!drag||!db)return;pan[0]+=e.clientX-drag[0];pan[1]+=e.clientY-drag[1];drag=[e.clientX,e.clientY];paint()};
canvas.onpointerup=e=>{const click=pointerDown&&Math.hypot(e.clientX-pointerDown[0],e.clientY-pointerDown[1])<5;drag=null;pointerDown=null;if(click&&db)pickAt(e)};
canvas.onpointercancel=()=>{drag=null;pointerDown=null};
canvas.onwheel=e=>{if(!db)return;e.preventDefault();let f=Math.exp(-e.deltaY*.001);let old=scale;scale=Math.min(100,Math.max(.0001,scale*f));const r=canvas.getBoundingClientRect(),x=e.clientX-r.left-canvas.width/2-pan[0],y=e.clientY-r.top-canvas.height/2-pan[1];const ratio=scale/old;pan[0]-=x*(ratio-1);pan[1]-=y*(ratio-1);paint()};
new ResizeObserver(resize).observe($('canvaswrap'));resize();
