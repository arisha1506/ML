
(function(){
let D;
try { D = window.__CELLS_DATA__; }
catch(e){ const ld = document.getElementById("loading"); if(ld) ld.innerHTML = "Не удалось загрузить данные карты. Обновите страницу.";
  return; }
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
// настоящие цвета линий московского транспорта
const LINECOLOR = {
  "1":"#EF161E","2":"#2DBE2C","3":"#0078BE","4":"#00BFFF","4А":"#00BFFF","5":"#8D5B2D",
  "6":"#ED9121","7":"#800080","8":"#FFCD1C","8А":"#FFCD1C","9":"#999999","10":"#99CC00",
  "11":"#82C0C0","12":"#A1B3D4","15":"#DE64A1","16":"#78C2A4","17":"#C2A33E",
  "14":"#FFA8AF","D1":"#F6A600","D2":"#E54C8D","D3":"#1BAFCB","D4":"#00A64F","D4А":"#00A64F"
};
function lineColor(l){
  return LINECOLOR[l.ref] || css(l.m==="mcd" ? "--rail" : "--metro");
}
// линия в шаге маршрута известна по названию, а цвет — по номеру
const NAME2REF = [["сокольнич","1"],["замоскворец","2"],["арбатско","3"],["филёвск","4"],["филевск","4"],
  ["кольцев","5"],["калужско","6"],["таганско","7"],["солнцевск","8А"],["калининск","8"],
  ["серпуховско","9"],["люблинско","10"],["большая кольцевая","11"],["бутовск","12"],
  ["некрасовск","15"],["троицк","16"],["рублёво","17"],["мцк","14"],["центральное кольцо","14"]];
function refOfLine(name, mode){
  const s = String(name || "").toLowerCase();
  const d = s.match(/д\s*-?\s*([1-4])/);
  if(mode === "mcd" && d) return "D" + d[1];
  for(const [key, ref] of NAME2REF) if(s.includes(key)) return ref;
  return null;
}
function stepColor(st){
  const ref = refOfLine(st.line, st.mode);
  return (ref && LINECOLOR[ref]) || css(MODE[st.mode][1]);
}
const MODE = {subway:["метро","--metro"], mck:["МЦК","--metro"], mcd:["МЦД","--rail"],
  suburban:["электричка","--rail"], bus:["автобус","--surface"], tram:["трамвай","--surface"],
  trolleybus:["троллейбус","--surface"]};
const SIDE = ["север","северо-восток","восток","юго-восток","юг","юго-запад","запад","северо-запад"];
const fmt = (x,d=0)=> Number(x).toLocaleString("ru-RU",{maximumFractionDigits:d,minimumFractionDigits:d});

document.getElementById("n-beta").textContent = "β = "+String(D.beta).replace(".", ",");
document.getElementById("n-target").textContent = D.target_min;
if(document.getElementById("n-cells")) document.getElementById("n-cells").textContent = D.cells.length.toLocaleString("ru-RU");
document.getElementById("n-cells").textContent = fmt(D.cells.length);

// --- проекция: км от центра (равнопромежуточная, север вверх) ---
const [lon0, lat0] = D.center, k = Math.cos(lat0*Math.PI/180);
const P = ([lo,la]) => [(lo-lon0)*111.32*k, -(la-lat0)*110.574];
D.cells.forEach(c=>{ c.pb = c.b.map(P); c.pc = [d3.mean(c.pb,p=>p[0]), d3.mean(c.pb,p=>p[1])]; });
D.anchors.forEach(a=>a.p = P([a.lo,a.la]));
const retailP = D.retail.map(P), stP = D.stations.map(s=>[...P(s), s[2]]);
D.lines.forEach(l=> l.pp = l.p.map(part=>part.map(P)));
// маршруты лежат упакованно: целые единицы 1e-4 градуса и разности
const RT = D.rt || {};
function unpack(ints){
  const pts = []; let x = 0, y = 0;
  for(let i = 0; i < ints.length; i += 2){ x += ints[i]; y += ints[i+1]; pts.push([x/1e4, y/1e4]); }
  return pts;
}
const routeCache = new Map();
function routeOf(cellId){
  if(routeCache.has(cellId)) return routeCache.get(cellId);
  const r = RT[cellId];
  if(!r){ routeCache.set(cellId, null); return null; }
  const rides = r.s.filter(st => st.k === "ride");
  let ri = 0;
  const out = {a:r.a, total:r.t, tw:r.tw, tq:r.tq, tr:r.tr, steps:r.s,
               draw:r.d.map(([k, mode, ints]) => {
                 const ride = k !== "w";
                 return {k: ride ? "ride" : "walk", mode, pp: unpack(ints).map(P),
                         col: ride && rides[ri] ? stepColor(rides[ri++]) : null};
               })};
  routeCache.set(cellId, out); return out;
}
const baseImg = new Image(); baseImg.onload = ()=> draw(); baseImg.src = D.basemap;

// корзины для поиска ячейки под курсором: ближайший центр = свой гексагон
const B = 1.0, bucket = new Map();
D.cells.forEach((c,i)=>{ const key = Math.floor(c.pc[0]/B)+","+Math.floor(c.pc[1]/B);
  (bucket.get(key)||bucket.set(key,[]).get(key)).push(i); });
function cellAt(x,y){ let best=-1, bd=0.36; const bx=Math.floor(x/B), by=Math.floor(y/B);
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){ const arr=bucket.get((bx+dx)+","+(by+dy)); if(!arr) continue;
    for(const i of arr){ const c=D.cells[i].pc, d=(c[0]-x)**2+(c[1]-y)**2; if(d<bd){bd=d;best=i;} } }
  return best; }

// --- холст и масштаб ---
const box = document.getElementById("mapbox"), cv = document.getElementById("map"), ctx = cv.getContext("2d");
let W=0,H=0,dpr=1,base=1, T=d3.zoomIdentity;
function resize(){ dpr=window.devicePixelRatio||1; W=box.clientWidth; H=box.clientHeight;
  cv.width=W*dpr; cv.height=H*dpr; base = Math.min(W,H)/(2*(D.radius_km+1.5)); draw(); }
const toS = p => T.apply([W/2 + p[0]*base, H/2 + p[1]*base]);
const fromS = (x,y) => { const [a,b]=T.invert([x,y]); return [(a-W/2)/base,(b-H/2)/base]; };

const zoom = d3.zoom().scaleExtent([1,40]).on("zoom", e=>{ T=e.transform; draw(); placeBalloon(); });
d3.select(cv).call(zoom);
document.getElementById("reset").onclick = ()=> d3.select(cv).transition().duration(400).call(zoom.transform, d3.zoomIdentity);
document.getElementById("zin").onclick  = ()=> d3.select(cv).transition().duration(220).call(zoom.scaleBy, 1.6);
document.getElementById("zout").onclick = ()=> d3.select(cv).transition().duration(220).call(zoom.scaleBy, 1/1.6);

// --- состояние ---
const $ = id=>document.getElementById(id);
let colorBy="t", selCell=-1, curRoute=null, hovCell=-1, selOffice=0;
// время от каждого центра занятости до каждой ячейки: один байт на пару,
// 255 значит «дольше трёх часов». Нужно, чтобы человек сам указал работу.
let WT = null, WT_N = 0;
function workTimes(){
  if(WT || !D.wt) return WT;
  const bin = atob(D.wt.b64);
  WT = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) WT[i] = bin.charCodeAt(i);
  WT_N = D.wt.n_cells;
  return WT;
}
let myWork = -1;          // индекс выбранного места работы в D.anchors
let pickMode = false;     // ждём клика по карте, чтобы поставить работу
function timeToWork(cellIndex){
  if(myWork < 0) return null;
  const t = workTimes();
  if(!t) return null;
  const v = t[myWork * WT_N + cellIndex];
  return v === 255 ? null : v;
}
const CIDX = new Map((D.cellorder || []).map((id, i) => [id, i]));
$("colorby").onchange = e=>{ colorBy=e.target.value;
  draw(); };
// выбор офиса для режима «время до выбранного офиса»
// --- где вы работаете: выбор места работы и поиск по карте ---
function workLabel(i){
  const a = D.anchors[i];
  return (a.n || (a.ad ? "офис, " + a.ad : "офисное здание"));
}
function setWork(i, recolor){
  myWork = i;
  const to = document.getElementById("qto");
  if(to && i >= 0){ to.value = fixq(workLabel(i));
    const c = to.parentNode.querySelector(".ioclear"); if(c) c.hidden = false; }
  const hint = document.getElementById("whint");
  if(hint){ hint.textContent = ""; hint.hidden = true; }
  if(recolor){
    const sel = $("colorby");
    sel.value = "off"; sel.dispatchEvent(new Event("change"));
    if(window.__ddrender) window.__ddrender();
  }
  showCalc(); draw();
  if(selCell >= 0){ routeForCell(selCell); if(!balloon.hidden) showBalloon(); }
}
(function(){
  const btn = document.getElementById("wpick");
  if(!btn) return;
  btn.onclick = e => {
    e.stopPropagation();
    pickMode = !pickMode;
    btn.setAttribute("aria-pressed", String(pickMode));
    btn.textContent = pickMode ? "Нажмите на карту" : "Указать работу на карте";
    cv.style.cursor = pickMode ? "crosshair" : "grab";
  };
  window.__wpick = btn;
  setWork(-1, false);
})();

// --- поиск по адресам, станциям и районам ---
const norm = x => String(x || "").toLowerCase().replace(/ё/g, "е");
const HOUSE = /^[0-9]+[а-яa-z]?(к[0-9]+[а-я]?|с[0-9]+[а-я]?|\/[0-9]+[а-я]?)?$/;

function nearestCell(lo, la){
  const q = P([lo, la]);
  let best = -1, bd = 1.2;
  for(let i = 0; i < D.cells.length; i++){
    const c = D.cells[i].pc, dd = (c[0]-q[0])**2 + (c[1]-q[1])**2;
    if(dd < bd){ bd = dd; best = i; }
  }
  return best;
}
function nearestAnchor(cellIndex){
  const q = D.cells[cellIndex].pc;
  let best = -1, bd = Infinity;
  D.anchors.forEach((a, k) => { const d = (a.p[0]-q[0])**2 + (a.p[1]-q[1])**2;
    if(d < bd){ bd = d; best = k; } });
  return best;
}

// адрес целиком: район знают не все, поэтому пишем и город
function place(cellIndex, dn, kind){
  const c = D.cells[cellIndex];
  const city = c && c.ct ? c.ct : "";
  const parts = kind === "street" ? ["улица"] : [];
  if(dn && dn !== "—") parts.push(dn);
  if(city && city !== dn) parts.push(city);
  return parts.join(", ");
}
// что умеет находить поиск: улицы с домами, станции, районы и бизнес-центры
const SEARCH = (function(){
  const list = [];
  const seen = new Set();
  D.cells.forEach((c, i) => { if(c.dn && !seen.has(c.dn)){ seen.add(c.dn);
    list.push({kind: "cell", i, title: c.dn,
      sub: c.ct === "Москва" ? "район Москвы" : "Московская область"}); } });
  (D.stnames || []).forEach(([lo, la, name, group]) => {
    const i = nearestCell(lo, la);
    if(i >= 0) list.push({kind: "cell", i, title: name,
      sub: (group === "metro" ? "станция метро" : "станция железной дороги") +
           ", " + place(i, D.cells[i].dn)});
  });
  // одна и та же улица бывает в нескольких городах, поэтому запись на пару
  // «улица и район»: иначе Промышленная в Царицыне и в Мытищах — одно и то же
  (D.st && D.st.streets || []).forEach(([name, main, groups, dn]) => {
    list.push({kind: "street", i: main, title: name, groups, sub: place(main, dn, "street")});
  });
  D.anchors.forEach((a, i) => list.push({kind: "work", i, title: workLabel(i),
    sub: [a.d, Math.round(a.e/1000) + " тыс. рабочих мест"].filter(Boolean).join(", ")}));

  list.forEach(it => { it.key = norm(it.title); it.subkey = norm(it.sub); });
  return list;
})();

// название важнее, чем район в подписи: «Вернадского 101» — это проспект
// Вернадского, а не улица Коштоянца, которая просто стоит в этом районе
function hitIn(text, w){
  let hit = 0;
  for(const pt of text.split(/[^0-9a-zа-я]+/)){
    if(!pt) continue;
    if(pt === w) hit = Math.max(hit, 3);
    else if(pt.startsWith(w)) hit = Math.max(hit, 2);
    else if(w.length >= 4 && pt.includes(w)) hit = Math.max(hit, 1);
  }
  return hit;
}
function score(it, words){
  let s = 0;
  for(const w of words){
    const inTitle = hitIn(it.key, w);
    if(inTitle) { s += inTitle * 4; continue; }
    const inSub = hitIn(it.subkey, w);
    if(!inSub) return 0;
    s += inSub;
  }
  // лишние слова в названии — штраф: «Тверская» ближе к «Тверской улице», чем к «1-й Тверской-Ямской»
  const GENERIC = new Set(["улица","проспект","переулок","шоссе","бульвар","проезд","площадь","набережная","тупик","аллея","станция","метро","район","поселение"]);
  const extra = it.key.split(/[^0-9a-zа-я]+/).filter(t => t && !GENERIC.has(t) && !words.some(w => t.startsWith(w))).length;
  // при равенстве Москва выше области: «Ленинский проспект» — скорее московский
  const city = /(^|, )москва$/.test(it.subkey) ? 0.3 : 0;
  return s - 0.6 * extra + city + (it.kind === "street" ? 1 : it.kind === "cell" ? 0.5 : 0);
}
// ячейка улицы с учётом номера дома: длинная улица проходит через много ячеек
function cellOfStreet(it, house){
  if(!house || !it.groups) return it.i;
  const h = norm(house);
  for(const [cell, hs] of it.groups)
    if(hs.split(",").some(x => norm(x) === h)) return cell;
  // точного номера в выгрузке нет: берём участок улицы с ближайшим номером
  const want = parseInt(h, 10);
  if(!isFinite(want)) return it.i;
  let best = it.i, bd = Infinity;
  for(const [cell, hs] of it.groups)
    for(const x of hs.split(",")){
      const n = parseInt(x, 10);
      if(isFinite(n) && Math.abs(n - want) < bd){ bd = Math.abs(n - want); best = cell; }
    }
  return best;
}
// есть ли такой номер дома на этом участке улицы
function hasHouse(it, house){
  if(!house || !it.groups) return false;
  const h = norm(house).replace(/\s+/g, "");
  // «12» совпадает и с «12», и с «12 к1»: корпус человек часто не пишет
  return it.groups.some(([cell, hs]) => hs.split(",").some(x => {
    const v = norm(x).replace(/\s+/g, "");
    return v === h || (/^[0-9]+$/.test(h) && v.replace(/[^0-9].*$/, "") === h);
  }));
}
// насколько номер дома на этом участке улицы близок к искомому
function houseGap(it, house){
  const want = parseInt(house, 10);
  if(!it.groups || !isFinite(want)) return Infinity;
  let bd = Infinity;
  for(const [cell, hs] of it.groups)
    for(const x of hs.split(",")){ const n = parseInt(x, 10); if(isFinite(n)) bd = Math.min(bd, Math.abs(n - want)); }
  return bd;
}
function searchFind(text){
  const words = norm(text).replace(/,/g, " ").trim().split(/\s+/).filter(Boolean);
  if(!words.length) return {found: [], house: null};
  let house = null, q = words;
  if(words.length > 1 && HOUSE.test(words[words.length - 1])){
    house = words[words.length - 1]; q = words.slice(0, -1);
  }
  // «Москва-Сити», «Тёплый Стан», «ул. Ленина»: дефисы и точки — тоже границы слов
  q = q.flatMap(w => w.split(/[-–—.]+/)).filter(w => w && !["ул", "улица", "д", "дом", "пр", "просп"].includes(w));
  if(!q.length) return {found: [], house};
  let scored = SEARCH.map(it => ({it, s: score(it, q)})).filter(x => x.s > 0);
  if(house){
    scored = scored.filter(x => x.it.kind !== "work");
    // одна улица бывает в нескольких районах: оставляем те участки, где дом с таким номером есть
    // дом с таким номером есть на участке — выше; нет — ближе тот, где номера рядом
    scored.forEach(x => { x.g = x.it.kind !== "street" ? 999 : hasHouse(x.it, house) ? -1 : houseGap(x.it, house); });
  }
  // одинаковые подсказки не повторяем: у станции бывает несколько входов в выгрузке
  const seenKey = new Set();
  const found = scored.sort((a, b) => (b.s - a.s) || ((a.g ?? 0) - (b.g ?? 0)) || a.it.title.length - b.it.title.length)
    .filter(x => { const k = x.it.title + "|" + x.it.sub; if(seenKey.has(k)) return false; seenKey.add(k); return true; })
    .slice(0, 12).map(x => x.it);
  return {found, house};
}

function wireSearch(inputId, onPick, onlyWork){
  const input = document.getElementById(inputId);
  if(!input) return;
  const res = document.getElementById(inputId + "res");
  const clear = input.parentNode.querySelector(".ioclear");
  let current = [], house = null, act = -1;
  function show(on){ res.hidden = !on; input.setAttribute("aria-expanded", String(on)); }
  function mark(){
    res.querySelectorAll("button").forEach((b, n) => {
      b.classList.toggle("act", n === act); b.setAttribute("aria-selected", String(n === act));
      if(n === act) b.scrollIntoView({block: "nearest"});
    });
  }
  function pick(n){
    const it = current[n];
    if(!it) return;
    show(false);
    input.value = it.title + (house && it.kind === "street" ? " " + house : "");
    onPick(it, house);
  }
  function render(){
    clear.hidden = !input.value;
    act = -1;
    if(norm(input.value).trim().length < 2){ show(false); return; }
    const r = searchFind(input.value);
    current = r.found; house = r.house;
    show(true);
    res.innerHTML = current.length
      ? current.map((it, n) => `<button type="button" role="option" id="${inputId}-o${n}" data-n="${n}">${
          fixq(it.title)}${house && it.kind === "street" ? " " + house : ""}<small>${it.sub}</small></button>`).join("")
      : `<p class="none">Ничего не нашлось. Попробуйте улицу с номером дома, станцию метро, район${
          onlyWork ? " или название бизнес-центра" : ""}.</p>`;
    res.querySelectorAll("button").forEach(b => b.onclick = () => pick(+b.dataset.n));
  }
  input.addEventListener("input", render);
  input.addEventListener("focus", render);
  input.addEventListener("keydown", e => {
    if(e.key === "ArrowDown" || e.key === "ArrowUp"){
      if(res.hidden) render();
      if(!current.length) return;
      e.preventDefault();
      act = (act + (e.key === "ArrowDown" ? 1 : -1) + current.length) % current.length;
      mark();
    } else if(e.key === "Enter"){
      if(current.length && !res.hidden){ e.preventDefault(); pick(act >= 0 ? act : 0); }
    } else if(e.key === "Escape"){ show(false); }
  });
  clear.onclick = () => { input.value = ""; show(false); clear.hidden = true; input.focus(); };
  document.addEventListener("click", e => { if(!e.target.closest(".iorow")) show(false); });
}

function flyTo(i){
  const c = D.cells[i], k = 7, q = c.pc;
  const t = d3.zoomIdentity.translate(W/2 - k*(W/2 + q[0]*base), H/2 - k*(H/2 + q[1]*base)).scale(k);
  d3.select(cv).transition().duration(600).call(zoom.transform, t);
  selCell = i; showCell(); showBalloon(); routeForCell(i); draw();
  const hb = document.getElementById("hintbar"); if(hb) hb.hidden = true;
  if(isPhone()) box.scrollIntoView({behavior: "smooth", block: "start"});
}
wireSearch("qfrom", (it, house) => {
  const i = it.kind === "street" ? cellOfStreet(it, house) : it.i;
  if(i >= 0) flyTo(i);
});
wireSearch("qto", (it, house) => {
  if(it.kind === "work") return setWork(it.i, true);
  const i = it.kind === "street" ? cellOfStreet(it, house) : it.i;
  if(i < 0) return;
  const a = nearestAnchor(i);
  if(a < 0) return;
  setWork(a, true);
  const q = D.cells[i].pc, p = D.anchors[a].p;
  const km = Math.sqrt((q[0]-p[0])**2 + (q[1]-p[1])**2);
  const hint = document.getElementById("whint");
  if(hint){
    hint.innerHTML = km < 1.2
      ? `Время считается до ближайшего посчитанного офиса — ${workLabel(a)}, ${
          km < 0.3 ? "это тот же квартал" : "это " + fmt(km*1000) + " м от вашего адреса"}.`
      : `Рядом с этим адресом нет офиса из 195 посчитанных. Взят ближайший — ${
          workLabel(a)}, он в ${fmt(km,1)} км: время считается до него.`;
    hint.hidden = false;
  }
}, true);

// подбор района: своя панель, пересчёт сразу при изменении условий
(function(){
  const out = document.getElementById("f-out");
  const btn = document.getElementById("pickbtn"), panel = document.getElementById("pickpanel");
  const count = document.getElementById("pickcount"), mapbox = document.getElementById("mapbox");
  const chips = [...panel.querySelectorAll(".pchips button")];
  const get = id => +document.getElementById(id).value;
  let timer = null;

  function setTime(t){
    document.getElementById("f-time").value = t;
    chips.forEach(c => c.setAttribute("aria-checked", String(+c.dataset.t === t)));
  }
  function apply(){
    const budget = get("f-budget"), area = get("f-area"), time = get("f-time");
    filt = budget && area && time ? {budget, area, time} : null;
    if(!filt){
      out.innerHTML = `<p class="pempty">Укажите бюджет и площадь — карта сразу покажет подходящие районы.</p>`;
      count.hidden = true; draw(); return;
    }
    const wage = Math.max(10, +document.getElementById("c-wage").value || 110);
    const rows = [];
    D.cells.forEach((c, i) => {
      if(!cellFits(c)) return;
      const f = fullCost(i, area, wage);
      if(f) rows.push({i, c, f});
    });
    rows.sort((a, b) => a.f.total - b.f.total);
    count.textContent = fmt(rows.length);
    count.hidden = false;
    if(!rows.length){
      out.innerHTML = `<p class="pempty">Под эти условия не подошёл ни один район. Поднимите бюджет, уменьшите площадь или разрешите ехать дольше.</p>`;
      draw(); return;
    }
    const top = rows.slice(0, 8);
    const list = top.map((r, k) => {
      return `<button class="bestrow" type="button" data-i="${r.i}">
        <span class="rk">${k + 1}</span>
        <span class="bname2">${fixq(r.c.dn || "ячейка")}</span>
        <span class="bt">${mln(r.f.total)} ₽</span>
        <small>${fmt(r.f.t)} мин до работы, метр ${fmt(r.f.pm)} тыс ₽${r.f.predicted ? " по модели" : ""}${
          r.c.bn != null && r.c.bn > 0 ? ", дешевле модели на " + fmt(r.c.bn) + "%" : ""}</small>
        <small>${mln(r.f.flat)} квартира + ${mln(r.f.road)} дорога за 8 лет</small>
      </button>`;
    }).join("");
    out.innerHTML = `<div class="psum"><b>${fmt(rows.length)}</b><span>${plural(rows.length, "ячейка подходит", "ячейки подходят", "ячеек подходят")}, вот самые выгодные</span></div>
      <div class="bestlist">${list}</div>`;
    out.querySelectorAll(".bestrow").forEach(b => b.onclick = () => {
      flyTo(+b.dataset.i);
      if(window.matchMedia("(max-width:900px)").matches) close();
    });
    draw();
  }
  function later(){ clearTimeout(timer); timer = setTimeout(apply, 180); }
  function open(){
    panel.hidden = false; mapbox.classList.add("picking");
    btn.setAttribute("aria-expanded", "true");
    apply();
    setTimeout(() => document.getElementById("f-budget").focus({preventScroll: true}), 30);
  }
  function close(){
    panel.hidden = true; mapbox.classList.remove("picking");
    btn.setAttribute("aria-expanded", "false");
    btn.focus({preventScroll: true});
  }
  btn.onclick = () => panel.hidden ? open() : close();
  document.getElementById("pclose").onclick = close;
  const how = document.getElementById("phow");
  how.querySelector(".phowx").onclick = () => { how.open = false; how.querySelector("summary").focus({preventScroll: true}); };
  how.addEventListener("keydown", e => { if(e.key === "Escape" && how.open){ e.stopPropagation(); how.open = false; } });
  panel.addEventListener("keydown", e => { if(e.key === "Escape") close(); });
  chips.forEach(c => c.onclick = () => { setTime(+c.dataset.t); apply(); });
  ["f-budget", "f-area"].forEach(id => document.getElementById(id).oninput = later);
  document.getElementById("c-wage").addEventListener("input", () => { if(filt) later(); });
  window.__refilter = apply;
  document.getElementById("f-clear").onclick = () => {
    document.getElementById("f-budget").value = 20;
    document.getElementById("f-area").value = 50;
    setTime(45);
    filt = null; count.hidden = true;
    out.innerHTML = `<p class="pempty">Условия сброшены, на карте снова весь город. Измените любое поле, чтобы начать подбор.</p>`;
    draw();
  };
  setTime(45);
})();

// свой выпадающий список: системный остаётся для логики, но спрятан
(function(){
  const sel = $("colorby"), btn = document.getElementById("ddbtn");
  const menu = document.getElementById("ddmenu"), label = document.getElementById("ddlabel");
  function render(){
    const byML = {bn: 1, tp: 1, pmp: 1};   // эти две величины считает модель, а не формула
    menu.innerHTML = [...sel.options].filter(o => !o.hidden).map(o =>
      `<button type="button" role="option" data-v="${o.value}" aria-selected="${o.value===sel.value}">${
        byML[o.value] ? '<span class="mltag">ML</span>' : ""}${o.text}</button>`).join("");
    label.textContent = sel.options[sel.selectedIndex].text;
    menu.querySelectorAll("button").forEach(b => b.onclick = () => {
      sel.value = b.dataset.v;
      sel.dispatchEvent(new Event("change"));
      render(); close();
    });
  }
  function open(){ menu.hidden = false; btn.setAttribute("aria-expanded","true"); }
  function close(){ menu.hidden = true; btn.setAttribute("aria-expanded","false"); }
  btn.onclick = e => { e.stopPropagation(); menu.hidden ? open() : close(); };
  document.addEventListener("click", close);
  menu.addEventListener("click", e => e.stopPropagation());
  document.addEventListener("keydown", e => { if(e.key === "Escape") close(); });
  render();
  window.__ddrender = render;   // подпись списка обновляется и при выборе работы
})();
["L-base","L-hex","L-grid","L-lines","L-st","L-jobs","L-shop","L-future","L-nb"].forEach(id=>{
  const el = $(id); if(el) el.onchange = draw; });
// строящиеся станции появляются, только если собраны данные плана развития
if(D.future && D.future.length){
  const row = document.getElementById("L-future-row");
  if(row){ row.hidden = false; row.style.display = ""; }
  const opt = document.querySelector('#colorby option[value="fg"]');
  if(opt){ opt.hidden = false; if(window.__ddrender) window.__ddrender(); }
}

const TYPE_ORDER = ["рядом с метро","у промзон","спальные дальние",
                    "за городом у электрички","дальние без метро"];
const TYPE_COLORS = {"рядом с метро":"#123E6E","у промзон":"#8C7B6B",
                     "спальные дальние":"#7FA6C9","за городом у электрички":"#D9A05B",
                     "дальние без метро":"#B4542F"};

function cellValue(c){
  if(colorBy === "off"){
    const i = CIDX.get(c.id);
    if(i == null) return null;
    if(myWork >= 0) return timeToWork(i);
    const o = D.offices && D.offices[selOffice];
    return o ? o.t[i] : null;
  }
  return c[colorBy];
}
// подбор: бюджет, площадь и сколько готовы ехать
let filt = null;
function cellPrice(c){            // цена метра: по объявлениям, иначе предсказание
  return c.pm != null ? c.pm : c.pmp;
}
function cellFits(c){
  if(!filt) return true;
  const t = myWork >= 0 ? timeToWork(D.cells.indexOf(c)) : c.t;
  if(t == null || t > filt.time) return false;
  const pm = cellPrice(c);
  if(pm == null) return false;
  return pm * 1000 * filt.area <= filt.budget * 1e6;
}
// полная стоимость адреса: сама квартира плюс дорога, переведённая в деньги
// по той же ставке, что и в блоке «Ваша квартира и дорога»
function fullCost(index, area, wage){
  const c = D.cells[index];
  const pm = cellPrice(c);
  if(pm == null) return null;
  const t = myWork >= 0 ? timeToWork(index) : c.t;
  if(t == null) return null;
  const votHour = VOT_SHARE * (wage * 1000 * 12) / WORK_HOURS;
  const road = votHour * (t * TRIPS * DAYS) / 60 * ANNUITY;
  const flat = pm * 1000 * area;
  return {flat, road, total: flat + road, t, pm, predicted: c.pm == null};
}
function scaleFor(key){
  const v = D.cells.map(c=> key === "off" ? cellValue(c) : c[key]).filter(x=>x!=null).sort((a,b)=>a-b);
  const lo = v[Math.floor(v.length*0.02)], hi = v[Math.floor(v.length*0.98)];
  return {lo,hi,f:x=> Math.max(0,Math.min(1,(x-lo)/((hi-lo)||1)))};
}

function draw(){
  if(!W) return;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.fillStyle=css("--panel"); ctx.fillRect(0,0,W,H);
  const s = scaleFor(colorBy), lo=css("--hex-lo"), hi=css("--hex-hi");
  const col = d3.interpolateRgbBasis ? d3.interpolateRgbBasis([lo, css("--hex-mid"), hi])
                                     : d3.interpolateRgb(lo, hi);
  const unit = {t:"мин",n:"шт.",h:"тыс. м²",dm:"м",pm:"тыс ₽",bn:"%",off:"мин"}[colorBy]||"";
  const categorical = colorBy==="tp";
  $("legendbar").style.display = categorical ? "none" : "";
  $("tk0").parentNode.style.display = categorical ? "none" : "";
  $("legendtypes").style.display = categorical ? "flex" : "none";
  if(categorical){
    $("legendtypes").innerHTML = TYPE_ORDER.map(name=>
      `<span style="display:inline-flex;align-items:center;gap:5px"><i style="width:10px;height:10px;border-radius:50%;background:${TYPE_COLORS[name]};display:inline-block"></i>${name}</span>`).join("");
  } else {
    $("tk0").textContent=fmt(s.lo)+" "+unit; $("tk1").textContent=fmt((s.lo+s.hi)/2); $("tk2").textContent=fmt(s.hi)+" "+unit;
  }

  const dark = css("color-scheme")==="dark" || getComputedStyle(document.documentElement).colorScheme==="dark";
  const baseOn = $("L-base").checked && baseImg.complete && baseImg.naturalWidth;
  if(baseOn){ const E=D.basemap_extent_km, a=toS([-E,-E]), b=toS([E,E]);
    ctx.globalAlpha = 1; ctx.drawImage(baseImg, a[0], a[1], b[0]-a[0], b[1]-a[1]); ctx.globalAlpha=1;
    // под заливкой карту осветляем, иначе два цветных слоя мешаются в муть
    if($("L-hex").checked){ ctx.globalAlpha=0.45; ctx.fillStyle="#FFFFFF"; ctx.fillRect(0,0,W,H); ctx.globalAlpha=1; } }
  if($("L-hex").checked){
    ctx.globalAlpha = baseOn ? 0.72 : 1;   // сквозь ячейки чуть видна карта
    ctx.lineWidth=0.6; ctx.strokeStyle=css("--hex-stroke");
    for(const c of D.cells){ ctx.beginPath(); c.pb.forEach((p,i)=>{const q=toS(p); i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]);});
      ctx.closePath();
      const v = cellValue(c);
      if(categorical){ ctx.fillStyle = c.tp ? TYPE_COLORS[c.tp] : css("--hex-lo"); }
      else if(v==null){ ctx.fillStyle = css("--hex-lo"); }
      else { ctx.fillStyle = col(s.f(v)); }
      const fits = cellFits(c);
      if(filt && !fits) ctx.globalAlpha = (baseOn ? 0.72 : 1) * 0.16;
      ctx.fill(); ctx.stroke();
      if(filt && fits){ ctx.globalAlpha=1; ctx.lineWidth=2; ctx.strokeStyle="#1A1A1A"; ctx.stroke();
                        ctx.lineWidth=0.6; ctx.strokeStyle=css("--hex-stroke"); }
      ctx.globalAlpha = baseOn ? 0.72 : 1; }
    ctx.globalAlpha = 1;
  }
  const sc = T.k*base;
  if($("L-grid").checked){
    ctx.strokeStyle=css("--ink2"); ctx.globalAlpha=0.55; ctx.lineWidth=1;
    const c0=toS([0,0]);
    D.rings.slice(1).forEach(r=>{ ctx.beginPath(); ctx.arc(c0[0],c0[1],r*sc,0,2*Math.PI); ctx.stroke(); });
    const w=360/D.n_sectors;
    for(let i=0;i<D.n_sectors;i++){ const a=(i*w - w/2)*Math.PI/180; ctx.beginPath();
      ctx.moveTo(c0[0]+Math.sin(a)*D.rings[1]*sc, c0[1]-Math.cos(a)*D.rings[1]*sc);
      ctx.lineTo(c0[0]+Math.sin(a)*D.radius_km*sc, c0[1]-Math.cos(a)*D.radius_km*sc); ctx.stroke(); }
    ctx.globalAlpha=1; ctx.fillStyle=css("--ink2"); ctx.font="11px "+css("--mono");
    const ra=12*Math.PI/180;   // подписи колец — на луче чуть правее севера, мимо подписи сектора
    D.rings.slice(1).forEach(r=> ctx.fillText(r+" км", c0[0]+Math.sin(ra)*r*sc+3, c0[1]-Math.cos(ra)*r*sc-3));
    const names=["С","СВ","В","ЮВ","Ю","ЮЗ","З","СЗ"];
    for(let i=0;i<D.n_sectors;i++){ const a=i*w*Math.PI/180, R=(D.radius_km+0.9)*sc;
      ctx.fillText(names[i], c0[0]+Math.sin(a)*R-8, c0[1]-Math.cos(a)*R+4); }
  }
  if($("L-lines").checked){
    ctx.lineCap="round"; ctx.lineJoin="round";
    for(const l of D.lines){ ctx.strokeStyle=lineColor(l); ctx.globalAlpha= l.m==="mcd"?0.85:0.95;
      ctx.lineWidth = l.m==="mck"?2.6:2.0; if(l.m==="mcd") ctx.setLineDash([6,4]);
      for(const part of l.pp){ ctx.beginPath(); part.forEach((p,i)=>{const q=toS(p); i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]);}); ctx.stroke(); }
      ctx.setLineDash([]); }
    ctx.globalAlpha=1;
  }
  if($("L-st").checked){
    for(const s of stP){ const q=toS(s); ctx.beginPath(); ctx.arc(q[0],q[1],Math.max(1.6,Math.min(3.5,T.k*0.9)),0,2*Math.PI);
      ctx.fillStyle=css(s[2]==="rail"?"--rail":"--metro"); ctx.fill(); }
  }
  if($("L-shop").checked){
    ctx.fillStyle=css("--shop"); ctx.globalAlpha=0.7; const r=Math.max(1,Math.min(2.6,T.k*0.6));
    for(const p of retailP){ const q=toS(p); ctx.fillRect(q[0]-r/2,q[1]-r/2,r,r); }
    ctx.globalAlpha=1;
  }
  // ячейка под курсором: видно, что по ней можно нажать
  if(hovCell>=0 && hovCell!==selCell && $("L-hex").checked){
    const c=D.cells[hovCell];
    ctx.beginPath(); c.pb.forEach((p,i)=>{const q=toS(p); i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]);}); ctx.closePath();
    ctx.lineWidth=2.5; ctx.strokeStyle="#1A1A1A"; ctx.globalAlpha=0.5; ctx.stroke(); ctx.globalAlpha=1;
  }
  // линии «куда ездят» из выбранной ячейки
  if(selCell>=0){
    const c=D.cells[selCell], q0=toS(c.pc);
    for(const [ai,p] of c.top){ const q=toS(D.anchors[ai].p); ctx.strokeStyle=css("--jobs"); ctx.globalAlpha=0.9;
      ctx.lineWidth=1+10*p; ctx.beginPath(); ctx.moveTo(q0[0],q0[1]); ctx.lineTo(q[0],q[1]); ctx.stroke(); }
    ctx.globalAlpha=1;
    ctx.beginPath(); c.pb.forEach((p,i)=>{const q=toS(p); i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]);}); ctx.closePath();
    ctx.lineWidth=2.5; ctx.strokeStyle=css("--sel"); ctx.stroke();
  }
  if(myWork >= 0){
    const a = D.anchors[myWork], q = toS(a.p);
    ctx.beginPath(); ctx.arc(q[0], q[1], 10, 0, 2*Math.PI);
    ctx.fillStyle = css("--accent"); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.font = "600 11px " + css("--body");
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("Р", q[0], q[1] + 0.5);
    ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
  }
  else if(colorBy === "off" && D.offices && D.offices[selOffice]){
    const o = D.offices[selOffice], q = toS(P([o.lo, o.la]));
    ctx.beginPath(); ctx.arc(q[0], q[1], 9, 0, 2*Math.PI);
    ctx.fillStyle = css("--accent"); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.stroke();
  }
  if(D.future && $("L-future") && $("L-future").checked){
    for(const f of D.future){
      const q = toS(P([f.lo, f.la]));
      ctx.beginPath(); ctx.arc(q[0], q[1], 5, 0, 2*Math.PI);
      ctx.fillStyle = "#7D3CB5"; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
      if(T.k > 3){
        ctx.fillStyle = "#4A2370"; ctx.font = "500 11px " + css("--body");
        ctx.fillText(f.n + " " + f.y, q[0] + 8, q[1] + 4);
      }
    }
  }
  if(D.nb && $("L-nb") && $("L-nb").checked){
    const r = Math.max(2, Math.min(4.5, 1.5 + T.k * 0.5));
    for(const [lo, la] of D.nb){ const q = toS(P([lo, la]));
      ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, 2*Math.PI); ctx.fillStyle = "#8A2D8F"; ctx.globalAlpha = 0.8; ctx.fill();
      ctx.globalAlpha = 1; ctx.lineWidth = 1; ctx.strokeStyle = "#fff"; ctx.stroke(); }
  }
  if($("L-jobs").checked){
    const emax=d3.max(D.anchors,a=>a.e);
    for(const a of D.anchors){ const q=toS(a.p), r=2+9*Math.sqrt(a.e/emax)*Math.min(2,Math.sqrt(T.k));
      ctx.beginPath(); ctx.arc(q[0],q[1],r,0,2*Math.PI); ctx.fillStyle=css("--jobs"); ctx.globalAlpha=0.55; ctx.fill();
      ctx.globalAlpha=1; ctx.lineWidth=1; ctx.strokeStyle=css("--panel"); ctx.stroke(); }
  }
  // выбранный маршрут поверх всего
  if(curRoute){
    const r=curRoute;
    for(const L of r.draw){
      ctx.lineCap="round"; ctx.lineJoin="round";
      const c = L.k==="walk" ? css("--walk") : (L.col || css(MODE[L.mode][1]));
      if(L.k!=="walk"){ ctx.strokeStyle=css("--panel"); ctx.lineWidth=8;
        ctx.beginPath(); L.pp.forEach((p,i)=>{const q=toS(p); i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]);}); ctx.stroke(); }
      ctx.strokeStyle=c; ctx.lineWidth = L.k==="walk"? 2.2 : 5; ctx.setLineDash(L.k==="walk"?[1,5]:[]);
      ctx.beginPath(); L.pp.forEach((p,i)=>{const q=toS(p); i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]);}); ctx.stroke();
      ctx.setLineDash([]);
      if(L.k!=="walk") [L.pp[0], L.pp[L.pp.length-1]].forEach(p=>{ const q=toS(p); ctx.beginPath(); ctx.arc(q[0],q[1],4.5,0,2*Math.PI);
        ctx.fillStyle=css("--panel"); ctx.fill(); ctx.lineWidth=2.5; ctx.strokeStyle=c; ctx.stroke(); });
    }
    const s0=toS(D.cells[selCell>=0?selCell:0].pc), a=toS(D.anchors[r.a].p);
    [[s0,"--sel"],[a,"--jobs"]].forEach(([q,c])=>{ ctx.beginPath(); ctx.arc(q[0],q[1],7,0,2*Math.PI); ctx.fillStyle=css(c); ctx.fill();
      ctx.lineWidth=2.5; ctx.strokeStyle=css("--panel"); ctx.stroke(); });
  }
}

// --- подсказка и выбор ячейки ---
const tip=$("tip");
cv.addEventListener("mousemove", e=>{
  const r=cv.getBoundingClientRect(), [x,y]=fromS(e.clientX-r.left,e.clientY-r.top), i=cellAt(x,y);
  if(i<0){ tip.hidden=true; if(hovCell>=0){ hovCell=-1; cv.style.cursor="grab"; draw(); } return; }
  if(i!==hovCell){ hovCell=i; cv.style.cursor="pointer"; draw(); }
  if(i===selCell && !balloon.hidden){ tip.hidden=true; return; }
  const c=D.cells[i];
  tip.innerHTML=`${fixq(c.dn||"ячейка")}<br>до работы в среднем <b>${fmt(c.t,1)}</b> мин${c.pm!=null?`<br>метр ${fmt(c.pm)} тыс ₽`:""}<br>объявлений в ячейке ${c.n}<span class="tiphint">нажмите, чтобы раскрыть</span>`;
  tip.hidden=false; const tx=Math.min(e.clientX-r.left+14, W-250); tip.style.left=tx+"px"; tip.style.top=(e.clientY-r.top+14)+"px";
});
cv.addEventListener("mouseleave", ()=>{ tip.hidden=true; if(hovCell>=0){ hovCell=-1; draw(); } cv.style.cursor="grab"; });
cv.addEventListener("click", e=>{
  const r=cv.getBoundingClientRect(), [x,y]=fromS(e.clientX-r.left,e.clientY-r.top), i=cellAt(x,y);
  if(pickMode){                            // ставим место работы: ближайший центр занятости
    let best=-1, bd=Infinity;
    D.anchors.forEach((a,k)=>{ const d=(a.p[0]-x)**2+(a.p[1]-y)**2; if(d<bd){bd=d;best=k;} });
    pickMode=false; cv.style.cursor="grab";
    const b=window.__wpick; if(b){ b.setAttribute("aria-pressed","false"); b.textContent="Указать работу на карте"; }
    if(best>=0) setWork(best, true);
    return;
  }
  if(i<0){ hideBalloon(); return; }
  tip.hidden = true;                       // карточка уже показывает это же
  document.getElementById("hintbar").hidden = true;
  selCell=i; showCell(); showBalloon(); routeForCell(i); draw();
});

const isPhone = () => matchMedia("(max-width:900px)").matches;
function showSheet(){
  const sh = document.getElementById("msheet");
  if(!sh) return;
  if(selCell < 0){ box.classList.remove("has-sel"); sh.innerHTML = ""; return; }
  const c = D.cells[selCell], mine = timeToWork(selCell);
  const price = c.pm != null ? fmt(c.pm) + " тыс ₽" : (c.pmp != null ? "≈" + fmt(c.pmp) + " тыс ₽" : null);
  sh.innerHTML = `<button class="bclose" type="button" aria-label="Закрыть">×</button>
    <p class="mtitle">${fixq(c.dn || "Ячейка")}</p>
    <p class="mfacts"><span>${mine != null ? "до вашей работы <b>" + mine + " мин</b>" : "до работы в среднем <b>" + fmt(c.t) + " мин</b>"}</span>${
      price ? `<span>метр <b>${price}</b></span>` : ""}<span>объявлений <b>${c.n}</b></span></p>
    <button class="mgo" type="button">Подробнее и дорога по шагам</button>`;
  sh.querySelector(".bclose").onclick = ev => { ev.stopPropagation(); hideBalloon(); };
  sh.querySelector(".mgo").onclick = ev => { ev.stopPropagation();
    document.getElementById("cellcard").scrollIntoView({behavior: "smooth", block: "start"}); };
  box.classList.add("has-sel");
}
function showCell(){
  showCalc(); showEstimate();
  // результат клика не должен уезжать под экран
  const card = document.getElementById("cellcard");
  if(card && !card.hidden && !isPhone()){
    const panel = document.querySelector(".panel");
    const top = card.offsetTop - 12;
    if(panel && (panel.scrollTop > top || panel.scrollTop + panel.clientHeight < top + 160))
      panel.scrollTo({top, behavior: "smooth"});
  }
}

// похожие по доступности и среде ячейки, где метр дешевле
function similarHTML(c){
  if(!c.sim || !c.sim.length) return "";
  const rows = c.sim.map(id => {
    const i = D.cells.findIndex(x => x.id === id);
    if(i < 0) return "";
    const o = D.cells[i], price = o.pm != null ? o.pm : o.pmp;
    const diff = c.pmp && price ? Math.round(100 * (price - c.pmp) / c.pmp) : null;
    return `<button class="simrow" type="button" data-i="${i}">
      <span>${o.dn || "ячейка"}<small>${fmt(o.t,0)} мин до работы, метр ${fmt(price)} тыс ₽</small></span>
      <span class="simd">${diff != null ? diff + "%" : ""}</span></button>`;
  }).join("");
  return `<details class="offers sim"><summary>Похожие районы, где метр дешевле<span class="mltag">ML</span></summary>
    <div class="offerlist">${rows}</div>
    <p class="note">Подобраны по близости до работы, доступности рабочих мест, метро, магазинам, паркам и промзонам — цена в подбор не входила. Процент показывает, насколько метр там дешевле.</p>
  </details>`;
}

function offersHTML(c){
  if(!c.of || !c.of.length) return "";
  const rows = c.of.map(o => {
    const gap = o.fp ? Math.round(100 * (o.fp - o.p) / o.fp) : null;
    const mark = gap === null ? "" :
      `<span class="gap ${gap > 0 ? "good" : "bad"}" title="${gap > 0 ? "дешевле" : "дороже"} предсказанной моделью цены">${gap > 0 ? "+" : "−"}${Math.abs(gap)}%</span>`;
    const what = `${o.r ? o.r + "-к" : "студия"}, ${fmt(o.a,1)} м²`;
    const sub = [o.f && o.fl ? `${o.f} из ${o.fl} этаж` : null, o.y ? `${o.y} год` : null]
                .filter(Boolean).join(", ");
    const price = `${(o.p/1e6).toFixed(1).replace(".", ",")} млн`;
    const body = `<span class="ow">${what}${sub ? `<small>${sub}</small>` : ""}</span>
                  <span class="op">${price}${mark}</span>`;
    return o.u ? `<a class="offer" href="${o.u}" target="_blank" rel="noopener">${body}</a>`
               : `<span class="offer">${body}</span>`;
  }).join("");
  return `<details class="offers"><summary>Объявления в ячейке — ${c.n}</summary>
    <div class="offerlist">${rows}</div>
    <p class="note"><span class="mltag">ML</span> Процент — разница с ценой, которую предсказывает градиентный бустинг по 45 признакам квартиры и её доступности. Плюс значит дешевле предсказанного, минус дороже. Ссылки ведут на Яндекс.Недвижимость.</p>
  </details>`;
}

// --- карточка прямо на карте ---
const balloon = document.getElementById("cellcard");
function hideBalloon(){ balloon.hidden = true; selCell = -1; curRoute = null; showSheet(); draw(); }
function showBalloon(){
  if(selCell < 0) return hideBalloon();
  const c = D.cells[selCell];
  const mine = timeToWork(selCell);
  const facts = [
    mine != null ? ["до вашей работы", mine + " мин"] : null,
    ["до работы в среднем", fmt(c.t,1) + " мин"],
    ["до метро", fmt(c.dm) + " м"],
    ["объявлений в ячейке", String(c.n)],
    c.pm != null ? ["цена метра", fmt(c.pm) + " тыс ₽"]
                 : (c.pmp != null ? ['цена метра<span class="mltag">ML</span>',
                                     "≈" + fmt(c.pmp) + " тыс ₽"] : null),
    c.bn != null ? ['дешевле предсказанного<span class="mltag">ML</span>',
                    (c.bn>0?"+":"−") + Math.abs(c.bn) + "%"] : null,
    c.nb ? ["новые ЖК рядом", c.nb[0] + ", метр ≈" + fmt(c.nb[1]) + " тыс ₽"] : null,
    c.nb ? ["новый ЖК против вторички", (c.nb[2] >= 0 ? "+" : "−") + Math.abs(c.nb[2]) + "%"] : null,
    c.fs ? ["строится станция", c.fs + (c.fd != null ? ", " + fmt(c.fd) + " м" : "")] : null,
    c.fg != null && c.fg > 0.2 ? ['перспектива<span class="mltag">ML</span>', "+" + fmt(c.fg,1) + "% к цене"] : null,
    c.tp ? ['тип района<span class="mltag">ML</span>', '<span style="white-space:normal">' + c.tp + '</span>'] : null,
  ].filter(Boolean);
  balloon.innerHTML = `
    <button class="bclose" type="button" aria-label="Закрыть">×</button>
    <p class="bname">${fixq(c.dn || "Ячейка")}</p>
    <p class="bsub">${c.ct ? c.ct + ", " : ""}${D.rings[c.r]}–${D.rings[c.r+1]} км от центра, ${SIDE[c.s]}</p>
    <button class="bgo" type="button">${ICON.walk}Дорога по шагам</button>
    <dl class="bfacts">${facts.map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
    ${c.bn != null ? `<p class="note">Модель предсказывает цену квартиры по её площади, этажу, году дома и доступности. ${
      c.bn > 0 ? `Здесь объявления в среднем на ${c.bn}% дешевле предсказанного`
               : `Здесь объявления в среднем на ${Math.abs(c.bn)}% дороже предсказанного`}. Это повод посмотреть, а не вывод.</p>` : ""}
    ${similarHTML(c)}
    ${c.of && c.of.length ? offersHTML(c)
      : `<p class="note">Объявлений в этой ячейке нет, поэтому цена метра показана как предсказание модели.</p>`}`;
  balloon.querySelector(".bclose").onclick = ev => { ev.stopPropagation(); hideBalloon(); };
  balloon.querySelectorAll(".simrow").forEach(b => b.onclick = () => flyTo(+b.dataset.i));
  const go = balloon.querySelector(".bgo");
  if(go) go.onclick = ev => { ev.stopPropagation();
    document.getElementById("cellroute").scrollIntoView({behavior:"smooth", block:"start"}); };
  balloon.onclick = ev => ev.stopPropagation();
  balloon.hidden = false;
  showSheet();
}
function placeBalloon(){}
document.addEventListener("keydown", e => { if(e.key === "Escape") hideBalloon(); });
document.getElementById("hintclose").onclick = () => { document.getElementById("hintbar").hidden = true; };

// --- стоит ли оно того ---
const VOT_SHARE = 0.4, WORK_HOURS = 1750, TRIPS = 2, DAYS = 250, RATE = 0.13, YEARS = 8;
const ANNUITY = (1 - Math.pow(1 + RATE, -YEARS)) / RATE;
function money(x){
  const v = Math.abs(x);
  if(v < 100000) return Math.round(v/1000) + " тыс";
  if(v < 1e7) return (v/1e6).toFixed(1).replace(".", ",") + " млн";
  return Math.round(v/1e6) + " млн";
}
function signed(x){ return (x >= 0 ? "+" : "−") + money(x); }
// в подборе суммы близкие, поэтому всегда один знак после запятой
function mln(x){ return (x / 1e6).toFixed(1).replace(".", ",") + " млн"; }
function showCalc(){
  const box = document.getElementById("c-out");
  if(selCell < 0){ box.className="muted"; box.textContent=""; return; }
  const c = D.cells[selCell];
  const mine = timeToWork(selCell);
  const tHere = mine != null ? mine : c.t;        // своя работа важнее модельной
  const area = Math.max(10, +document.getElementById("e-area").value || 58);
  const wage = Math.max(10, +document.getElementById("c-wage").value || 110);
  const votHour = VOT_SHARE * (wage * 1000 * 12) / WORK_HOURS;
  const timeCost = votHour * (tHere * TRIPS * DAYS) / 60 * ANNUITY;
  const withPrice = D.cells.filter(x => x.pm != null);
  const median = withPrice.map(x => x.pm).sort((a,b)=>a-b)[Math.floor(withPrice.length/2)];
  const medianT = withPrice.map(x => x.t).sort((a,b)=>a-b)[Math.floor(withPrice.length/2)];
  if(c.pm == null && c.pmp == null){
    box.className="muted";
    box.innerHTML = `Объявлений здесь меньше трёх, поэтому считать цену по ним нельзя — слишком мало данных.<br>
      Дорога отсюда: <b style="color:var(--ink)">${fmt(tHere,1)} мин</b>, и за восемь лет она стоит
      <b style="color:var(--ink)">${money(timeCost)} ₽</b> при зарплате ${wage} тыс.`;
    return;
  }
  const pmHere = c.pm != null ? c.pm : c.pmp;
  const price = pmHere * 1000 * area;
  const priceMed = median * 1000 * area;
  const timeMed = votHour * (medianT * TRIPS * DAYS) / 60 * ANNUITY;
  const overpay = price - priceMed;
  const saved = timeMed - timeCost;
  box.className = "";
  let verdict;
  if(overpay > 0 && saved > 0) verdict = saved > overpay ? "дорога окупает доплату" : "доплата больше выигранного времени";
  else if(overpay > 0) verdict = "дороже медианы и дальше от работы";
  else verdict = saved < 0 ? "дешевле медианы, но дорога длиннее" : "дешевле медианы и ближе к работе";
  box.innerHTML = `
    <dl class="kv">
      <dt>квартира ${area} м²</dt><dd>${money(price)} ₽</dd>
      <dt>дорога, ${fmt(tHere,1)} мин${mine != null ? " до вашей работы" : ""}</dt><dd>${money(timeCost)} ₽ за 8 лет</dd>
      <dt>против медианной ячейки</dt><dd>${signed(overpay)} ₽</dd>
      <dt>выигрыш времени</dt><dd>${signed(saved)} ₽</dd>
    </dl>
    <p class="verdict"><b>${verdict}</b></p>
    ${c.pm == null ? '<p class="note"><span class="mltag">ML</span> Объявлений здесь мало, цена метра — прогноз модели.</p>' : ""}
    <p class="note">Время оценено в ${Math.round(votHour)} ₽ за час — это 40% часовой ставки, приведено к сегодняшним деньгам под 13% годовых на 8 лет.</p>`;
}
document.getElementById("c-wage").oninput = showCalc;

// --- оценка квартиры: эффект места плюс эффект самой квартиры ---
const EST_NAMES = ["log_area", "rooms", "floor_share", "is_first_floor",
                   "is_last_floor", "age", "ceiling_m"];
function estimate(cellIndex, flat){
  const e = D.est;
  if(!e) return null;
  const base = e.base[D.cells[cellIndex].id];
  if(base == null) return null;
  const x = {log_area: Math.log(flat.area), rooms: flat.rooms,
             floor_share: flat.floors ? flat.floor / flat.floors : 0.5,
             is_first_floor: flat.floor === 1 ? 1 : 0,
             is_last_floor: flat.floors && flat.floor === flat.floors ? 1 : 0,
             age: Math.max(0, 2026 - flat.year),
             ceiling_m: e.standard.ceiling_m};
  let v = base;
  for(const name of EST_NAMES) v += e.coef[name] * x[name];
  return Math.exp(v);
}
// разложение цены на вклады: что тянет её вверх, а что вниз
function whyHTML(cellIndex, flat){
  const w = D.why, e = D.est;
  if(!w || !e) return "";
  const z = w.cell_place[D.cells[cellIndex].id];
  if(!z) return "";
  const parts = [];
  w.place_order.forEach((name, k) => {
    const v = w.place_coef[name] * z[k];
    if(Math.abs(v) > 0.015) parts.push([w.labels[name], v]);
  });
  const st = e.standard;
  const flatParts = [
    ["площадь", e.coef.log_area * (Math.log(flat.area) - st.log_area)],
    ["возраст дома", e.coef.age * (Math.max(0, 2026 - flat.year) - st.age)],
    ["этаж", e.coef.floor_share * ((flat.floors ? flat.floor/flat.floors : 0.5) - st.floor_share)
            + (flat.floor === 1 ? e.coef.is_first_floor : 0)
            + (flat.floors && flat.floor === flat.floors ? e.coef.is_last_floor : 0)],
    ["число комнат", e.coef.rooms * (flat.rooms - st.rooms)],
  ].filter(x => Math.abs(x[1]) > 0.015);
  const all = parts.concat(flatParts).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 6);
  if(!all.length) return "";
  const rows = all.map(([name, v]) => {
    const percent = 100 * (Math.exp(v) - 1);
    return `<div class="whyrow"><span>${name}</span><span class="${percent > 0 ? "up" : "down"}">${
      percent > 0 ? "+" : "−"}${fmt(Math.abs(percent))}%</span></div>`;
  }).join("");
  return `<p class="note" style="margin-bottom:6px">Из чего складывается цена, против средней квартиры в среднем месте:</p>
    <div class="why">${rows}</div>
    <p class="note">Вклад квартиры точный, вклад места — приближение: признаки доступности и среды объясняют ${
      fmt(100 * w.place_r2)}% разброса эффекта места.</p>`;
}

function showEstimate(){
  const box = document.getElementById("e-out");
  if(!box) return;
  if(selCell < 0){ box.className = "muted";
    box.textContent = "Выберите ячейку на карте или найдите адрес."; return; }
  const get = id => +document.getElementById(id).value;
  const flat = {area: Math.max(10, get("e-area") || 58), rooms: get("e-rooms"),
                floor: Math.max(1, get("e-floor") || 1),
                floors: Math.max(1, get("e-floors") || 1), year: get("e-year") || 2008};
  const price = estimate(selCell, flat);
  if(price == null){ box.className = "muted";
    box.textContent = "Для этой ячейки модель цену не считает."; return; }
  const c = D.cells[selCell];
  box.className = "";
  const perMeter = price / flat.area / 1000;
  const fact = c.pm != null
    ? `<p class="note">В этой ячейке ${c.n} объявлений, их медиана — ${fmt(c.pm)} тыс ₽ за метр. Разница с оценкой ${
        fmt(Math.abs(perMeter - c.pm))} тыс ₽.</p>`
    : `<p class="note">Объявлений здесь нет, оценка целиком модельная.</p>`;
  box.innerHTML = `
    <p class="verdict"><b>${money(price)} ₽</b></p>
    <dl class="kv">
      <dt>цена метра</dt><dd>${fmt(perMeter)} тыс ₽</dd>
      <dt>этаж ${flat.floor} из ${flat.floors}</dt><dd>${
        flat.floor === 1 ? "−8%" : flat.floor === flat.floors ? "−2%" : "без скидки"}</dd>
      <dt>дому ${Math.max(0, 2026 - flat.year)} лет</dt><dd>−${
        fmt(100 * (1 - Math.exp(D.est.coef.age * Math.max(0, 2026 - flat.year))), 0)}%</dd>
    </dl>
    ${fact}
    ${whyHTML(selCell, flat)}
    <p class="note">Оценка складывается из эффекта места и эффекта самой квартиры. На отложенных ячейках города средняя ошибка ${
      String(D.est.chain_mae_percent).replace(".", ",")}% — полный градиентный бустинг даёт 16,3%, но он не помещается в страницу.</p>`;
}
["e-area","e-rooms","e-floor","e-floors","e-year"].forEach(id => {
  const el = document.getElementById(id);
  if(el) el.oninput = () => { showEstimate(); showCalc(); }; });

// --- подробный маршрут выбранной ячейки ---
function fixq(x){   // в выгрузке встречаются прямые кавычки: «Лотос», а не "Лотос"
  return String(x).replace(/"([^"]+)"/g, "«$1»");
}
function aname(a){ return fixq(a.n || (a.ad ? "офис, "+a.ad : "офисное здание")); }
function adesc(a){ const parts=[]; if(a.n && a.ad) parts.push(a.ad); if(a.d) parts.push(a.d);
  parts.push("≈"+fmt(a.e/1000,1)+" тыс. рабочих мест"); return parts.join(", "); }
const SHORT = {subway:"М", mck:"МЦК", mcd:"МЦД", suburban:"Э", bus:"А", tram:"Тр", trolleybus:"Тб"};
function hhmm(min){
  const m = Math.round(min);
  return m < 60 ? m + " мин" : Math.floor(m/60) + " ч " + (m%60 ? (m%60) + " мин" : "");
}
const q = n => /[«"]/.test(n) ? n : "«"+n+"»";
const RAIL = ["subway","mck","mcd","suburban"];
// пиктограммы видов транспорта: пешеход, метро, электричка, автобус, трамвай
const ICON = {
  walk: '<svg class="yicon" viewBox="0 0 16 16" fill="currentColor"><circle cx="9" cy="2.4" r="1.6"/><path d="M8.2 4.6c-.7 0-1.3.4-1.6 1L5 8.6l1.3.7 1-1.8.7 2.2-2.1 3.6 1.3.8 2.2-3.7.9 1.6v3.1h1.5v-3.5L11 9.1l1.4 1.2.9-1.1-2.3-2-.9-2.1c-.3-.4-.7-.6-1.1-.6z"/></svg>',
  subway: '<svg class="yicon" viewBox="0 0 16 16" fill="currentColor"><path d="M1.6 12.4 3 3.3c.1-.6.9-.8 1.3-.3L8 8.1l3.7-5.1c.4-.5 1.2-.3 1.3.3l1.4 9.1h-2.5l-.7-4.9-2.4 3.3h-1.6L4.8 7.5l-.7 4.9z"/></svg>',
  train: '<svg class="yicon" viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 1.5h7A1.5 1.5 0 0 1 13 3v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 10V3a1.5 1.5 0 0 1 1.5-1.5zm0 2V6h7V3.5zm1 4.3a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm5 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM4.2 12.4l-1.4 2h1.8l1-1.4zm7.6 0-1.4.6 1 1.4h1.8z"/></svg>',
  bus: '<svg class="yicon" viewBox="0 0 16 16" fill="currentColor"><path d="M3.5 2h9a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1V13a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5v-1.5h-5V13a.5.5 0 0 1-.5.5h-1A.5.5 0 0 1 3.5 13v-1.5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm.5 1.8v3.4h8V3.8zm.8 4.8a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm6.4 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg>'
};
ICON.mck = ICON.subway; ICON.mcd = ICON.train; ICON.suburban = ICON.train;
ICON.tram = ICON.bus; ICON.trolleybus = ICON.bus;
// цвет пиктограммы: у метро фирменный красный, у остального серый, как в Яндексе
function modeIcon(mode){
  const col = mode === "subway" ? "#EF161E" : mode === "mck" ? "#D4222A" : "#6B6B6B";
  return `<span class="ym" style="color:${col}">${ICON[mode] || ICON.bus}</span>`;
}
// номер маршрута наземного транспорта берём из названия: «автобус 185» -> «185»
function refOfSurface(line){
  const m = String(line || "").match(/([0-9]+[А-Яа-яA-Za-z]?)\s*$/);
  return m ? m[1] : null;
}
function badgeOf(st){
  const ref = refOfLine(st.line, st.mode), c = stepColor(st);
  const label = st.mode === "subway" ? (ref || "М")
              : st.mode === "mcd" ? (ref || "МЦД")
              : st.mode === "mck" ? "МЦК"
              : st.mode === "suburban" ? "Э"
              : (refOfSurface(st.line) || SHORT[st.mode] || "?");
  return `${modeIcon(st.mode)}<span class="ybadge" style="background:${c}">${label}</span>`;
}
function chipsHTML(steps){
  const parts = [];
  for(const st of steps){
    if(st.k === "walk") parts.push(`<span class="t"><span class="ym" style="color:#6B6B6B">${ICON.walk}</span>${Math.round(st.t)} мин</span>`);
    else parts.push(badgeOf(st));
  }
  return parts.join('<span class="ar">▶</span>');
}
// одна строка ленты маршрута — как в карточке маршрута Яндекс.Карт
function rowHTML({gut = "", color = "", dot = "", walk = false, name = "", line = "", sec = "", mark = ""}){
  return `<div class="yrow${walk ? " walkrow" : ""}" style="--c:${color || "#D8D8D8"}">
    <span class="ygut">${gut}</span>
    <span class="ymark">${mark || (walk ? '<span class="ywalkdot"></span>' : `<span class="ydot ${dot}"></span>`)}</span>
    <div class="ybody">${name ? `<div class="yname">${name}</div>` : ""}
      ${line ? `<div class="yline">${line}</div>` : ""}
      ${sec ? `<div class="ysec">${sec}</div>` : ""}</div></div>`;
}
function routeForCell(i){
  const c = D.cells[i];
  curRoute = routeOf(c.id);
  if(!curRoute){
    $("cellroute").innerHTML = `<p class="muted">Из этой ячейки модель не нашла дороги на работу за три часа — это вода, лес или промзона без подходов.</p>`;
    return;
  }
  const r = curRoute, steps = r.steps;
  const mine = timeToWork(i);            // время до работы, которую выбрал человек
  const toMine = myWork >= 0 && myWork !== r.a;
  const a = D.anchors[toMine ? myWork : r.a];
  // откуда
  let rows = rowHTML({color: css("--accent"), dot: "", name: c.dn || "Эта ячейка",
                      sec: `${D.rings[c.r]}–${D.rings[c.r+1]} км от центра, ${SIDE[c.s]}`});
  steps.forEach(st => {
    if(st.k === "walk"){
      const where = st.to === "office" ? "до работы"
        : st.to ? (RAIL.includes(st.tomode) ? `до станции ${q(st.to)}` : `до остановки ${q(st.to)}`)
                : (RAIL.includes(st.tomode) ? "до станции" : "до остановки");
      rows += rowHTML({gut: `${Math.round(st.t)} мин`, walk: true, sec: `Пройти ${where}`,
                       mark: `<span class="ymw">${ICON.walk}</span>`});
      return;
    }
    const col = stepColor(st);
    const line = st.line.charAt(0).toUpperCase() + st.line.slice(1);
    const sec = [st.wait >= 0.1 ? `Подождать <b>${Math.max(1, Math.round(st.wait))} мин</b>` : "",
                 `${st.stops} ${plural(st.stops, "остановка", "остановки", "остановок")}` +
                 (st.to ? `, выход ${q(st.to)}` : "")].filter(Boolean).join("<br>");
    rows += rowHTML({gut: `${Math.round(st.t)} мин`, color: col, dot: "hollow",
                     name: st.from ? st.from : "Посадка",
                     line: `${badgeOf(st)}<span>${line}</span>`, sec});
  });
  const endAnchor = D.anchors[r.a];
  rows += rowHTML({color: "#1A1A1A", dot: "sq", name: aname(endAnchor),
                   sec: adesc(endAnchor)});

  // разовая поездка по «Тройке»: 75 рублей в центральной зоне, 102 в пригородной
  const far = c.r >= 4 || steps.some(st => st.mode === "suburban");
  const fare = far ? 102 : 75;
  const walkMin = Math.round(r.tw);
  const dests = (c.top || []).slice(0,3).map(([ai,p,tt]) =>
    `<div class="ydest"><span class="bul"></span><span>${aname(D.anchors[ai])}</span><span class="p">${fmt(p*100)}%</span><span class="p">${fmt(tt)} мин</span></div>`).join("");
  // если человек указал свою работу, главное число — время до неё
  if(toMine){
    // маршрут до чужого офиса показывать нельзя: это был бы не ваш маршрут
    curRoute = null;
    const dests = (c.top || []).slice(0,3).map(([ai,p,tt]) =>
      `<div class="ydest"><span class="bul"></span><span>${fixq(aname(D.anchors[ai]))}</span><span class="p">${fmt(p*100)}%</span><span class="p">${fmt(tt)} мин</span></div>`).join("");
    $("cellroute").innerHTML = `
      <p class="ysum"><span class="ytotal">${hhmm(mine)}</span><span class="yfrom">до вашей работы</span></p>
      <p class="ymeta">${fixq(c.dn || "эта ячейка")} — ${fixq(workLabel(myWork))}</p>
      <p class="substep">Пошагово этот маршрут не построен. По шагам посчитана дорога от каждой ячейки только до одного места работы — того, куда модель отправляет большинство её жителей. Время до вашего офиса настоящее, оно из полной матрицы на 771 922 пары.</p>
      ${dests ? `<p class="ynote">Чаще всего отсюда ездят в:</p><div class="ydests">${dests}</div>` : ""}`;
    draw();
    return;
  }
  const head = `<p class="ysum"><span class="ytotal">${hhmm(r.total)}</span><span class="yfrom">до самого частого места работы</span></p>
    <p class="ymeta">${fixq(c.dn || "Эта ячейка")} — ${aname(D.anchors[r.a])}. Среднее по всем местам работы — ${fmt(c.t)} мин.</p>`;
  $("cellroute").innerHTML = `
    ${head}
    <div class="ychips">${chipsHTML(steps)}</div>
    <p class="ymeta">Проезд ${fare} ₽, ${walkMin} мин пешком</p>
    <div class="ymix"><span><i style="background:var(--walk)"></i>пешком ${fmt(r.tw)} мин</span><span><i style="background:var(--sel)"></i>ожидание ${fmt(r.tq)} мин</span><span><i style="background:var(--jobs)"></i>в салоне ${fmt(r.tr)} мин</span></div>
    <div class="ysteps">${rows}</div>
    ${dests ? `<p class="ynote">Чаще всего отсюда ездят в:</p><div class="ydests">${dests}</div>` : ""}
    <p class="ynote">Маршрут посчитан по пешей сети OpenStreetMap и расписаниям метро, МЦК, МЦД, электричек и наземного транспорта. Показана дорога к тому месту работы, куда модель отправляет наибольшую долю жителей ячейки.</p>
    <p class="ynote">Проезд — разовая поездка по карте «Тройка», тариф «Кошелёк»: 75 ₽ в зоне «Центральная» и 102 ₽ в зоне «Пригород».</p>`;
}
function plural(n, one, few, many){
  const a = Math.abs(n) % 100, b = a % 10;
  if(a > 10 && a < 20) return many;
  if(b > 1 && b < 5) return few;
  if(b === 1) return one;
  return many;
}

new ResizeObserver(resize).observe(box);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", draw);
new MutationObserver(draw).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});
resize();
const ld = document.getElementById("loading"); if(ld) ld.remove();
})();
