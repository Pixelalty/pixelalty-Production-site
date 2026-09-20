import {element} from './api.js';
const theme=window.PixelaltyAppearance;
const labels={preset:'Theme preset',header:'Header theme',footer:'Footer theme',cardStyle:'Card style',borderStrength:'Card border strength',shadow:'Shadow strength',radius:'Border radius',buttonStyle:'Button style',heroTreatment:'Hero visual treatment',spacing:'Section spacing',animation:'Animation level',logo:'Logo variant',font:'Typography'};
const optionLabels={'premium-hybrid':'Premium Hybrid',hero:'Transparent / Hero',auto:'Automatic contrast',original:'Original dark lettering',reversed:'Reversed light lettering',manrope:'Manrope · supplied local font',system:'System sans · device font',humanist:'Humanist · Trebuchet / Arial',editorial:'Editorial · Georgia',glow:'Soft light',grid:'Architectural grid',clean:'Clean'};
const title=x=>optionLabels[x]||x[0].toUpperCase()+x.slice(1);
export function createAppearanceEditor({getClient,ensureAdmin,onAuthError}) {
  const $=s=>document.querySelector(s),panel=$('[data-admin-panel="appearance"]');
  let saved=null,current={...theme.defaults},dirty=false,busy=false,generation=0,conflict=false,previewRoot=null;
  const inputs=new Map();
  function message(text='',error=false){$('#appearance-status').textContent=text;$('#appearance-status').className='form-status '+(error?'error':'success');}
  function group(name,description){const node=element('section','appearance-control-group');node.append(element('h3','',name));if(description)node.append(element('p','small',description));$('#appearance-options').append(node);return node;}
  function select(key,parent){
    const label=element('label','field',labels[key]),input=element('select');input.name=key;input.id='appearance-'+key;
    for(const value of theme.enums[key]){const option=element('option','',title(value));option.value=value;input.append(option);}
    label.append(input);parent.append(label);inputs.set(key,input);
    input.addEventListener('change',()=>{
      if(key==='preset' && input.value!=='custom')current={...theme.presets[input.value]};
      else {current[key]=input.value;if(key!=='preset')current.preset='custom';}
      dirty=true;fill();render();
    });
  }
  select('preset',group('The starting point','Premium Hybrid pairs a dark introduction with warm, light content. Customize any detail.'));
  const colorGroup=group('Your palette','Text must reach 4.5:1 on every content surface. Six-digit hex colors only.');
  for(const [key,labelText]of Object.entries(theme.colors)){
    const row=element('div','appearance-color'),label=element('label','',labelText);label.htmlFor='appearance-'+key;
    const pair=element('div','appearance-color-pair'),swatch=element('input'),hex=element('input');
    swatch.type='color';swatch.setAttribute('aria-label',labelText+' picker');swatch.dataset.color=key;
    hex.type='text';hex.id='appearance-'+key;hex.name=key;hex.maxLength=7;hex.autocomplete='off';hex.spellcheck=false;hex.pattern='#[0-9a-fA-F]{6}';hex.setAttribute('aria-describedby','appearance-validation');
    pair.append(swatch,hex);row.append(label,pair);colorGroup.append(row);inputs.set(key,hex);
    const change=value=>{current[key]=value;current.preset='custom';inputs.get('preset').value='custom';dirty=true;render();};
    swatch.addEventListener('input',()=>{hex.value=swatch.value.toUpperCase();change(hex.value);});
    hex.addEventListener('input',()=>{if(/^#[0-9a-f]{6}$/i.test(hex.value))swatch.value=hex.value;change(hex.value);});
  }
  colorGroup.append($('#appearance-validation'));
  const structure=group('Shape & depth');for(const key of ['cardStyle','borderStrength','shadow','radius','buttonStyle'])select(key,structure);
  const sections=group('Page rhythm');for(const key of ['header','footer','heroTreatment','spacing','animation'])select(key,sections);
  const identity=group('Brand & typography','Only supplied artwork and trusted local or device fonts. Explicit logo variants receive a contrast-safe backing where needed.');for(const key of ['logo','font'])select(key,identity);
  function fill(){for(const [key,input]of inputs){input.value=current[key];const swatch=panel.querySelector('[data-color="'+key+'"]');if(swatch && /^#[0-9a-f]{6}$/i.test(current[key]))swatch.value=current[key];}}
  function mountPreview(){
    if(previewRoot)return;
    const shadow=$('#appearance-preview-canvas').attachShadow({mode:'open'});
    for(const href of ['styles.css','appearance-preview.css']){const link=document.createElement('link');link.rel='stylesheet';link.href=href;shadow.append(link);}
    shadow.append($('#appearance-preview-template').content.cloneNode(true));previewRoot=shadow.querySelector('.appearance-preview-site');
    shadow.addEventListener('click',event=>{if(event.target.closest('a,button'))event.preventDefault();});
  }
  function render(){
    const checked=theme.validate(current);const validation=$('#appearance-validation');validation.replaceChildren();
    validation.classList.toggle('invalid',!checked.ok);
    if(checked.ok){validation.append(element('strong','','Contrast checks passed'),element('p','small','Both text colors meet WCAG AA across your page, sections, and cards.'));
      if(previewRoot)theme.apply(checked.value,previewRoot);
    }else{validation.append(element('strong','','Adjust your palette to continue'));for(const text of checked.errors)validation.append(element('p','small',text));}
    $('#appearance-state').textContent=!saved?'Appearance unavailable':conflict?'Newer changes available':dirty?'Unsaved changes':!saved.published && !saved.draft?'Built-in default':saved.draft && JSON.stringify(saved.draft)!==JSON.stringify(saved.published)?'Draft saved':'Published design';
    $('#appearance-fields').disabled=busy||!saved;
    for(const id of ['save','publish'])$('#appearance-'+id).disabled=busy||!saved||conflict||!checked.ok;
    for(const id of ['preview','revert'])$('#appearance-'+id).disabled=busy||!saved;
    $('#appearance-reload').disabled=busy;
    $('#appearance-history').disabled=busy||!saved;
    $('#appearance-restore').disabled=busy||!saved||conflict||!$('#appearance-history').value;
  }
  function accept(data){
    if(!data || !Number.isSafeInteger(data.revision) || !Number.isSafeInteger(data.publishedVersion) || (data.draft && !theme.validate(data.draft).ok) || (data.published && !theme.validate(data.published).ok))throw new Error('APPEARANCE_INVALID_RESPONSE');
    saved=data;current={...(data.draft||data.published||theme.defaults)};dirty=false;conflict=false;fill();
    const history=$('#appearance-history');history.replaceChildren();
    const placeholder=element('option','','Choose a previous version');placeholder.value='';history.append(placeholder);
    for(const item of (Array.isArray(data.history)?data.history:[]))if(Number.isSafeInteger(item.version) && item.version<data.publishedVersion){
      const when=new Date(item.publishedAt);const option=element('option','',`Version ${item.version} · ${title(item.preset||'custom')} · ${Number.isNaN(when.valueOf())?'':when.toLocaleString()}`);option.value=String(item.version);history.append(option);
    }
    render();
  }
  async function run(name,args,success){
    if(busy)return;busy=true;const turn=generation;render();message('Connecting securely…');
    try{
      await ensureAdmin();if(turn!==generation)return;
      const {data,error}=await getClient().rpc(name,args);if(turn!==generation)return;if(error)throw error;
      accept(data);if(name==='publish_appearance')theme.remember(data.published,data.publishedVersion);message(success);
    }catch(error){
      if(turn!==generation)return;
      if(error.message==='AUTH'||error.code==='42501'||error.status===401||error.status===403){await onAuthError(error);return;}
      if(error.message==='APPEARANCE_CONFLICT'){conflict=true;message('A newer revision was saved in another tab. Your preview is preserved. Reload saved settings before saving again.',true);}
      else if(error.message==='APPEARANCE_INVALID')message('The database rejected these settings. Check contrast and supported values, then try again.',true);
      else if(error.code==='PGRST202')message('Appearance is not installed yet. Run supabase/ADD_APPEARANCE_EDITOR.sql once, then Reload saved settings. Your existing dashboard is unaffected.',true);
      else message('The appearance change could not be confirmed. Your preview is preserved. Reload saved settings to check the server before retrying.',true);
    }finally{if(turn===generation){busy=false;render();}}
  }
  $('#appearance-form').addEventListener('submit',e=>e.preventDefault());
  $('#appearance-save').addEventListener('click',()=>{const v=theme.validate(current);if(saved && v.ok)run('save_appearance_draft',{p_configuration:v.value,p_expected_revision:saved.revision},'Draft saved. The public website has not changed.');});
  $('#appearance-publish').addEventListener('click',()=>{
    if(!saved || !theme.validate(current).ok)return;
    $('#appearance-confirm-summary').textContent=`${title(current.preset)} · ${title(current.font)} · ${title(current.spacing)} spacing. Visitors will receive this version on their next load or refresh within about a minute.`;
    $('#appearance-publish-dialog').showModal();$('#appearance-cancel').focus();
  });
  $('#appearance-cancel').addEventListener('click',()=>$('#appearance-publish-dialog').close());
  $('#appearance-confirm').addEventListener('click',()=>{const v=theme.validate(current);$('#appearance-publish-dialog').close();if(saved && v.ok)run('publish_appearance',{p_configuration:v.value,p_expected_revision:saved.revision},'Published. Your new design is now available across the public website.');});
  $('#appearance-revert').addEventListener('click',()=>{if(saved && window.confirm('Discard your draft and return to the current published design?'))run('revert_appearance_draft',{p_expected_revision:saved.revision},'Draft reverted to the published design.');});
  $('#appearance-history').addEventListener('change',render);
  $('#appearance-restore').addEventListener('click',()=>{const version=Number($('#appearance-history').value);if(saved && version>0 && window.confirm('Replace your draft with version '+version+'? The public website will stay unchanged until you publish.'))run('restore_appearance_version',{p_version:version,p_expected_revision:saved.revision},'Previous version restored into your draft. Preview it before publishing.');});
  $('#appearance-reload').addEventListener('click',()=>{if(!dirty || window.confirm('Replace your unsaved preview with the latest saved settings?'))run('get_appearance_editor',{},'Latest saved appearance loaded.');});
  $('#appearance-preview').addEventListener('click',()=>{if(!saved)return;$('#appearance-expanded-mount').append($('#appearance-preview-viewport'));$('#appearance-preview-dialog').showModal();});
  $('#appearance-close-preview').addEventListener('click',()=>$('#appearance-preview-dialog').close());
  $('#appearance-preview-dialog').addEventListener('close',()=>$('#appearance-preview-home').append($('#appearance-preview-viewport')));
  $('#appearance-viewport').addEventListener('change',()=>{$('#appearance-preview-viewport').dataset.viewport=$('#appearance-viewport').value;});
  window.addEventListener('beforeunload',event=>{if(dirty && saved){event.preventDefault();event.returnValue='';}});
  return {
    async open(){mountPreview();if(!saved)await run('get_appearance_editor',{},'Your changes stay private until you publish.');else render();},
    reset(){generation++;saved=null;dirty=false;busy=false;conflict=false;current={...theme.defaults};for(const id of ['appearance-publish-dialog','appearance-preview-dialog'])$(('#'+id)).close();$('#appearance-history').replaceChildren();fill();message();render();}
  };
}
