// Shared site behavior: scroll reveal + lightweight visit tracking
const obs = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target); } });
}, { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach(el => obs.observe(el));

fetch('/api/track', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ page: location.pathname })
}).catch(() => {});

// Logged-in users see "Book a Demo" in the nav instead of "Sign Up"
fetch('/api/me', { credentials: 'same-origin' })
  .then(r => r.json())
  .then(({ user }) => {
    if (!user) return;
    const navBtn = document.querySelector('.nav-right .btn-primary');
    if (!navBtn) return;
    navBtn.textContent = 'Book a Demo →';
    navBtn.href = 'https://jupiter.neetocal.com/meeting-with-omar-elkhon';
    navBtn.target = '_blank';
    navBtn.rel = 'noopener';
    navBtn.addEventListener('click', () => {
      fetch('/api/demo', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    }, { once: true });
    const wl = document.querySelector('.nav-right .nav-login');
    if (wl) { wl.textContent = 'Hi, ' + user.name.split(' ')[0]; wl.removeAttribute('href'); wl.style.cursor = 'default'; }
  })
  .catch(() => {});

// Scale the fixed 950x594 dashboard canvas to fill the laptop screen exactly
const dashScr = document.querySelector('.laptop-screen');
const dashEl = dashScr && dashScr.querySelector('.dash');
function fitDash() {
  if (dashEl) dashEl.style.transform = 'scale(' + (dashScr.clientWidth / 950) + ')';
}
if (dashEl) { fitDash(); window.addEventListener('resize', fitDash); }
