// Basic highlight for bottom nav based on current path
(function () {
  try {
    const path = location.pathname;
    const links = document.querySelectorAll('#bottomNav a');
    links.forEach(a => {
      const active = a.getAttribute('href') === path;
      a.classList.toggle('text-violet-600', active);
      a.classList.toggle('font-semibold', active);
    });
  } catch (_e) {}
})();
