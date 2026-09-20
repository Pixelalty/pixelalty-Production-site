import { config } from './config.js';
const toggle = document.querySelector('.menu-toggle');
const menu = document.querySelector('#main-nav');
function closeMenu(restore = false) {
  const wasOpen = toggle?.getAttribute('aria-expanded') === 'true';
  toggle?.setAttribute('aria-expanded', 'false');
  toggle?.querySelector('.sr-only')?.replaceChildren(document.createTextNode('Open menu'));
  menu?.classList.remove('menu-open');
  if (restore && wasOpen) toggle?.focus();
}
toggle?.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open));
  toggle.querySelector('.sr-only').textContent = open ? 'Close menu' : 'Open menu';
  menu.classList.toggle('menu-open', open);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(true); });
menu?.addEventListener('click', e => { if (e.target.closest('a')) closeMenu(); });
const desktop = matchMedia('(min-width: 981px)');
desktop.addEventListener('change', () => closeMenu());
document.addEventListener('click', e => { if (!e.target.closest('.site-header')) closeMenu(); });
document.addEventListener('focusin', e => { if (!e.target.closest('.site-header')) closeMenu(); });
const header = document.querySelector('.site-header');
window.addEventListener('scroll', () => header?.classList.toggle('scrolled', scrollY > 15), { passive: true });
document.querySelectorAll('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });
if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.remove('is-pending'); observer.unobserve(entry.target); }
  }), { threshold: 0.05 });
  document.querySelectorAll('.reveal').forEach(el => { el.classList.add('is-pending'); observer.observe(el); });
  // Never leave content invisible if scrolling or layout prevents an intersection.
  window.setTimeout(() => document.querySelectorAll('.is-pending').forEach(el => el.classList.remove('is-pending')), 6500);
}
if (/^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/.test(config.contactEmail)) {
  const targets = [...document.querySelectorAll('[data-contact-email]'), document.querySelector('.footer-links > div')].filter(Boolean);
  targets.forEach(el => { const a = document.createElement('a'); a.href = 'mailto:' + config.contactEmail; a.textContent = config.contactEmail; el.append(a); });
}
