/* Shared, closed design schema. No database value becomes a selector, URL, or CSS rule. */
(() => {
  'use strict';
  const colors = Object.freeze({pageBg:'Page background',sectionBg:'Section background',surface:'Card / surface background',textPrimary:'Primary text',textMuted:'Secondary / muted text',accent:'Pixelalty accent',border:'Border color'});
  const enums = Object.freeze({
    preset:['premium-hybrid','light','dark','custom'],
    header:['light','dark','hero'],footer:['light','dark'],cardStyle:['flat','outlined','elevated'],
    borderStrength:['soft','medium','strong'],shadow:['none','subtle','medium'],radius:['minimal','medium','rounded'],
    buttonStyle:['solid','outline','soft'],heroTreatment:['clean','glow','grid'],spacing:['compact','normal','spacious'],
    animation:['off','subtle','full'],logo:['auto','original','reversed'],font:['manrope','system','humanist','editorial']
  });
  const fonts = Object.freeze({manrope:'Manrope, Arial, sans-serif',system:'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',humanist:'"Trebuchet MS", Arial, sans-serif',editorial:'Georgia, "Times New Roman", serif'});
  const defaults = Object.freeze({schemaVersion:1,preset:'premium-hybrid',pageBg:'#F6F5F1',sectionBg:'#ECEDEA',surface:'#FFFFFF',textPrimary:'#141C2B',textMuted:'#566171',accent:'#2563CB',border:'#CDD2D9',header:'dark',footer:'dark',cardStyle:'outlined',borderStrength:'soft',shadow:'subtle',radius:'medium',buttonStyle:'solid',heroTreatment:'glow',spacing:'normal',animation:'subtle',logo:'auto',font:'manrope'});
  const presets = Object.freeze({
    'premium-hybrid':defaults,
    light:Object.freeze({...defaults,preset:'light',pageBg:'#FAFAF8',sectionBg:'#F0F1F3',header:'light',footer:'light',heroTreatment:'clean'}),
    dark:Object.freeze({...defaults,preset:'dark',pageBg:'#0B1018',sectionBg:'#121A27',surface:'#172131',textPrimary:'#F3F5FA',textMuted:'#B2BDCC',accent:'#84B2FF',border:'#43526A',header:'dark',footer:'dark'})
  });
  const luminance = color => {
    const channels = [1,3,5].map(i => parseInt(color.slice(i,i+2),16)/255).map(n => n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4);
    return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;
  };
  const contrast = (a,b) => (Math.max(luminance(a),luminance(b))+0.05)/(Math.min(luminance(a),luminance(b))+0.05);
  function validate(input) {
    const errors=[];
    if (!input || typeof input!=='object' || Array.isArray(input)) return {ok:false,errors:['Choose a complete appearance configuration.']};
    const keys=Object.keys(defaults);
    if (Object.keys(input).length!==keys.length || Object.keys(input).some(k=>!keys.includes(k)) || input.schemaVersion!==1) errors.push('This appearance format is not supported. Reload the editor.');
    const value={schemaVersion:1};
    for (const key of Object.keys(colors)) {
      if (typeof input[key]!=='string' || !/^#[0-9a-f]{6}$/i.test(input[key])) errors.push(colors[key]+' must be a six-digit hex color, for example #2563CB.');
      else value[key]=input[key].toUpperCase();
    }
    for (const [key,list] of Object.entries(enums)) {
      if (!list.includes(input[key])) errors.push('Choose a supported '+key+' option.');
      else value[key]=input[key];
    }
    if (errors.length) return {ok:false,errors};
    for (const ink of ['textPrimary','textMuted']) for (const bg of ['pageBg','sectionBg','surface']) {
      const ratio=contrast(value[ink],value[bg]);
      if (ratio<4.5) errors.push(`${colors[ink]} on ${colors[bg].toLowerCase()} is ${ratio.toFixed(2)}:1; at least 4.5:1 is required.`);
    }
    for (const bg of ['pageBg','sectionBg','surface']) if(contrast(value.accent,value[bg])<3) errors.push(`Accent on ${colors[bg].toLowerCase()} needs at least 3:1 contrast. Choose a stronger accent.`);
    return {ok:errors.length===0,value,errors};
  }
  const inkOn = bg => contrast('#FFFFFF',bg)>=4.5?'#FFFFFF':'#000000';
  function apply(input,root=document.documentElement) {
    const result=validate(input); if(!result.ok)return false;
    const c=result.value, dark=luminance(c.pageBg)<0.2;
    const accentInk=['pageBg','sectionBg','surface'].every(k=>contrast(c.accent,c[k])>=4.5)?c.accent:c.textPrimary;
    const lightHero=c.preset==='light' || (c.preset==='custom' && c.header==='light');
    const heroAccent=contrast(c.accent,'#0B1018')>=4.5?c.accent:'#8FBAFF';
    const values={
      '--page-bg':c.pageBg,'--surface':c.surface,'--surface-alt':c.sectionBg,'--text-primary':c.textPrimary,'--text-muted':c.textMuted,'--accent':c.accent,'--accent-ink':accentInk,'--on-accent':inkOn(c.accent),'--border':c.border,
      '--radius':{minimal:'2px',medium:'10px',rounded:'22px'}[c.radius],
      '--shadow':{none:'none',subtle:'0 8px 25px rgba(15,23,42,.06)',medium:'0 16px 44px rgba(15,23,42,.15)'}[c.shadow],
      '--card-border-width':{soft:'1px',medium:'2px',strong:'3px'}[c.borderStrength],
      '--section-space':{compact:'72px',normal:'110px',spacious:'144px'}[c.spacing],
      '--mobile-space':{compact:'44px',normal:'66px',spacious:'88px'}[c.spacing],
      '--font':fonts[c.font],'--error':dark?'#FFC1C1':'#9E1C2E','--success':dark?'#ADE7C8':'#17603D',
      '--control-border':c.textMuted
    };
    Object.assign(values,{'--hero-bg':lightHero?c.pageBg:'#0B1018','--hero-text':lightHero?c.textPrimary:'#F3F5FA','--hero-muted':lightHero?c.textMuted:'#B2BDCC','--hero-accent':lightHero?accentInk:heroAccent,'--hero-border':lightHero?c.border:'#46566D','--hero-button':lightHero?c.accent:heroAccent,'--hero-button-ink':inkOn(lightHero?c.accent:heroAccent)});
    // Suppress decorative overlays if they would weaken an otherwise valid palette.
    const overlay=c.heroTreatment==='grid'?'#8191AB':'#5173B5',opacity=c.heroTreatment==='grid'?0.19:0.13;
    const textured=Array.from({length:17},(_,i)=>'#'+[1,3,5].map(k=>Math.round(parseInt(values['--hero-bg'].slice(k,k+2),16)*(1-opacity*i/16)+parseInt(overlay.slice(k,k+2),16)*opacity*i/16).toString(16).padStart(2,'0')).join(''));
    root.dataset.heroPattern=textured.every(bg=>['--hero-text','--hero-muted','--hero-accent'].every(k=>contrast(values[k],bg)>=4.6))?'safe':'plain';
    for(const [key,value] of Object.entries(values))root.style.setProperty(key,value);
    for(const key of Object.keys(enums))root.dataset[key]=c[key];
    root.style.colorScheme=dark?'dark':'light';
    if(root===document.documentElement){document.querySelector('meta[name="theme-color"]')?.setAttribute('content',c.header==='light'?c.pageBg:'#0B1018');}
    return true;
  }
  const cacheKey='pixelalty-appearance-v1';
  function readCache() {
    try{
      const raw=localStorage.getItem(cacheKey);if(!raw || raw.length>6000)return null;
      const c=JSON.parse(raw);
      if(c.version!==1 || !Number.isSafeInteger(c.publishedVersion) || c.publishedVersion<1 || !Number.isFinite(c.savedAt) || c.savedAt>Date.now()+60000 || Date.now()-c.savedAt>86400000 || !validate(c.configuration).ok)return null;
      return c;
    }catch{return null;}
  }
  function remember(configuration,publishedVersion) {
    if(!validate(configuration).ok || !Number.isSafeInteger(publishedVersion) || publishedVersion<1)return;
    try{localStorage.setItem(cacheKey,JSON.stringify({version:1,savedAt:Date.now(),publishedVersion,configuration:validate(configuration).value}));}catch{/* Storage is optional. */}
  }
  function forget(){try{localStorage.removeItem(cacheKey);}catch{}}
  globalThis.PixelaltyAppearance=Object.freeze({colors,enums,fonts,defaults,presets,validate,contrast,apply,readCache,remember,forget,cacheKey});
  // A small synchronous local script runs before CSS; never hide the page while loading.
  if(typeof document!=='undefined')apply(document.documentElement.dataset.admin==='true'?defaults:(readCache()?.configuration||defaults));
})();
