import { bindSubmission } from './forms.js';
const form = document.querySelector('#contact-form');
const service = form.elements.service_type;
const advanced = form.querySelector('.advanced-fields');
function syncAdvanced() { advanced.hidden = service.value !== 'advanced'; advanced.disabled = advanced.hidden; }
const selected = new URLSearchParams(location.search).get('service');
if (['launch','growth','premium','advanced','listing','other'].includes(selected)) service.value = selected;
service.addEventListener('change', syncAdvanced);
form.addEventListener('reset-done', syncAdvanced);
for (const name of ['page_count','product_count']) { form.elements[name].min = '0'; form.elements[name].max = '100000'; form.elements[name].step = '1'; }
syncAdvanced();
bindSubmission(form, 'contact', d => ({
  name: d.name.trim(), email: d.email.trim(), business_name: d.business_name.trim(), service_interest: d.service_type, message: d.message.trim(),
  scope_details: d.service_type === 'advanced' ? {page_count:d.page_count || '',product_count:d.product_count || '',booking:(d.booking || '').trim(),integrations:(d.integrations || '').trim(),functionality:(d.functionality || '').trim()} : {}
}));
