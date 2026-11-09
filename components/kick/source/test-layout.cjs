// Run in the installed app's webOS Web Inspector: checkLayout().
// Reports painted overflow and overlapping controls; intentional ellipses are allowed.
function checkLayout() {
    const errors = [];
    const label = el => el.id || el.className || el.tagName;
    const visible = el => el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    if (document.documentElement.scrollWidth > innerWidth + 1) errors.push('Page has horizontal overflow');
    for (const el of document.body.querySelectorAll('*')) {
      if (!visible(el)) continue;
      const style = getComputedStyle(el), rect = el.getBoundingClientRect();
      // Inline text can extend into an intentional ellipsis/line clamp ancestor.
      if (style.display === 'inline' || el.matches('input, source, progress')) continue;
      if (rect.left < -1 || rect.right > innerWidth + 1) errors.push(label(el) + ': box outside viewport');
      if (style.overflowX === 'visible' && el.clientWidth && el.scrollWidth > el.clientWidth + 1)
        errors.push(label(el) + ': horizontal content overflow');
      if (style.overflowY === 'visible' && el.clientHeight && el.scrollHeight > el.clientHeight + 1)
        errors.push(label(el) + ': vertical content overflow');
    }
    function disjoint(a, b) {
      a = document.querySelector(a); b = document.querySelector(b);
      if (!visible(a) || !visible(b)) return;
      const x = a.getBoundingClientRect(), y = b.getBoundingClientRect();
      if (Math.min(x.right, y.right) - Math.max(x.left, y.left) > 1 &&
          Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 1)
        errors.push(label(a) + ' overlaps ' + label(b));
    }
    disjoint('.catalog-description', '.catalog-actions');
    disjoint('#play', '#recordings');
    disjoint('#playback-status', '#playback-controls');
    disjoint('#back', '#playback-status');
    disjoint('#back', '#playback-controls');
    disjoint('#elapsed', '.seek-track');
    disjoint('#duration', '.seek-track');
    for (const card of document.querySelectorAll('#videos button')) {
      const a = card.querySelector('.last-watched'), b = card.querySelector('.watched-badge');
      if (visible(a) && visible(b) && a.getBoundingClientRect().bottom > b.getBoundingClientRect().top + 1)
        errors.push('Replay badges overlap');
    }
    return errors;
}
if (typeof module !== "undefined") module.exports = checkLayout;
