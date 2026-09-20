import { bindSubmission } from './forms.js';
bindSubmission(document.querySelector('#review-form'), 'review', d => ({
  display_name:d.display_name.trim(),email:d.email.trim(),business_name:d.business_name.trim(),service_type:d.service_type,
  rating:Number(d.rating),title:d.title.trim(),body:d.body.trim(),order_reference:d.order_reference.trim(),consent:d.consent === 'on'
}));
