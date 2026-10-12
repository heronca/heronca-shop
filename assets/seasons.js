const SEASONS = {
  spring: {"name": "Spring", "ids": ["7X2KLZWN2OLATZCAFZ72C4BS", "7EQCZ35SYUFJF23WCMIJX4T6", "XZXICNNOSFTS355IMBZ3QBVS", "FEINS232VQ2UU6PGBYQRDPFJ", "3OGYQJS4343APKR3PSLF6RIE", "6WOGBOGGZE6GLUBYMFUELW5E", "NMSEL7KSJL7UHLS2BEIWOXB6", "2V7VRLGARJQSQZSUOQZIRUAR", "6HXAPCX5SDS5UW64MBUXYJIC", "RKRRCIL2GGAD2UR64C4QBWEB", "DR2B7YXU766OXGT4CSMLOZRX", "A7D3YTGG23YEGVRVH2U2MIYV"]},
  summer: {"name": "Summer", "ids": ["OG7X2S7D4C7LN3A4YKTCXP5S", "BJXP2JJDUAQOV7MDYB5CQ2DR", "JEAAXFTXYYWQQ3KK4H7D5UUH", "AM5OJIEWBQMOHTUQFUMQISJV", "WLE7VPMVZGLO53HU7PNGHMXI", "KXLGA2T7ICM5RL2WBTSRAMPM", "NEYZQH3H64KRHRF7PMNZFBQV", "2SHXAUCAKXVJ5EA4YU5W23MB", "4ZOZ3IJSZPFTDA7SIKYGIWMM", "NWMSNER2NPVIQHZMHDDWTADN", "7PPTKP5F4TGWOHCX2KOTVORU", "DQQJKQNUAS2A3DNEF5MFJZXA", "2BTYYRIBYE7CBBTQFR6ORF5J", "M2C574CARJSHS3HO2LV55U4E"]},
  fall: {"name": "Fall", "ids": ["2RWKOSSXE5TY6KLYFO5ZU6VP", "3OAQCADZEFG5D44EN2VFZY3R", "HAJW6M35QNKMBBSCNO5KMKH2", "DZRR77ZI2FSYTYEUZGJB3YMA", "4JUM47X2KIYSMUQS323WPYWW", "HK6QTFRYGQFXB6HKLNFRS3NW", "26TQ2DXIQL5D4YDTQEAFLQEZ", "LMGZYOHKJAXXRU4DQH4KPTYE", "MX3MGQPBDYVRZUJ4AKLRNDDJ", "5TNGHLZVEVPKJHTYSQCLVLS3", "2ARW3B2CRCR6FC2HFRAKSNHI", "RTCKTNBF3UKFK5YVVJXQYVOF", "A2DBNJ53ZSFHKRXHN2OBWK25", "JVEUNLV2C54QDZSO2WKQHDHD"]},
  winter: {"name": "Winter", "ids": ["RXJFGENML2XC5O33SYEHEUI5", "TEJ5QN2IJMR4SOWLLTLD7K2J", "M2ZZNGBZK645KOVYIKLZ3NKS", "BX42FNWT3SL4KBYJTNR5HIHD", "OONOI3HJAQ4STTF5JPQ4SCXT", "JP5FZNRXTECDIPK76HVJYHG4", "KC5FP2VNTXQBKIFZ25OF6KOB", "BM7BBMHIGVC7LAME2PTWTW4H", "ZX3NFNU6K24TKJN6OM5XP7SS", "KOKDNUZMCEOCXUSBLAC2ZPEF", "2ZPCUIKWG3KQV664X6IFOAZP", "GFNRD77ABOSOWOE6BBTONBIU", "L3WFWQB6XFF3JGGCZBRLD4CF", "AGSS3QWZ5PTLJNNMU4JDM52A"]}
};
chrome();
const q = new URLSearchParams(location.search);
let season = Object.hasOwn(SEASONS,q.get('season')) ? q.get('season') : 'all';
let allItems=[];
const cat=q.get('c')||'';
const band=q.get('p')||'';
const BANDS=[['','Any price'],['u25','Under $25'],['25-50','$25 to $50'],['50-100','$50 to $100'],['100','$100 and up']];
const inBand=c=>!band||(band==='u25'?c<2500:band==='25-50'?c>=2500&&c<5000:band==='50-100'?c>=5000&&c<10000:c>=10000);
const findItem=id=>allItems.find(x=>x.id===id&&!x.sold);
let rackObserver;
let discount=20;
function renderProducts(list) {
 rackObserver?.disconnect();
 const grid=$('#grid'), more=$('#rackMore'), progress=$('#rackProgress');
 grid.innerHTML='';more.hidden=true;
 if(!list.length){grid.innerHTML='<p class="empty">No pieces at this price right now. Try another price or season.</p>';return;}
 let shown=0;
 function loadNext(){
  if(shown>=list.length)return;
  const next=list.slice(shown,shown+20);
  grid.insertAdjacentHTML('beforeend',next.map(card).join(''));
  shown+=next.length;
  progress.textContent=`${shown} of ${list.length} pieces shown`;
  more.hidden=shown>=list.length;
  $('#loadMore').textContent=`Load ${Math.min(20,list.length-shown)} more pieces`;
  if(more.hidden)rackObserver?.disconnect();
 }
 $('#loadMore').onclick=loadNext;
 loadNext();
 if(!more.hidden&&'IntersectionObserver' in window){
  rackObserver=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))loadNext();},{rootMargin:'320px 0px'});
  rackObserver.observe(more);
 }
}
function renderRack(){
 const s=SEASONS[season];
 document.querySelectorAll('[data-season]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.season===season)));
 const selected=cat?allItems.filter(x=>x.category===cat):s?s.ids.map(findItem).filter(Boolean):allItems;
 const list=selected.filter(x=>inBand(x.site_price));
 $('#title').textContent=cat||(s?`${s.name} collection`:'New arrivals');
 $('#count').textContent=`${list.filter(x=>!x.sold).length} pieces · ${discount}% off online, multi-buy deals in your bag`;
 renderProducts(list);
 const params=new URLSearchParams(location.search);
 season==='all'?params.delete('season'):params.set('season',season);
 $('#bands').innerHTML=BANDS.map(([v,l])=>{const p=new URLSearchParams(params);v?p.set('p',v):p.delete('p');return `<a class="chip${v===band?' on':''}" href="?${p}#rack">${l}</a>`;}).join('');
}
if(cat){$('#hero').hidden=true;$('.collection-picker').hidden=true;}
shop().then(s=>{allItems=s.items;discount=s.discount;renderRack();}).catch(()=>{$('#grid').innerHTML='<p class="empty">The rack could not load. Please refresh to try again.</p>';});
document.querySelectorAll('[data-season]').forEach(button=>button.addEventListener('click',()=>{
 season=button.dataset.season;
 const params=new URLSearchParams(location.search);params.delete('collection');season==='all'?params.delete('season'):params.set('season',season);
 history.pushState(null,'',`?${params}`);renderRack();
}));
window.addEventListener('popstate',()=>{const p=new URLSearchParams(location.search);if(p.get('c')!==q.get('c')||p.get('p')!==q.get('p')){location.reload();return;}season=Object.hasOwn(SEASONS,p.get('season'))?p.get('season'):'all';renderRack();});
