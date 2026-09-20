import { configured, getAdminClient, element, serviceNames, dateLabel } from './api.js';
import { createAppearanceEditor } from './appearance-admin.js';
const $ = selector => document.querySelector(selector);
const status = $('#admin-status');
const login = $('#login-form');
const mfaForm = $('#mfa-form');
let client, factorId, busy = false, reviewStatus = 'pending', inquiryStatus = 'new', reviewOffset = 0, inquiryOffset = 0;
let reviewGeneration = 0, inquiryGeneration = 0, lastActivity = Date.now();
const PAGE = 20;
const appearance = createAppearanceEditor({getClient:()=>client,ensureAdmin,onAuthError:()=>handleError(new Error('AUTH'),'Please verify your session again.')});
function notice(text = '', type = '') { status.textContent = text; status.className = 'form-status ' + type; }
function activeButtons(selector, chosen) {
  document.querySelectorAll(selector).forEach(button => { const active = button === chosen; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
}
function clearPrivateUI() {
  appearance.reset();
  $('#dashboard').hidden = true;
  $('#mfa-panel').hidden = true;
  $('#sign-out').hidden = true;
  $('#auth-panel').hidden = false;
  $('#admin-reviews').replaceChildren(); $('#admin-inquiries').replaceChildren();
  $('#account-email').textContent = ''; $('#mfa-secret').textContent = ''; $('#mfa-qr').removeAttribute('src');
  $('#mfa-enrollment').hidden = true; mfaForm.reset();
  ['pending','approved','inquiries'].forEach(name => { $('#metric-' + name).textContent = '—'; });
  factorId = null; reviewGeneration++; inquiryGeneration++;
}
async function signOut(message = 'You have signed out.') {
  clearPrivateUI(); login.reset(); notice(message);
  try { await client?.auth.signOut({scope:'local'}); } catch { sessionStorage.removeItem('pixelalty-admin-auth'); }
}
async function ensureAdmin() {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error('AUTH');
  const [role, assurance] = await Promise.all([client.rpc('admin_identity'), client.auth.mfa.getAuthenticatorAssuranceLevel()]);
  if (role.error || role.data !== true || assurance.error || assurance.data.currentLevel !== 'aal2') throw new Error('AUTH');
  return data.user;
}
async function gate() {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) { clearPrivateUI(); return; }
  const role = await client.rpc('admin_identity');
  if (role.error || role.data !== true) { await signOut('This account cannot access the dashboard. Check the administrator setup.'); return; }
  $('#auth-panel').hidden = true; $('#sign-out').hidden = false;
  const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.error) throw new Error('AUTH');
  if (assurance.data.currentLevel === 'aal2') { await openDashboard(); return; }
  $('#dashboard').hidden = true; $('#mfa-panel').hidden = false;
  const listed = await client.auth.mfa.listFactors();
  if (listed.error) throw new Error('MFA');
  const verified = listed.data.totp.find(f => f.status === 'verified');
  if (verified) {
    factorId = verified.id; $('#mfa-title').textContent = 'Verify your sign in';
    $('#mfa-instructions').textContent = 'Enter the current six-digit code from your authenticator app.';
    $('#mfa-enrollment').hidden = true;
  } else {
    // Remove incomplete factors from abandoned setup attempts before making one.
    for (const factor of (listed.data.all || [])) {
      if (factor.factor_type === 'totp' && factor.status === 'unverified') await client.auth.mfa.unenroll({factorId:factor.id});
    }
    const enrolled = await client.auth.mfa.enroll({factorType:'totp',friendlyName:'Pixelalty administrator',issuer:'Pixelalty'});
    if (enrolled.error) throw new Error('MFA');
    factorId = enrolled.data.id;
    const qr = enrolled.data.totp.qr_code;
    if (qr.startsWith('data:image/svg+xml')) $('#mfa-qr').src = qr;
    else if (/^<svg[\s>]/.test(qr)) $('#mfa-qr').src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(qr);
    else throw new Error('MFA');
    $('#mfa-secret').textContent = enrolled.data.totp.secret;
    $('#mfa-title').textContent = 'Set up two-factor authentication';
    $('#mfa-instructions').textContent = 'Add this account to your authenticator, then enter its current code. Private data stays locked until verification succeeds.';
    $('#mfa-enrollment').hidden = false;
  }
  mfaForm.elements.code.focus(); notice();
}
async function openDashboard() {
  const user = await ensureAdmin();
  $('#auth-panel').hidden = true; $('#mfa-panel').hidden = true; $('#dashboard').hidden = false; $('#sign-out').hidden = false;
  $('#mfa-secret').textContent = ''; $('#mfa-qr').removeAttribute('src'); mfaForm.reset();
  $('#account-email').textContent = user.email || '';
  notice(); lastActivity = Date.now();
  document.querySelectorAll('[data-admin-panel]').forEach(p => { p.hidden = p.dataset.adminPanel !== 'overview'; });
  activeButtons('[data-panel]', $('[data-panel="overview"]'));
  await overview();
}
async function handleError(error, message) {
  if (error.message === 'AUTH' || error.status === 401 || error.status === 403) await signOut('Your session needs to be verified again. Please sign in.');
  else notice(message, 'error');
}
async function overview() {
  try {
    await ensureAdmin();
    const results = await Promise.all([
      client.from('reviews').select('id',{count:'exact',head:true}).eq('status','pending'),
      client.from('reviews').select('id',{count:'exact',head:true}).eq('status','approved'),
      client.from('contact_inquiries').select('id',{count:'exact',head:true}).eq('status','new')
    ]);
    if (results.some(r => r.error)) throw new Error('LOAD');
    ['pending','approved','inquiries'].forEach((name,i) => { $('#metric-'+name).textContent = String(results[i].count ?? 0); });
  } catch (error) { await handleError(error, 'Dashboard numbers could not be loaded. Check your connection and try Refresh.'); }
}
function action(label, callback, danger = false) {
  const button = element('button', danger ? 'danger' : '', label); button.type = 'button';
  button.addEventListener('click', async () => {
    button.disabled = true;
    try { await ensureAdmin(); await callback(); }
    catch (error) { await handleError(error, 'The change could not be saved. Refresh the list, check your connection, and try again.'); }
    finally { button.disabled = false; }
  });
  return button;
}
async function updateReview(id, fields) {
  const { error } = await client.from('reviews').update(fields).eq('id',id).select('id').single();
  if (error) throw error;
  notice('Review updated.', 'success'); await loadReviews(true);
}
function reviewRecord(review) {
  const item = element('article','admin-record');
  item.append(element('h3','',review.display_name),element('p','record-meta',`${review.email} · ${review.business_name || 'No business name'} · ${serviceNames[review.service_type] || review.service_type} · ${dateLabel(review.created_at)}`));
  item.append(element('p','review-stars',`${review.rating} / 5 stars`));
  if (review.title) item.append(element('h4','',review.title));
  item.append(element('p','review-body',review.body));
  if (review.order_reference) item.append(element('p','record-meta','Order/reference: '+review.order_reference));
  item.append(element('p','status-badge',review.status));
  if (review.is_verified_customer) item.append(element('p','status-badge','Verified Customer'));
  if (review.is_featured) item.append(element('p','status-badge','Featured on homepage'));
  if (review.moderation_reason) item.append(element('p','record-meta','Private moderation reason: '+review.moderation_reason));
  const controls = element('div','admin-actions');
  if (review.status !== 'approved') controls.append(action('Approve', () => updateReview(review.id,{status:'approved',moderation_reason:''})));
  if (review.status !== 'hidden') controls.append(action('Hide', async () => {
    const reason = window.prompt('Reason for hiding (spam, privacy, irrelevant content, or another legitimate issue). Do not hide a review because it is negative. Minimum 8 characters.');
    if (reason === null) return;
    if (reason.trim().length < 8 || reason.trim().length > 500) { notice('Please provide a moderation reason between 8 and 500 characters.','error'); return; }
    await updateReview(review.id,{status:'hidden',is_featured:false,moderation_reason:reason.trim()});
  }));
  controls.append(action(review.is_verified_customer ? 'Remove verification' : 'Mark Verified Customer', async () => {
    if (!review.is_verified_customer && !window.confirm('Have you matched this reviewer to actual customer business records?')) return;
    await updateReview(review.id,{is_verified_customer:!review.is_verified_customer});
  }));
  if (review.status === 'approved') controls.append(action(review.is_featured ? 'Unfeature' : 'Feature on homepage', () => updateReview(review.id,{is_featured:!review.is_featured})));
  controls.append(action('Delete', async () => {
    if (!window.confirm('Permanently delete this review? Use this only for a legitimate moderation or customer-removal request. This cannot be undone.')) return;
    const { error } = await client.from('reviews').delete().eq('id',review.id).select('id').single();
    if (error) throw error;
    notice('Review deleted.','success'); await loadReviews(true);
  }, true));
  item.append(controls);
  const label = element('label','field','Pixelalty response (public)');
  const textarea = document.createElement('textarea'); textarea.maxLength = 2000; textarea.rows = 3; textarea.value = review.admin_response || ''; label.append(textarea); item.append(label);
  const responseControls = element('div','admin-actions');
  responseControls.append(action('Save response', () => updateReview(review.id,{admin_response:textarea.value.trim()})));
  item.append(responseControls);
  return item;
}
async function loadReviews(reset = true) {
  const current = ++reviewGeneration;
  if (reset) { reviewOffset = 0; $('#admin-reviews').replaceChildren(element('p','empty-state','Loading reviews…')); }
  $('#more-admin-reviews').hidden = true;
  try {
    await ensureAdmin();
    const { data, error } = await client.from('reviews').select('id,display_name,email,business_name,service_type,rating,title,body,order_reference,status,is_verified_customer,is_featured,admin_response,moderation_reason,created_at').eq('status',reviewStatus).order('created_at',{ascending:false}).order('id',{ascending:false}).range(reviewOffset,reviewOffset+PAGE-1);
    if (current !== reviewGeneration) return;
    if (error) throw error;
    if (reset) $('#admin-reviews').replaceChildren();
    if (!data.length && !reviewOffset) $('#admin-reviews').append(element('p','empty-state',`No ${reviewStatus === 'approved' ? 'published' : reviewStatus} reviews.`));
    data.forEach(r => $('#admin-reviews').append(reviewRecord(r))); reviewOffset += data.length;
    $('#more-admin-reviews').hidden = data.length < PAGE;
  } catch (error) { if (current === reviewGeneration) { if(reset) $('#admin-reviews').replaceChildren(element('p','empty-state','Reviews could not be loaded. Select a status to retry.')); await handleError(error,'Reviews could not be loaded.'); } }
}
function inquiryRecord(inquiry) {
  const item = element('article','admin-record');
  item.append(element('h3','',inquiry.name), element('p','record-meta',`${inquiry.email} · ${inquiry.business_name || 'No business name'} · ${serviceNames[inquiry.service_interest] || inquiry.service_interest} · ${dateLabel(inquiry.created_at)}`), element('p','',inquiry.message));
  const labels = {page_count:'Approximate pages',product_count:'Products',booking:'Booking',integrations:'Integrations',functionality:'Other functionality'};
  for (const [key, label] of Object.entries(labels)) {
    if (inquiry.scope_details?.[key]) item.append(element('p','record-meta',label+': '+inquiry.scope_details[key]));
  }
  item.append(element('p','status-badge',inquiry.status));
  const controls = element('div','admin-actions');
  for (const [next,label] of [['new','Mark new'],['read','Mark read'],['archived','Archive']]) {
    if (inquiry.status === next) continue;
    controls.append(action(label,async () => {
      const { error } = await client.from('contact_inquiries').update({status:next}).eq('id',inquiry.id).select('id').single();
      if (error) throw error; notice('Inquiry updated.','success'); await loadInquiries(true);
    }));
  }
  controls.append(action('Delete',async () => {
    if (!window.confirm('Permanently delete this inquiry? This cannot be undone.')) return;
    const { error } = await client.from('contact_inquiries').delete().eq('id',inquiry.id).select('id').single();
    if (error) throw error; notice('Inquiry deleted.','success'); await loadInquiries(true);
  },true));
  item.append(controls); return item;
}
async function loadInquiries(reset = true) {
  const current = ++inquiryGeneration;
  if (reset) { inquiryOffset=0; $('#admin-inquiries').replaceChildren(element('p','empty-state','Loading inquiries…')); }
  $('#more-admin-inquiries').hidden=true;
  try {
    await ensureAdmin();
    const { data,error } = await client.from('contact_inquiries').select('id,name,email,business_name,service_interest,message,scope_details,status,created_at').eq('status',inquiryStatus).order('created_at',{ascending:false}).order('id',{ascending:false}).range(inquiryOffset,inquiryOffset+PAGE-1);
    if (current !== inquiryGeneration) return;
    if (error) throw error;
    if (reset) $('#admin-inquiries').replaceChildren();
    if (!data.length && !inquiryOffset) $('#admin-inquiries').append(element('p','empty-state',`No ${inquiryStatus} inquiries.`));
    data.forEach(r => $('#admin-inquiries').append(inquiryRecord(r))); inquiryOffset+=data.length;
    $('#more-admin-inquiries').hidden=data.length<PAGE;
  } catch(error) { if(current===inquiryGeneration) { if(reset) $('#admin-inquiries').replaceChildren(element('p','empty-state','Inquiries could not be loaded. Select a status to retry.')); await handleError(error,'Inquiries could not be loaded.'); } }
}
login.addEventListener('submit',async e => {
  e.preventDefault(); if(busy || !login.reportValidity())return;
  busy=true; login.querySelector('button').disabled=true; notice('Signing in…');
  try {
    const { error } = await client.auth.signInWithPassword({email:login.elements.email.value.trim(),password:login.elements.password.value});
    login.elements.password.value='';
    if(error) { notice('Sign-in could not be completed. Check your details and try again.','error');return; }
    await gate();
  } catch { notice('Sign-in is temporarily unavailable. Please check your connection and administrator setup.','error'); }
  finally {busy=false;login.querySelector('button').disabled=false;}
});
mfaForm.addEventListener('submit',async e => {
  e.preventDefault(); if(busy || !factorId || !mfaForm.reportValidity())return;
  busy=true;mfaForm.querySelector('button').disabled=true;notice('Verifying…');
  try {
    const {error}=await client.auth.mfa.challengeAndVerify({factorId,code:mfaForm.elements.code.value.trim()});
    mfaForm.elements.code.value='';
    if(error){notice('That code could not be verified. Try the current code from your authenticator.','error');return;}
    await openDashboard();
  }catch{notice('Verification could not be completed. Please try again.','error');}
  finally{busy=false;mfaForm.querySelector('button').disabled=false;}
});
$('#sign-out').addEventListener('click',()=>signOut());
$('#refresh-overview').addEventListener('click',()=>overview());
document.querySelectorAll('[data-panel]').forEach(button=>button.addEventListener('click',async()=>{
  activeButtons('[data-panel]',button); notice();
  document.querySelectorAll('[data-admin-panel]').forEach(panel=>{panel.hidden=panel.dataset.adminPanel!==button.dataset.panel;});
  if(button.dataset.panel==='overview')await overview();
  if(button.dataset.panel==='reviews')await loadReviews(true);
  if(button.dataset.panel==='inquiries')await loadInquiries(true);
  if(button.dataset.panel==='appearance')await appearance.open();
}));
document.querySelectorAll('[data-review-status]').forEach(button=>button.addEventListener('click',()=>{reviewStatus=button.dataset.reviewStatus;activeButtons('[data-review-status]',button);loadReviews(true);}));
document.querySelectorAll('[data-inquiry-status]').forEach(button=>button.addEventListener('click',()=>{inquiryStatus=button.dataset.inquiryStatus;activeButtons('[data-inquiry-status]',button);loadInquiries(true);}));
$('#more-admin-reviews').addEventListener('click',()=>loadReviews(false));
$('#more-admin-inquiries').addEventListener('click',()=>loadInquiries(false));
for(const event of ['pointerdown','keydown','scroll'])window.addEventListener(event,()=>{lastActivity=Date.now();},{passive:true});
setInterval(()=>{if(!$('#sign-out').hidden && Date.now()-lastActivity>15*60*1000)signOut('Your session was closed after 15 minutes without activity. Please sign in.');},30000);
if(!configured()){
  notice('Configuration is required. Follow README_SETUP.md, run the supplied Supabase SQL, create the administrator, and add the public project URL/key in js/config.js.','error');
  login.querySelector('button').disabled=true;
}else{
  try{
    client=await getAdminClient();
    client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){clearPrivateUI();}});
    await gate();
  }catch{clearPrivateUI();notice('The administrator connection could not be established. Check the public configuration and database setup.','error');}
}
