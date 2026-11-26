// Why Netflix: as each chapter scrolls to the middle of the screen, the stage behind it changes scene
// and the chapter's text fades in.
const story = document.querySelector('.story');
const steps = story ? [...story.querySelectorAll('.step')] : [];

if (steps.length && 'IntersectionObserver' in window) {
  const watch = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('on');
      story.dataset.scene = e.target.dataset.scene;
    }
  }, { rootMargin: '-45% 0px -45% 0px' });
  steps.forEach((s) => watch.observe(s));
} else {
  steps.forEach((s) => s.classList.add('on'));
}
