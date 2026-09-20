import { configured, rpc, element, serviceNames, dateLabel } from './api.js';
const container = document.querySelector('[data-reviews]');
const featured = container.dataset.featured === 'true';
const more = document.querySelector('[data-load-more]');
let filter = 'all', offset = 0, generation = 0, loading = false;
const pageSize = featured ? 3 : 12;
function message(text) { container.replaceChildren(element('p', 'empty-state', text)); }
function card(review) {
  const article = element('article', 'review-card');
  const rating = Math.max(1, Math.min(5, Number(review.rating)));
  const stars = element('div', 'review-stars', '★'.repeat(rating) + '☆'.repeat(5 - rating));
  stars.setAttribute('aria-label', `${rating} out of 5 stars`);
  article.append(stars);
  if (review.title) article.append(element('h3', '', review.title));
  article.append(element('p', 'review-body', review.body), element('p', 'review-author', review.display_name));
  if (review.business_name) article.append(element('p', 'review-meta', review.business_name));
  article.append(element('p', 'review-meta', `${serviceNames[review.service_type] || 'Pixelalty customer'} · ${dateLabel(review.created_at)}`));
  if (review.is_verified_customer) article.append(element('p', 'status-badge', 'Verified Customer'));
  if (review.admin_response) {
    const response = element('p', 'review-response');
    response.append(element('b', '', 'Pixelalty response'), document.createTextNode(review.admin_response)); article.append(response);
  }
  return article;
}
async function load(reset = true) {
  const current = ++generation;
  if (reset) { offset = 0; message('Loading customer reviews…'); }
  loading = true;
  if (more) { more.hidden = true; more.disabled = true; }
  container.setAttribute('aria-busy', 'true');
  try {
    const rows = await rpc('get_public_reviews', {p_category:filter,p_featured:featured,p_limit:pageSize,p_offset:offset});
    if (current !== generation) return;
    if (!Array.isArray(rows)) throw new Error('Unexpected response');
    if (reset) container.replaceChildren();
    if (!rows.length && offset === 0) {
      if (featured) {
        const counts = await rpc('public_review_count');
        if (current !== generation) return;
        message(Number(counts) > 0 ? 'Read the latest customer experiences on our Reviews page.' : 'Pixelalty is new. Verified customer reviews will appear here as projects are completed.');
      } else message(filter === 'all' ? 'Pixelalty is new. Customer reviews will appear here as projects are completed.' : 'No published reviews for this service yet.');
    }
    rows.forEach(r => container.append(card(r))); offset += rows.length;
    if (more) more.hidden = rows.length < pageSize;
  } catch {
    if (current !== generation) return;
    if (reset) message('Customer reviews could not be loaded. Please try again shortly.');
    else { const error = element('p', 'empty-state', 'More reviews could not be loaded. Please try again.'); container.append(error); if (more) more.hidden = false; }
  } finally {
    if (current === generation) { loading = false; container.removeAttribute('aria-busy'); if (more) more.disabled = false; }
  }
}
if (!configured()) {
  message('Customer reviews are being prepared.');
  document.querySelectorAll('[data-filter]').forEach(b => { b.disabled = true; });
} else {
  load();
  more?.addEventListener('click', () => { if (!loading) load(false); });
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
    filter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(b => { const active = b === button; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); });
    load(true);
  }));
}
