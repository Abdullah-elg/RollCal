// Plays each drawing's little animation once, when it scrolls into view.
// Without this script (or with reduce motion on) everything simply shows.
(function () {
  var root = document.documentElement;
  if (!('IntersectionObserver' in window)) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  root.classList.add('motion');
  var seen = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      seen.unobserve(e.target);
    });
  }, { threshold: 0.4 });
  document.querySelectorAll('[data-reveal]').forEach(function (el) { seen.observe(el); });
})();
