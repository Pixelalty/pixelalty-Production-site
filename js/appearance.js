import { configured, rpc } from './api.js';
const theme=window.PixelaltyAppearance;
if(theme && document.documentElement.dataset.admin!=='true') {
  let pending=false,lastAttempt=0;
  async function refresh(){
    if(pending || !configured())return;
    pending=true;lastAttempt=Date.now();
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
    try{
      const published=await rpc('get_published_appearance',{},controller.signal);
      if(published===null){theme.forget();theme.apply(theme.defaults);}
      else if(Number.isSafeInteger(published.publishedVersion) && published.publishedVersion>0 && theme.validate(published.configuration).ok){
        theme.apply(published.configuration);theme.remember(published.configuration,published.publishedVersion);
      }
    }catch{/* Keep the validated last published theme, or the CSS default, on every failure. */}
    finally{clearTimeout(timer);pending=false;}
  }
  refresh();
  document.addEventListener('visibilitychange',()=>{if(!document.hidden && Date.now()-lastAttempt>15000)refresh();});
  setInterval(()=>{if(!document.hidden)refresh();},60000);
  window.addEventListener('storage',event=>{if(event.key===theme.cacheKey)refresh();});
}
